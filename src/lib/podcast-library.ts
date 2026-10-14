import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { episodeEmbedding, podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import type { Podcast } from '#/lib/apple-podcasts'
import type { PodcastSync } from '#/lib/podcast-sync'
import { requireAuth } from '#/lib/auth-middleware'
import {
  categoryId,
  categoryNameInput,
  podcastIdInput,
  savePodcastInput,
} from '#/lib/podcast-library-input'

async function readLibrary(userId: string) {
  const counts = db
    .select({
      feedId: podcastEpisode.feedId,
      episodes: sql<number>`count(*)::int`.as('episode_count'),
      embedded: sql<number>`count(*) filter (where ${episodeEmbedding.status} = 'ready')::int`.as(
        'embedded_count',
      ),
      failed: sql<number>`count(*) filter (where ${episodeEmbedding.status} = 'failed')::int`.as(
        'failed_count',
      ),
    })
    .from(podcastEpisode)
    .leftJoin(episodeEmbedding, eq(episodeEmbedding.episodeId, podcastEpisode.id))
    .where(
      sql`${podcastEpisode.feedId} in (select feed_id from followed_podcast where user_id = ${userId})`,
    )
    .groupBy(podcastEpisode.feedId)
    .as('episode_counts')
  const [rows, categories] = await Promise.all([
    db
      .select({
        podcast: followedPodcast.podcast,
        categories: followedPodcast.categories,
        feed: {
          id: podcastFeed.id,
          status: podcastFeed.status,
          lastSyncedAt: podcastFeed.lastSyncedAt,
        },
        episodes: counts.episodes,
        embedded: counts.embedded,
        failed: counts.failed,
      })
      .from(followedPodcast)
      .leftJoin(podcastFeed, eq(podcastFeed.id, followedPodcast.feedId))
      .leftJoin(counts, eq(counts.feedId, podcastFeed.id))
      .where(eq(followedPodcast.userId, userId))
      .orderBy(desc(followedPodcast.followedAt), asc(followedPodcast.podcastId)),
    db
      .select({ id: podcastCategory.id, name: podcastCategory.name })
      .from(podcastCategory)
      .where(eq(podcastCategory.userId, userId))
      .orderBy(asc(podcastCategory.name)),
  ])
  const podcasts: { podcast: Podcast; categories: string[]; sync?: PodcastSync | null }[] =
    rows.map((row) => ({
      podcast: row.podcast,
      categories: row.categories,
      sync: row.feed
        ? {
            status: row.feed.status,
            episodes: row.episodes ?? 0,
            embedded: row.embedded ?? 0,
            failed: row.failed ?? 0,
            lastSyncedAt: row.feed.lastSyncedAt?.toISOString() ?? null,
          }
        : null,
    }))
  return { podcasts, categories }
}

export type PodcastLibrary = Awaited<ReturnType<typeof readLibrary>>

export const getPodcastLibrary = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(({ context }) => readLibrary(context.session.user.id))

export const getDefaultPodcastRoute = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const [followed] = await db
      .select({ id: followedPodcast.podcastId })
      .from(followedPodcast)
      .where(eq(followedPodcast.userId, context.session.user.id))
      .limit(1)
    return followed ? '/latest-episodes' : '/discover'
  })

export const saveFollowedPodcast = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(savePodcastInput)
  .handler(async ({ context, data }) => {
    const userId = context.session.user.id
    const categories = [
      ...new Map(data.categories.map((name) => [categoryId(name), name])).entries(),
    ]
    await db.transaction(async (tx) => {
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
      }
      await tx
        .insert(followedPodcast)
        .values(values)
        .onConflictDoUpdate({
          target: [followedPodcast.userId, followedPodcast.podcastId],
          set: { podcast: values.podcast, categories: values.categories, feedId },
        })
    })
    return readLibrary(userId)
  })

export const retryPodcastIngestion = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(podcastIdInput)
  .handler(async ({ context, data }) => {
    const userId = context.session.user.id
    await db.transaction(async (tx) => {
      const [followed] = await tx
        .select({ feedId: followedPodcast.feedId })
        .from(followedPodcast)
        .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, data)))
      if (!followed?.feedId) return
      await tx
        .update(podcastFeed)
        .set({ status: 'queued', lastError: null, nextSyncAt: new Date() })
        .where(and(eq(podcastFeed.id, followed.feedId), ne(podcastFeed.status, 'syncing')))
      await tx
        .update(episodeEmbedding)
        .set({ status: 'pending', lastError: null, nextAttemptAt: new Date() })
        .where(
          and(
            eq(episodeEmbedding.status, 'failed'),
            sql`${episodeEmbedding.episodeId} in (select id from podcast_episode where feed_id = ${followed.feedId})`,
          ),
        )
    })
    return readLibrary(userId)
  })

export const unfollowPodcast = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(podcastIdInput)
  .handler(async ({ context, data }) => {
    const userId = context.session.user.id
    await db
      .delete(followedPodcast)
      .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.podcastId, data)))
    return readLibrary(userId)
  })

export const createPodcastCategory = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(categoryNameInput)
  .handler(async ({ context, data }) => {
    const userId = context.session.user.id
    await db
      .insert(podcastCategory)
      .values({ userId, id: categoryId(data), name: data })
      .onConflictDoNothing()
    return readLibrary(userId)
  })
