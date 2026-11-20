import { queryOptions } from '@tanstack/react-query'

import { getPodcastLibrary } from '#/lib/podcast-library'
import type { PodcastLibrary } from '#/lib/podcast-library'

function hasPendingImports(library: PodcastLibrary | undefined) {
  return (
    library?.podcasts.some(({ podcast, sync }) => {
      if (!podcast.feedUrl) return false
      if (!sync || sync.status === 'queued' || sync.status === 'syncing') return true
      return (
        sync.status === 'ready' &&
        sync.embeddingsEnabled &&
        sync.embedded + sync.failed < sync.episodes
      )
    }) ?? false
  )
}

/**
 * Shared by the route loaders (which prefetch it) and the library hook.
 *
 * Poll only while feed or embedding work is pending. Mutations update this cache and
 * restart polling; ordinary stale refetches on focus/reconnect pick up other tabs.
 * The stale time also prevents an immediate refetch after loader hydration.
 */
export function libraryQueryOptions(email: string) {
  return queryOptions({
    queryKey: ['podcast-library', email] as const,
    queryFn: () => getPodcastLibrary(),
    retry: false,
    refetchInterval: (query) =>
      query.state.status !== 'error' && hasPendingImports(query.state.data) ? 15_000 : false,
    staleTime: 15_000,
  })
}
