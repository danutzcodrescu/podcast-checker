import { and, asc, cosineDistance, eq, gte, inArray, or, sql } from 'drizzle-orm'
import type { z } from 'zod'

import { db } from '#/db'
import { episodeEmbedding, podcastEpisode } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { embedEpisodeQuery } from '#/lib/episode-query-embedding'
import { embeddingModel, preprocessingVersion } from '#/lib/episode-text'
import { episodeSearchExpired, episodesInput } from '#/lib/episode-search-input'
import {
  episodeSearchFingerprint,
  findEpisodeSearchSession,
  loadEpisodeSearchSession,
  saveEpisodeSearchSession,
} from '#/lib/episode-search-session'
import {
  rerankEpisodes,
  rerankingCandidateLimit,
  rerankingConfiguration,
} from '#/lib/episode-reranking'
import { getLogger } from '#/lib/logger'

export { episodesInput } from '#/lib/episode-search-input'
export type { EpisodeFilters, EpisodeSearchMode } from '#/lib/episode-search-input'
const pageSize = 25

export async function readLatestEpisodes(userId: string, data: z.infer<typeof episodesInput>) {
  const searching = Boolean(data.term)
  const relevanceSearch = searching && data.sort === 'relevance'
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
  const selection = {
    id: podcastEpisode.id,
    title: podcastEpisode.title,
    description: sql<string>`left(${podcastEpisode.cleanedDescription}, 500)`,
    publishedAt: podcastEpisode.publishedAt,
    durationSeconds: podcastEpisode.durationSeconds,
    artworkUrl: podcastEpisode.artworkUrl,
    podcast: followed.podcast,
    categories: followed.categories,
  }
  const serialize = (
    rows: {
      id: string
      title: string
      description: string
      publishedAt: Date | null
      durationSeconds: number | null
      artworkUrl: string | null
      podcast: typeof followedPodcast.$inferSelect.podcast
      categories: string[]
      textMatch: boolean
    }[],
  ) =>
    rows.map(({ textMatch, ...episode }) => ({
      ...episode,
      publishedAt: episode.publishedAt?.toISOString() ?? null,
      matchType: searching
        ? data.searchMode === 'semantic' || !textMatch
          ? ('semantic' as const)
          : ('text' as const)
        : null,
    }))
  // Hash filters, model/version and the current library; never persist the query itself.
  const fingerprint = relevanceSearch
    ? episodeSearchFingerprint({
        term: data.term,
        podcastId: data.podcastId,
        categoryId: data.categoryId,
        days: data.days,
        searchMode: data.searchMode,
        configuration: rerankingConfiguration(),
        retrieval: { embeddingModel, preprocessingVersion },
        followed: await db.select().from(followed).orderBy(asc(followed.feedId)),
      })
    : null

  const readSnapshotPage = async (
    session: Awaited<ReturnType<typeof saveEpisodeSearchSession>>,
  ) => {
    const ids = session.episodeIds.slice(data.offset, data.offset + pageSize)
    // Re-authorize against current follows on every page, not just when the snapshot is made.
    const rows = ids.length
      ? await db
          .select(selection)
          .from(podcastEpisode)
          .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
          .where(inArray(podcastEpisode.id, ids))
      : []
    const positions = new Map(ids.map((id, index) => [id, index]))
    rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    const textMatches = new Set(session.textMatchIds)
    const nextOffset = data.offset + ids.length
    return {
      episodes: serialize(
        rows.map((row) => Object.assign(row, { textMatch: textMatches.has(row.id) })),
      ),
      total: session.episodeIds.length,
      nextOffset: nextOffset < session.episodeIds.length ? nextOffset : null,
      semanticUnavailable: session.semanticUnavailable,
      searchSessionId: session.id,
      ranking: session.ranking,
    }
  }
  if (fingerprint && data.searchSessionId) {
    return readSnapshotPage(
      await loadEpisodeSearchSession(data.searchSessionId, userId, fingerprint),
    )
  }
  if (fingerprint && data.offset > 0) throw new Error(episodeSearchExpired)
  if (fingerprint) {
    const cached = await findEpisodeSearchSession(userId, fingerprint)
    if (cached) return readSnapshotPage(cached)
  }
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
  if (fingerprint) {
    // Freeze all matching IDs (not descriptions/vectors) so ingestion cannot shift later pages.
    const matches = await db
      .select({ id: podcastEpisode.id, textMatch })
      .from(podcastEpisode)
      .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
      .leftJoin(episodeEmbedding, compatibleEmbedding)
      .where(filter)
      .orderBy(sql`${score} desc`, dateOrder, asc(podcastEpisode.id))
    const candidateIds = matches.slice(0, rerankingCandidateLimit).map(({ id }) => id)
    const candidates = candidateIds.length
      ? await db
          .select({
            id: podcastEpisode.id,
            title: podcastEpisode.title,
            description: sql<string>`left(${podcastEpisode.cleanedDescription}, 12000)`,
            podcast: followed.podcast,
          })
          .from(podcastEpisode)
          .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
          .where(inArray(podcastEpisode.id, candidateIds))
      : []
    const byId = new Map(candidates.map((episode) => [episode.id, episode]))
    const { ids, ranking } = await rerankEpisodes(
      data.term,
      candidateIds.flatMap((id) => {
        const episode = byId.get(id)
        return episode ? [{ ...episode, podcastTitle: episode.podcast.title }] : []
      }),
    )
    const session = await saveEpisodeSearchSession({
      userId,
      fingerprint,
      episodeIds: [...ids, ...matches.slice(rerankingCandidateLimit).map(({ id }) => id)],
      textMatchIds: matches.filter(({ textMatch: matched }) => matched).map(({ id }) => id),
      semanticUnavailable,
      ranking,
    })
    return readSnapshotPage(session)
  }
  const [rows, [count]] = await Promise.all([
    db
      .select({
        ...selection,
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
    episodes: serialize(rows),
    total: count.total,
    nextOffset: nextOffset < count.total ? nextOffset : null,
    semanticUnavailable,
    searchSessionId: null,
    ranking: null,
  }
}
