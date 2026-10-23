import type { EpisodeSearchInput } from './episode-search-input'
import { createEpisodeRetrieval } from './episode-retrieval.server'
import { readEpisodeSearchSnapshot } from './episode-search-snapshot.server'

export { episodesInput } from '#/lib/episode-search-input'
export type { EpisodeFilters, EpisodeSearchMode } from '#/lib/episode-search-input'

export async function readLatestEpisodes(
  userId: string,
  data: EpisodeSearchInput,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const searching = Boolean(data.term)
  const result =
    searching && data.sort === 'relevance'
      ? await readEpisodeSearchSnapshot(userId, data, signal)
      : await createEpisodeRetrieval(userId, data, signal).readPage()
  signal?.throwIfAborted()

  return {
    ...result,
    episodes: result.episodes.map(({ textMatch, publishedAt, ...episode }) =>
      Object.assign(episode, {
        publishedAt: publishedAt?.toISOString() ?? null,
        matchType: searching
          ? data.searchMode === 'semantic' || !textMatch
            ? ('semantic' as const)
            : ('text' as const)
          : null,
      }),
    ),
  }
}
