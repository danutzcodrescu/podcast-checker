import { infiniteQueryOptions } from '@tanstack/react-query'

import { getLatestEpisodes } from '#/lib/latest-episodes'
import type { EpisodeFilters } from '#/lib/latest-episodes'
import type { PodcastLibrary } from '#/lib/podcast-library'

export type EpisodePageParam = { offset: number; searchSessionId?: string }

const firstEpisodePage: EpisodePageParam = { offset: 0, searchSessionId: undefined }

/** Podcast ids and their categories, so episode results are keyed by the library they were fetched for. */
export type EpisodeScope = ReadonlyArray<readonly [number, readonly string[]]>

export function episodeScope(library: Pick<PodcastLibrary, 'podcasts'>): EpisodeScope {
  return library.podcasts.map(({ podcast, categories }) => [podcast.id, categories] as const)
}

/**
 * Shared by the route loader (which prefetches the first page) and the page.
 *
 * The stale times are what make that prefetch worth anything: without them the page would refetch
 * the first page as soon as it hydrates. Browsing still polls for newly imported episodes; a
 * search result set is a fixed snapshot, so it stays fresh longer and does not poll.
 */
export function latestEpisodesQueryOptions(
  email: string,
  filters: EpisodeFilters,
  scope: EpisodeScope,
) {
  return infiniteQueryOptions({
    queryKey: ['latest-episodes', email, filters, scope] as const,
    queryFn: ({ pageParam }) => getLatestEpisodes({ data: { ...filters, ...pageParam } }),
    initialPageParam: firstEpisodePage,
    getNextPageParam: (page): EpisodePageParam | undefined =>
      page.nextOffset === null
        ? undefined
        : { offset: page.nextOffset, searchSessionId: page.searchSessionId ?? undefined },
    retry: false,
    refetchInterval: filters.term ? false : 30_000,
    refetchOnWindowFocus: !filters.term,
    staleTime: filters.term ? 5 * 60_000 : 30_000,
  })
}
