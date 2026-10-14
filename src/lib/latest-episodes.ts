import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { podcastEpisode } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { requireAuth } from '#/lib/auth-middleware'
import { podcastIdInput } from '#/lib/podcast-library-input'

const episodesInput = z.object({
  podcastId: podcastIdInput.nullable(),
  categoryId: z.string().max(60).nullable(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable(),
  sort: z.enum(['newest', 'oldest']),
  offset: z.number().int().min(0).max(1_000_000),
})

export type EpisodeFilters = Omit<z.infer<typeof episodesInput>, 'offset'>
const pageSize = 25

export const getLatestEpisodes = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .validator(episodesInput)
  .handler(async ({ context, data }) => {
    // A feed can be listed under more than one Apple ID; show each episode once.
    const followed = db
      .selectDistinctOn([followedPodcast.feedId], {
        feedId: followedPodcast.feedId,
        podcast: followedPodcast.podcast,
        categories: followedPodcast.categories,
      })
      .from(followedPodcast)
      .where(
        and(
          eq(followedPodcast.userId, context.session.user.id),
          data.podcastId === null ? undefined : eq(followedPodcast.podcastId, data.podcastId),
          data.categoryId === null
            ? undefined
            : sql`${data.categoryId} = any(${followedPodcast.categories})`,
        ),
      )
      .orderBy(asc(followedPodcast.feedId), asc(followedPodcast.podcastId))
      .as('followed')
    const dateFilter =
      data.days === null
        ? undefined
        : gte(podcastEpisode.publishedAt, new Date(Date.now() - data.days * 86_400_000))
    const direction = data.sort === 'newest' ? sql`desc` : sql`asc`
    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: podcastEpisode.id,
          title: podcastEpisode.title,
          description: sql<string>`left(${podcastEpisode.cleanedDescription}, 500)`,
          publishedAt: podcastEpisode.publishedAt,
          durationSeconds: podcastEpisode.durationSeconds,
          artworkUrl: podcastEpisode.artworkUrl,
          podcast: followed.podcast,
          categories: followed.categories,
        })
        .from(podcastEpisode)
        .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
        .where(dateFilter)
        .orderBy(sql`${podcastEpisode.publishedAt} ${direction} nulls last`, asc(podcastEpisode.id))
        .limit(pageSize)
        .offset(data.offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(podcastEpisode)
        .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
        .where(dateFilter),
    ])
    const nextOffset = data.offset + rows.length
    return {
      episodes: rows.map((episode) => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        durationSeconds: episode.durationSeconds,
        artworkUrl: episode.artworkUrl,
        podcast: episode.podcast,
        categories: episode.categories,
      })),
      total: count.total,
      nextOffset: nextOffset < count.total ? nextOffset : null,
    }
  })

export type LatestEpisode = Awaited<ReturnType<typeof getLatestEpisodes>>['episodes'][number]
