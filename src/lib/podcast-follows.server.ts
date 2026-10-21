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

export async function savePodcastFollow(userId: string, data: z.infer<typeof savePodcastInput>) {
  const categories = [...new Map(data.categories.map((name) => [categoryId(name), name])).entries()]
  const token =
    !categories.length && data.podcast.feedUrl && process.env.OPENROUTER_API_KEY
      ? randomUUID()
      : null
  const saved = await db.transaction(async (tx) => {
    let feedId: string | null = null
    if (data.podcast.feedUrl) {
      const url = new URL(data.podcast.feedUrl)
      url.hash = ''
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
    return row
  })
  if (saved.token && data.podcast.feedUrl) {
    await categoriseFollow(userId, data.podcast.id, saved.token, data.podcast.feedUrl)
  }
  return readPodcastLibrary(userId)
}

export async function removePodcastFollow(userId: string, podcastId: number) {
  await db.transaction(async (tx) => {
    const [followed] = await tx
      .select({ feedId: followedPodcast.feedId })
      .from(followedPodcast)
      .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, podcastId)))
    // Follow also locks the feed before changing the library. Serialize cleanup
    // on that same row so concurrent follows/unfollows cannot leave an orphan.
    if (followed?.feedId) {
      await tx
        .select({ id: podcastFeed.id })
        .from(podcastFeed)
        .where(eq(podcastFeed.id, followed.feedId))
        .for('update')
    }
    const [removed] = await tx
      .delete(followedPodcast)
      .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, podcastId)))
      .returning({ feedId: followedPodcast.feedId })
    if (!removed?.feedId) return
    // Existing foreign-key cascades delete the feed's episodes and embeddings.
    await tx
      .delete(podcastFeed)
      .where(
        and(
          eq(podcastFeed.id, removed.feedId),
          sql`not exists (select 1 from ${followedPodcast} where ${followedPodcast.feedId} = ${podcastFeed.id})`,
        ),
      )
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
