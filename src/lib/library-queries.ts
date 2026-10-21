import { queryOptions } from '@tanstack/react-query'

import { getPodcastLibrary } from '#/lib/podcast-library'

/**
 * Shared by the route loaders (which prefetch it) and the library hook.
 *
 * `staleTime` matches the poll interval so a prefetched library is not refetched the moment the
 * page hydrates; `refetchInterval` still picks up imports that started in another tab.
 */
export function libraryQueryOptions(email: string) {
  return queryOptions({
    queryKey: ['podcast-library', email] as const,
    queryFn: () => getPodcastLibrary(),
    retry: false,
    refetchInterval: 15_000,
    staleTime: 15_000,
  })
}
