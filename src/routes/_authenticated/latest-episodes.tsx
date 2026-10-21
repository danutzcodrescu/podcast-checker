import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

import { LatestEpisodesPage } from '#/components/LatestEpisodesPage'
import type { OnEpisodeFiltersChange } from '#/components/LatestEpisodesPage'
import { episodeScope, latestEpisodesQueryOptions } from '#/lib/episode-queries'
import {
  episodeFiltersFromSearch,
  episodeSearchFromFilters,
  validateEpisodeSearch,
} from '#/lib/episode-search-params'
import { libraryQueryOptions } from '#/lib/library-queries'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_authenticated/latest-episodes')({
  validateSearch: validateEpisodeSearch,
  loaderDeps: ({ search }) => episodeFiltersFromSearch(search),
  loader: async ({ context, deps }) => {
    const { email } = context.user
    try {
      const library = await context.queryClient.query(libraryQueryOptions(email))
      const options = latestEpisodesQueryOptions(email, deps, episodeScope(library))
      if (!import.meta.env.SSR) {
        // Client navigations must not wait on the network; the page keeps its loading state.
        void context.queryClient.infiniteQuery(options).catch(() => undefined)
      } else if (!deps.term) {
        // A server render waits for the feed, but a search can call the embedding API, so the
        // browser fetches search results behind the loading state instead of blocking first paint.
        await context.queryClient.infiniteQuery(options)
      }
    } catch {
      // Keep the page mounted; it shows its inline load error and retries on mount. This module
      // also runs in the browser, so it cannot use the server-only logger here.
    }
  },
  head: () => ({ meta: [{ title: m.episodes_title() }] }),
  component: LatestEpisodes,
})

function LatestEpisodes() {
  const { user } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const filters = useMemo(() => episodeFiltersFromSearch(search), [search])
  const onFiltersChange = useCallback<OnEpisodeFiltersChange>(
    (update, options) => {
      void navigate({
        search: (previous) => episodeSearchFromFilters(update(episodeFiltersFromSearch(previous))),
        // A filter change replaces the entry so the back button skips a trail of dropdown
        // states; submitting a search pushes so Back returns to the list being browsed.
        replace: !options?.push,
        resetScroll: false,
      })
    },
    [navigate],
  )

  return (
    <LatestEpisodesPage email={user.email} filters={filters} onFiltersChange={onFiltersChange} />
  )
}
