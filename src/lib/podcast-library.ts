import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { requireAuth } from '#/lib/auth-middleware'
import {
  categoryId,
  categoryNameInput,
  podcastIdInput,
  savePodcastInput,
} from '#/lib/podcast-library-input'

async function readLibrary(userId: string) {
  const [podcasts, categories] = await Promise.all([
    db
      .select({ podcast: followedPodcast.podcast, categories: followedPodcast.categories })
      .from(followedPodcast)
      .where(eq(followedPodcast.userId, userId))
      .orderBy(desc(followedPodcast.followedAt), asc(followedPodcast.podcastId)),
    db
      .select({ id: podcastCategory.id, name: podcastCategory.name })
      .from(podcastCategory)
      .where(eq(podcastCategory.userId, userId))
      .orderBy(asc(podcastCategory.name)),
  ])
  return { podcasts, categories }
}

export type PodcastLibrary = Awaited<ReturnType<typeof readLibrary>>

export const getPodcastLibrary = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(({ context }) => readLibrary(context.session.user.id))

export const saveFollowedPodcast = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(savePodcastInput)
  .handler(async ({ context, data }) => {
    const userId = context.session.user.id
    const categories = [
      ...new Map(data.categories.map((name) => [categoryId(name), name])).entries(),
    ]
    await db.transaction(async (tx) => {
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
        categories: categories.map(([id]) => id),
      }
      await tx
        .insert(followedPodcast)
        .values(values)
        .onConflictDoUpdate({
          target: [followedPodcast.userId, followedPodcast.podcastId],
          set: { podcast: values.podcast, categories: values.categories },
        })
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
