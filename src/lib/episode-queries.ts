import { infiniteQueryOptions } from '@tanstack/react-query'

import { getLatestEpisodes } from '#/lib/latest-episodes'
import type { EpisodeFilters } from '#/lib/latest-episodes'
import type { PodcastLibrary } from '#/lib/podcast-library'

export type EpisodePageParam = { offset: number; searchSessionId?: string }

const firstEpisodePage: EpisodePageParam = { offset: 0, searchSessionId: undefined }

export type EpisodeScope = ReturnType<typeof episodeScope>

export function episodeScope(library: Pick<PodcastLibrary, 'podcasts'>) {
  return {
    podcasts: library.podcasts.map(({ podcast, categories }) => [podcast.id, categories] as const),
    // Progress polling in the library refreshes browsing without a second timer.
    // The final sync timestamp catches edits even when the episode count is unchanged.
    imports: library.podcasts.map(
      ({ podcast, sync }) => [podcast.id, sync?.episodes ?? 0, sync?.lastSyncedAt ?? null] as const,
    ),
  }
}

/**
 * Shared by the route loader (which prefetches the first page) and the page.
 *
 * The stale times are what make that prefetch worth anything: without them the page would refetch
 * the first page as soon as it hydrates. Browsing refreshes when library import progress
 * changes or on focus/manual refresh. Search snapshots ignore import progress.
 */
export function latestEpisodesQueryOptions(
  email: string,
  filters: EpisodeFilters,
  scope: EpisodeScope,
) {
  return infiniteQueryOptions({
    queryKey: [
      'latest-episodes',
      email,
      filters,
      scope.podcasts,
      filters.term ? null : scope.imports,
    ] as const,
    queryFn: ({ pageParam }) => getLatestEpisodes({ data: { ...filters, ...pageParam } }),
    initialPageParam: firstEpisodePage,
    getNextPageParam: (page): EpisodePageParam | undefined =>
      page.nextOffset === null
        ? undefined
        : { offset: page.nextOffset, searchSessionId: page.searchSessionId ?? undefined },
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: !filters.term,
    staleTime: filters.term ? 5 * 60_000 : 30_000,
  })
}
