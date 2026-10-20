import { and, asc, cosineDistance, eq, gte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { episodeEmbedding, podcastEpisode } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { embedEpisodeQuery } from '#/lib/episode-query-embedding'
import { embeddingModel, preprocessingVersion } from '#/lib/episode-text'
import { podcastIdInput } from '#/lib/podcast-library-input'
import { getLogger } from '#/lib/logger'

export const episodesInput = z.object({
  podcastId: podcastIdInput.nullable(),
  categoryId: z.string().max(120).nullable(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable(),
  sort: z.enum(['newest', 'oldest', 'relevance']),
  term: z.string().trim().max(200).default(''),
  searchMode: z.enum(['hybrid', 'text', 'semantic']).default('hybrid'),
  offset: z.number().int().min(0).max(1_000_000),
})

export type EpisodeFilters = Omit<z.infer<typeof episodesInput>, 'offset'>
export type EpisodeSearchMode = EpisodeFilters['searchMode']
const pageSize = 25

export async function readLatestEpisodes(userId: string, data: z.infer<typeof episodesInput>) {
  const searching = Boolean(data.term)
  let vector: number[] | null = null
  let semanticUnavailable = false
  if (searching && data.searchMode !== 'text') {
    try {
      vector = await embedEpisodeQuery(data.term)
    } catch (err) {
      getLogger().warn(
        { event: 'search.semantic_unavailable', err, searchMode: data.searchMode },
        'Semantic episode search unavailable',
      )
      // Do not expose provider errors (or their causes) to the RPC client.
      // oxlint-disable-next-line preserve-caught-error -- The safe failure was logged above.
      if (data.searchMode === 'semantic') throw new Error('Semantic episode search is unavailable')
      semanticUnavailable = true
    }
  }

  // Escape LIKE wildcards so user text remains a literal substring.
  const pattern = `%${data.term.replace(/[\\%_]/g, '\\$&')}%`
  const document = sql`setweight(to_tsvector('simple', ${podcastEpisode.title}), 'A') || setweight(to_tsvector('simple', ${podcastEpisode.cleanedDescription}), 'B')`
  const query = sql`plainto_tsquery('simple', ${data.term})`
  const titleMatch = sql<boolean>`${podcastEpisode.title} ilike ${pattern}`
  const descriptionMatch = sql<boolean>`${podcastEpisode.cleanedDescription} ilike ${pattern}`
  const textMatch = searching
    ? sql<boolean>`(${titleMatch} or ${descriptionMatch} or (${document}) @@ ${query})`
    : sql<boolean>`false`
  const textScore =
    searching && data.searchMode !== 'semantic'
      ? sql<number>`case when ${titleMatch} then 2.0 when ${descriptionMatch} then 1.0 else least(ts_rank_cd((${document}), ${query}), 1.0) end`
      : sql<number>`0.0`
  const similarity = vector
    ? sql<number>`(1 - (${cosineDistance(episodeEmbedding.embedding, vector)}))`
    : sql<number>`0.0`
  // Exclude unrelated vectors, while allowing unembedded episodes to match text.
  const semanticMatch = vector ? gte(similarity, 0.3) : undefined
  const searchFilter = !searching
    ? undefined
    : data.searchMode === 'semantic'
      ? semanticMatch
      : or(textMatch, semanticMatch)
  const score = sql<number>`${textScore} + coalesce(${similarity}, 0.0)`

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
        eq(followedPodcast.userId, userId),
        data.podcastId === null ? undefined : eq(followedPodcast.podcastId, data.podcastId),
        data.categoryId === null
          ? undefined
          : sql`${data.categoryId} = any(${followedPodcast.categories})`,
      ),
    )
    .orderBy(asc(followedPodcast.feedId), asc(followedPodcast.podcastId))
    .as('followed')
  const filter = and(
    data.days === null
      ? undefined
      : gte(podcastEpisode.publishedAt, new Date(Date.now() - data.days * 86_400_000)),
    searchFilter,
  )
  const compatibleEmbedding = and(
    eq(episodeEmbedding.episodeId, podcastEpisode.id),
    eq(episodeEmbedding.status, 'ready'),
    eq(episodeEmbedding.model, embeddingModel),
    eq(episodeEmbedding.preprocessingVersion, preprocessingVersion),
  )
  const direction = data.sort === 'oldest' ? sql`asc` : sql`desc`
  const dateOrder = sql`${podcastEpisode.publishedAt} ${direction} nulls last`
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
        textMatch,
      })
      .from(podcastEpisode)
      .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
      .leftJoin(episodeEmbedding, compatibleEmbedding)
      .where(filter)
      .orderBy(
        ...(searching && data.sort === 'relevance' ? [sql`${score} desc`] : []),
        dateOrder,
        asc(podcastEpisode.id),
      )
      .limit(pageSize)
      .offset(data.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(podcastEpisode)
      .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
      .leftJoin(episodeEmbedding, compatibleEmbedding)
      .where(filter),
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
      matchType: searching
        ? data.searchMode === 'semantic' || !episode.textMatch
          ? ('semantic' as const)
          : ('text' as const)
        : null,
    })),
    total: count.total,
    nextOffset: nextOffset < count.total ? nextOffset : null,
    semanticUnavailable,
  }
}
