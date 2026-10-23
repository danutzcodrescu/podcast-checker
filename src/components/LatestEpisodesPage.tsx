import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EpisodeCard, episodeDayLabel } from '#/components/EpisodeCard'
import { EpisodeSearchForm } from '#/components/EpisodeSearchForm'
import { PodcastHero } from '#/components/PodcastHero'
import type { PodcastLibraryFilter } from '#/components/PodcastLibrary'
import { PodcastLibrarySidebar } from '#/components/PodcastLibrarySidebar'
import { PodcastPageShell } from '#/components/PodcastPageShell'
import { PocketCastsConnection } from '#/components/PocketCastsConnection'
import { Button } from '#/components/ui/Button'
import { NativeSelect } from '#/components/ui/NativeSelect'
import { usePodcastLibrary } from '#/hooks/use-podcast-library'
import { usePocketCasts } from '#/hooks/use-pocket-casts'
import type { EpisodeFilters, LatestEpisode } from '#/lib/latest-episodes'
import { episodeScope, latestEpisodesQueryOptions } from '#/lib/episode-queries'
import { episodeSearchExpired } from '#/lib/episode-search-input'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

export type OnEpisodeFiltersChange = (
  update: (current: EpisodeFilters) => EpisodeFilters,
  options?: { push?: boolean },
) => void

export function LatestEpisodesPage({
  email,
  filters,
  onFiltersChange,
}: {
  email: string
  filters: EpisodeFilters
  /**
   * Updates are functional so they never read the filters captured by the current render. A
   * navigation only commits after its transition, so changes made while it is pending must be
   * applied to the filters stored in the URL, not to the ones this render saw.
   */
  onFiltersChange: OnEpisodeFiltersChange
}) {
  const library = usePodcastLibrary(email)
  const pocketCasts = usePocketCasts(email)
  const [term, setTerm] = useState('')
  const normalizedTerm = term.trim().toLowerCase()
  const matches = useMemo(
    () =>
      library.podcasts.filter(({ searchFields }) =>
        searchFields.some((value) => value.includes(normalizedTerm)),
      ),
    [library.podcasts, normalizedTerm],
  )
  const filter: PodcastLibraryFilter =
    filters.podcastId !== null
      ? { type: 'podcast', id: filters.podcastId }
      : filters.categoryId !== null
        ? { type: 'category', id: filters.categoryId }
        : { type: 'all' }
  function onFilterChange(next: PodcastLibraryFilter) {
    onFiltersChange((current) => ({
      ...current,
      podcastId: next?.type === 'podcast' ? next.id : null,
      categoryId: next?.type === 'category' ? next.id : null,
    }))
  }
  // Same shape the route loader derives from the prefetched library, so the query key matches.
  const episodesScope = useMemo(() => episodeScope(library.source), [library.source])
  const episodes = useInfiniteQuery({
    ...latestEpisodesQueryOptions(email, filters, episodesScope),
    enabled: !library.disabled,
  })
  const locale = getLocale()
  const groups = useMemo(() => {
    const result = new Map<string, LatestEpisode[]>()
    for (const page of episodes.data?.pages ?? []) {
      for (const episode of page.episodes) {
        const label =
          filters.term && filters.sort === 'relevance'
            ? m.episodes_search_results()
            : episodeDayLabel(episode.publishedAt, locale, episodes.dataUpdatedAt)
        const group = result.get(label) ?? []
        group.push(episode)
        result.set(label, group)
      }
    }
    return [...result.entries()]
  }, [episodes.data, episodes.dataUpdatedAt, locale, filters.term, filters.sort])

  // A shared link can name a podcast or tag that is not in this account's library. Drop it once
  // the library is known so the controls and the URL describe the same view.
  const libraryLoaded = !library.isPending && !library.isError
  const unknownPodcast =
    libraryLoaded &&
    filters.podcastId !== null &&
    !library.podcasts.some(({ podcast }) => podcast.id === filters.podcastId)
  const unknownCategory =
    libraryLoaded &&
    filters.categoryId !== null &&
    !library.categories.some(({ id }) => id === filters.categoryId)

  useEffect(() => {
    if (!unknownPodcast && !unknownCategory) return
    onFiltersChange((current) => ({
      ...current,
      podcastId: unknownPodcast ? null : current.podcastId,
      categoryId: unknownCategory ? null : current.categoryId,
    }))
  }, [unknownPodcast, unknownCategory, onFiltersChange])

  return (
    <PodcastPageShell email={email} activeTab="latest-episodes">
      <div className="grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-6 tablet:grid-cols-1 tablet:gap-5">
        <PodcastLibrarySidebar
          library={library}
          matches={matches}
          filter={filter}
          term={term}
          onTermChange={setTerm}
          onFilterChange={onFilterChange}
        />
        <section className="min-w-0" aria-labelledby="episodes-heading">
          <PodcastHero
            headingId="episodes-discovery-heading"
            eyebrow={m.discovery_eyebrow()}
            title={m.episodes_hero_heading()}
            description={m.episodes_hero_description()}
          />
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 id="episodes-heading" className="text-2xl font-bold tracking-tight">
                {m.episodes_heading()}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{m.episodes_subtitle()}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label={m.episodes_refresh()}
              disabled={library.disabled || episodes.isFetching}
              onClick={() => {
                void library.refetch()
                void episodes.refetch()
              }}
            >
              <RefreshCw
                className={`size-5 ${episodes.isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </div>
          <PocketCastsConnection integration={pocketCasts} />
          <EpisodeSearchForm
            searchTerm={filters.term}
            searchMode={filters.searchMode}
            active={Boolean(filters.term)}
            pending={episodes.isFetching}
            disabled={library.disabled}
            onSearch={(query, searchMode) => {
              if (
                filters.term === query &&
                filters.searchMode === searchMode &&
                filters.sort === 'relevance'
              ) {
                void episodes.refetch()
              } else {
                onFiltersChange(
                  (current) => ({
                    ...current,
                    term: query,
                    searchMode,
                    sort: 'relevance',
                  }),
                  // A search is a deliberate destination: Back should return to the list the user
                  // was browsing. Dropdown and sidebar changes replace instead.
                  { push: true },
                )
              }
            }}
            onClear={() =>
              onFiltersChange((current) => ({
                ...current,
                term: '',
                sort: current.sort === 'relevance' ? 'newest' : current.sort,
              }))
            }
          />
          {library.isSaveError && (
            <p className="mb-4 rounded-lg bg-destructive-soft p-3 text-destructive" role="alert">
              {m.library_save_error()}
            </p>
          )}
          <div className="mb-4 grid grid-cols-4 gap-3 laptop:grid-cols-2">
            <label className="min-w-0 [&>div]:w-full">
              <span className="sr-only">{m.episodes_podcast_filter()}</span>
              <NativeSelect
                className="h-12 rounded-lg bg-surface"
                value={filters.podcastId ?? ''}
                disabled={library.disabled}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    podcastId: event.target.value ? Number(event.target.value) : null,
                  }))
                }
              >
                <option value="">{m.episodes_all_podcasts()}</option>
                {library.podcasts.map(({ podcast }) => (
                  <option key={podcast.id} value={podcast.id}>
                    {podcast.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="min-w-0 [&>div]:w-full">
              <span className="sr-only">{m.episodes_tag_filter()}</span>
              <NativeSelect
                className="h-12 rounded-lg bg-surface"
                value={filters.categoryId ?? ''}
                disabled={library.disabled}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    categoryId: event.target.value || null,
                  }))
                }
              >
                <option value="">{m.episodes_all_tags()}</option>
                {library.categories.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="min-w-0 [&>div]:w-full">
              <span className="sr-only">{m.episodes_date_filter()}</span>
              <NativeSelect
                className="h-12 rounded-lg bg-surface"
                value={filters.days ?? ''}
                disabled={library.disabled}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    days: event.target.value
                      ? (Number(event.target.value) as EpisodeFilters['days'])
                      : null,
                  }))
                }
              >
                {[7, 30, 90].map((days) => (
                  <option key={days} value={days}>
                    {m.episodes_last_days({ count: days })}
                  </option>
                ))}
                <option value="">{m.episodes_all_time()}</option>
              </NativeSelect>
            </label>
            <label className="min-w-0 [&>div]:w-full">
              <span className="sr-only">{m.episodes_sort()}</span>
              <NativeSelect
                className="h-12 rounded-lg bg-surface"
                value={filters.sort}
                disabled={library.disabled}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    sort: event.target.value as EpisodeFilters['sort'],
                  }))
                }
              >
                {filters.term && <option value="relevance">{m.episodes_relevance()}</option>}
                <option value="newest">{m.episodes_newest()}</option>
                <option value="oldest">{m.episodes_oldest()}</option>
              </NativeSelect>
            </label>
          </div>
          <output className="mb-5 block text-muted-foreground" aria-live="polite">
            {episodes.data &&
              (filters.term
                ? m.episodes_search_count({
                    count: episodes.data.pages[0].total,
                    term: filters.term,
                  })
                : m.episodes_count({ count: episodes.data.pages[0].total }))}
          </output>
          {filters.term && episodes.data?.pages[0].semanticUnavailable && (
            <output className="mb-4 block rounded-lg bg-accent p-3 text-sm">
              {m.episodes_semantic_unavailable()}
            </output>
          )}
          {filters.term && filters.sort === 'relevance' && episodes.data?.pages[0].ranking && (
            <output className="mb-4 block rounded-lg bg-accent p-3 text-sm">
              {episodes.data.pages[0].ranking.status === 'applied'
                ? m.episodes_ranking_applied({ model: episodes.data.pages[0].ranking.model })
                : episodes.data.pages[0].ranking.status === 'fallback'
                  ? m.episodes_ranking_fallback()
                  : m.episodes_ranking_baseline()}
            </output>
          )}
          {episodes.isError && (
            <div className="mb-4 rounded-lg bg-destructive-soft p-4" role="alert">
              <p className="text-destructive">
                {episodes.error?.message === episodeSearchExpired
                  ? m.episodes_search_expired()
                  : filters.term && filters.searchMode === 'semantic'
                    ? m.episodes_semantic_error()
                    : m.episodes_error()}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 px-0 text-link"
                onClick={() => {
                  if (
                    episodes.isFetchNextPageError &&
                    episodes.error?.message !== episodeSearchExpired
                  )
                    void episodes.fetchNextPage()
                  else void episodes.refetch()
                }}
              >
                {m.search_retry()}
              </Button>
            </div>
          )}
          {library.isPending || (episodes.isPending && !library.isError) ? (
            <output className="block py-10 text-center text-muted-foreground">
              {m.episodes_loading()}
            </output>
          ) : (
            !library.isError && (
              <>
                {groups.map(([label, items]) => (
                  <section key={label} className="mb-6" aria-label={label}>
                    <h2 className="mb-3 text-lg font-bold">{label}</h2>
                    <ul className="grid list-none gap-3 p-0">
                      {items.map((episode) => (
                        <EpisodeCard
                          key={episode.id}
                          episode={episode}
                          now={episodes.dataUpdatedAt}
                          pocketCasts={pocketCasts}
                          categories={episode.categories.flatMap((id) => {
                            const name = library.getCategoryName(id)
                            return name ? [name] : []
                          })}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
                {groups.length === 0 && !episodes.isError && (
                  <div className="rounded-xl border border-border bg-surface p-8 text-center">
                    <h2 className="text-lg font-bold">
                      {filters.term
                        ? m.episodes_search_empty({ term: filters.term })
                        : m.episodes_empty_heading()}
                    </h2>
                    <p className="mt-2 leading-relaxed text-muted-foreground">
                      {filters.term
                        ? m.episodes_search_empty_hint()
                        : library.podcasts.length
                          ? m.episodes_empty_filters()
                          : m.library_follow_hint()}
                    </p>
                    {!library.podcasts.length && (
                      <Link to="/discover" className="mt-4 inline-block text-link underline">
                        {m.search_discover_tab()}
                      </Link>
                    )}
                  </div>
                )}
                {episodes.hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={episodes.isFetching}
                      onClick={() => void episodes.fetchNextPage()}
                    >
                      {episodes.isFetchingNextPage ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      )}
                      {m.episodes_load_more()}
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </section>
      </div>
    </PodcastPageShell>
  )
}
