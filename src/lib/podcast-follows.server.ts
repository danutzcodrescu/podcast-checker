import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { podcastFeed } from '#/db/ingestion-schema'
import { categoryId } from './podcast-library-input'
import type { savePodcastInput } from './podcast-library-input'
import { readPodcastLibrary } from './podcast-library-query.server'
import { classifyPodcast } from './podcast-classification'
import { fetchRss } from './rss-fetch'
import { parseRss } from './rss-parser'
import { getLogger } from './logger'

type FollowTransaction = Pick<typeof db, 'execute' | 'select' | 'delete'>

async function lockFollowFeeds(
  tx: FollowTransaction,
  userId: string,
  podcastId: number,
  nextUrl?: string,
) {
  // Lock the follow even when absent, then feeds in URL order to prevent swap deadlocks.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['follow', userId, podcastId])}, 0))`,
  )
  const [previous] = await tx
    .select({ feedId: followedPodcast.feedId, url: podcastFeed.url })
    .from(followedPodcast)
    .leftJoin(podcastFeed, eq(podcastFeed.id, followedPodcast.feedId))
    .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, podcastId)))
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; this array is newly created.
  for (const url of [...new Set([previous?.url, nextUrl].filter((value) => !!value))].sort()) {
    // oxlint-disable-next-line no-await-in-loop -- Every writer acquires shared-feed locks in the same order.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`feed:${url}`}, 0))`)
  }
  return previous?.feedId
}

async function removeUnfollowedFeed(tx: FollowTransaction, feedId: string) {
  // Foreign-key cascades remove episodes and embeddings only after the last follow leaves.
  await tx
    .delete(podcastFeed)
    .where(
      and(
        eq(podcastFeed.id, feedId),
        sql`not exists (select 1 from ${followedPodcast} where ${followedPodcast.feedId} = ${podcastFeed.id})`,
      ),
    )
}

export async function savePodcastFollow(userId: string, data: z.infer<typeof savePodcastInput>) {
  const categories = [...new Map(data.categories.map((name) => [categoryId(name), name])).entries()]
  const token =
    !categories.length && data.podcast.feedUrl && process.env.OPENROUTER_API_KEY
      ? randomUUID()
      : null
  const saved = await db.transaction(async (tx) => {
    const url = data.podcast.feedUrl ? new URL(data.podcast.feedUrl) : null
    if (url) url.hash = ''
    const previousFeedId = await lockFollowFeeds(tx, userId, data.podcast.id, url?.href)
    let feedId: string | null = null
    if (url) {
      const [feed] = await tx
        .insert(podcastFeed)
        .values({ url: url.href })
        .onConflictDoUpdate({ target: podcastFeed.url, set: { url: url.href } })
        .returning({ id: podcastFeed.id })
      feedId = feed.id
    }
    if (categories.length) {
      await tx
        .insert(podcastCategory)
        .values(categories.map(([id, name]) => ({ userId, id, name })))
        .onConflictDoNothing()
    }
    const values = {
      userId,
      podcastId: data.podcast.id,
      podcast: data.podcast,
      feedId,
      categories: categories.map(([id]) => id),
      categorisationToken: token,
    }
    const [row] = await tx
      .insert(followedPodcast)
      .values(values)
      .onConflictDoUpdate({
        target: [followedPodcast.userId, followedPodcast.podcastId],
        set: {
          podcast: values.podcast,
          categories: values.categories,
          feedId,
          // Every explicit save cancels any outstanding automatic categorisation,
          // including a manual edit that clears all categories.
          categorisationToken: null,
        },
      })
      .returning({ token: followedPodcast.categorisationToken })
    if (previousFeedId && previousFeedId !== feedId) {
      await removeUnfollowedFeed(tx, previousFeedId)
    }
    return row
  })
  if (saved.token && data.podcast.feedUrl) {
    await categoriseFollow(userId, data.podcast.id, saved.token, data.podcast.feedUrl)
  }
  return readPodcastLibrary(userId)
}

export async function removePodcastFollow(userId: string, podcastId: number) {
  await db.transaction(async (tx) => {
    await lockFollowFeeds(tx, userId, podcastId)
    const [removed] = await tx
      .delete(followedPodcast)
      .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, podcastId)))
      .returning({ feedId: followedPodcast.feedId })
    if (!removed?.feedId) return
    await removeUnfollowedFeed(tx, removed.feedId)
  })
  return readPodcastLibrary(userId)
}

// The follow is committed before this bounded request. A failed classifier never fails a follow.
async function categoriseFollow(userId: string, podcastId: number, token: string, feedUrl: string) {
  const currentFollow = and(
    eq(followedPodcast.userId, userId),
    eq(followedPodcast.podcastId, podcastId),
    eq(followedPodcast.categorisationToken, token),
    sql`cardinality(${followedPodcast.categories}) = 0`,
  )
  try {
    const signal = AbortSignal.timeout(20_000)
    const response = await fetchRss(feedUrl, {}, signal)
    if (!response.xml) return
    const { title, description, publisher, language, metadata } = parseRss(response.xml)
    const category = await classifyPodcast(
      { title, description, publisher, language, categories: metadata.categories },
      signal,
    )
    if (!category) return
    await db
      .update(followedPodcast)
      .set({ categories: [category] })
      .where(
        and(
          currentFollow,
          sql`exists (select 1 from ${podcastCategory} where ${podcastCategory.userId} = ${userId} and ${podcastCategory.id} = ${category})`,
        ),
      )
  } catch (err) {
    getLogger().warn(
      { event: 'podcast.categorisation_failed', err },
      'Podcast categorisation failed',
    )
  } finally {
    await db
      .update(followedPodcast)
      .set({ categorisationToken: null })
      .where(
        and(
          eq(followedPodcast.userId, userId),
          eq(followedPodcast.podcastId, podcastId),
          eq(followedPodcast.categorisationToken, token),
        ),
      )
      .catch(() => undefined)
  }
}
