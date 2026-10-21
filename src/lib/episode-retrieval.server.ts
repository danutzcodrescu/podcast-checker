import { and, asc, cosineDistance, eq, gte, inArray, or, sql } from 'drizzle-orm'

import { db } from '#/db'
import { episodeEmbedding, podcastEpisode } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { embedEpisodeQuery } from './episode-query-embedding'
import { embeddingModel, preprocessingVersion } from './episode-text'
import { episodePageSize } from './episode-search-input'
import type { EpisodeSearchInput } from './episode-search-input'
import { getLogger } from './logger'

// Keep the followed-feed scope and all SQL private to this concrete retrieval
// module. Both live browsing and snapshots use the same access and matching rules.
export function createEpisodeRetrieval(userId: string, data: EpisodeSearchInput) {
  const searching = Boolean(data.term)
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

  async function matching() {
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
        if (data.searchMode === 'semantic') {
          // Do not expose provider errors (or their causes) to the RPC client.
          // oxlint-disable-next-line preserve-caught-error -- The safe failure was logged above.
          throw new Error('Semantic episode search is unavailable')
        }
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
    return { textMatch, score, filter, compatibleEmbedding, dateOrder, semanticUnavailable }
  }

  return {
    async readFollows() {
      return db.select().from(followed).orderBy(asc(followed.feedId))
    },

    async findMatches() {
      const { textMatch, score, filter, compatibleEmbedding, dateOrder, semanticUnavailable } =
        await matching()
      const matches = await db
        .select({ id: podcastEpisode.id, textMatch })
        .from(podcastEpisode)
        .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
        .leftJoin(episodeEmbedding, compatibleEmbedding)
        .where(filter)
        .orderBy(sql`${score} desc`, dateOrder, asc(podcastEpisode.id))
      return { matches, semanticUnavailable }
    },

    async loadCandidates(ids: string[]) {
      const rows = ids.length
        ? await db
            .select({
              id: podcastEpisode.id,
              title: podcastEpisode.title,
              description: sql<string>`left(${podcastEpisode.cleanedDescription}, 12000)`,
              podcast: followed.podcast,
            })
            .from(podcastEpisode)
            .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
            .where(inArray(podcastEpisode.id, ids))
        : []
      const byId = new Map(rows.map((episode) => [episode.id, episode]))
      return ids.flatMap((id) => {
        const episode = byId.get(id)
        if (!episode) return []
        const { podcast, ...candidate } = episode
        return [{ ...candidate, podcastTitle: podcast.title }]
      })
    },

    async hydrate(ids: string[]) {
      // Re-authorize against current follows on every page, not just on creation.
      return ids.length
        ? db
            .select(selection)
            .from(podcastEpisode)
            .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
            .where(inArray(podcastEpisode.id, ids))
        : []
    },

    async readPage() {
      const { textMatch, score, filter, compatibleEmbedding, dateOrder, semanticUnavailable } =
        await matching()
      const [rows, [count]] = await Promise.all([
        db
          .select({ ...selection, textMatch })
          .from(podcastEpisode)
          .innerJoin(followed, eq(followed.feedId, podcastEpisode.feedId))
          .leftJoin(episodeEmbedding, compatibleEmbedding)
          .where(filter)
          .orderBy(
            ...(searching && data.sort === 'relevance' ? [sql`${score} desc`] : []),
            dateOrder,
            asc(podcastEpisode.id),
          )
          .limit(episodePageSize)
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
        episodes: rows,
        total: count.total,
        nextOffset: nextOffset < count.total ? nextOffset : null,
        semanticUnavailable,
        searchSessionId: null,
        ranking: null,
      }
    },
  }
}
