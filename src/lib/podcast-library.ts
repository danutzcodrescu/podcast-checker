import { createServerFn } from '@tanstack/react-start'
import { and, eq, ne, sql } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { episodeEmbedding, podcastFeed } from '#/db/ingestion-schema'
import { requireAuth } from '#/lib/auth-middleware'
import {
  categoryId,
  categoryNameInput,
  podcastIdInput,
  savePodcastInput,
} from '#/lib/podcast-library-input'
import { readPodcastLibrary } from './podcast-library-query.server'

export type PodcastLibrary = Awaited<ReturnType<typeof readPodcastLibrary>>

export const getPodcastLibrary = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(({ context }) => readPodcastLibrary(context.session.user.id))

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
    const { savePodcastFollow } = await import('./podcast-follows.server')
    return savePodcastFollow(context.session.user.id, data)
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
    return readPodcastLibrary(userId)
  })

export const unfollowPodcast = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(podcastIdInput)
  .handler(async ({ context, data }) => {
    const { removePodcastFollow } = await import('./podcast-follows.server')
    return removePodcastFollow(context.session.user.id, data)
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
    return readPodcastLibrary(userId)
  })
