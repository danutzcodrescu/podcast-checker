import { ArrowLeft } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { PodcastCard } from '#/components/PodcastCard'
import { PodcastFollowActions } from '#/components/PodcastFollowActions'
import { PodcastLibrarySidebar } from '#/components/PodcastLibrarySidebar'
import { PodcastSearch } from '#/components/PodcastSearch'
import { Button } from '#/components/ui/Button'
import { usePodcastLibrary } from '#/hooks/use-podcast-library'
import type { Podcast } from '#/lib/apple-podcasts'
import { m } from '#/paraglide/messages'

export type PodcastLibraryFilter =
  | { type: 'all' }
  | { type: 'category'; id: string }
  | { type: 'podcast'; id: number }
  | null

export function PodcastLibrary({
  email,
  filter,
  onFilterChange,
}: {
  email: string
  filter: PodcastLibraryFilter
  onFilterChange: (filter: PodcastLibraryFilter) => void
}) {
  const library = usePodcastLibrary(email)
  const {
    podcasts,
    categories,
    getCategories,
    isFollowed,
    disabled,
    isSaving,
    savePodcast,
    unfollow,
  } = library
  const [term, setTerm] = useState('')
  const normalizedTerm = term.trim().toLowerCase()
  const matches = useMemo(
    () =>
      normalizedTerm
        ? podcasts.filter(({ searchFields }) =>
            searchFields.some((value) => value.includes(normalizedTerm)),
          )
        : podcasts,
    [podcasts, normalizedTerm],
  )
  const filtered = useMemo(() => {
    if (!filter || filter.type === 'all') return matches
    return matches.filter(({ podcast, categoryIds }) =>
      filter.type === 'category' ? categoryIds.includes(filter.id) : podcast.id === filter.id,
    )
  }, [matches, filter])

  const renderActions = useCallback(
    (podcast: Podcast) => (
      <PodcastFollowActions
        podcast={podcast}
        categories={categories}
        selected={getCategories(podcast)}
        followed={isFollowed(podcast)}
        disabled={disabled}
        pending={isSaving}
        onSave={savePodcast}
        onUnfollow={unfollow}
      />
    ),
    [categories, getCategories, isFollowed, disabled, isSaving, savePodcast, unfollow],
  )

  return (
    <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-8 tablet:grid-cols-1 tablet:gap-6">
      <PodcastLibrarySidebar
        library={library}
        matches={matches}
        filter={filter}
        term={term}
        onTermChange={setTerm}
        onFilterChange={onFilterChange}
      />
      <div className="min-w-0">
        {library.isSaveError && (
          <p className="mb-4 rounded-lg bg-destructive-soft p-3 text-destructive" role="alert">
            {m.library_save_error()}
          </p>
        )}
        <div hidden={filter !== null}>
          <PodcastSearch renderActions={renderActions} getCategories={getCategories} />
        </div>
        {filter !== null && (
          <section aria-labelledby="library-heading">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-5 justify-start px-0 text-link"
              onClick={() => {
                onFilterChange(null)
                setTerm('')
              }}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {m.library_back_discover()}
            </Button>
            <h1 id="library-heading" className="mb-3 text-page-title font-bold tracking-tight">
              {filter.type === 'category'
                ? library.getCategoryName(filter.id)
                : m.library_heading()}
            </h1>
            <p className="mb-6 text-muted-foreground">
              {m.library_count({ count: filtered.length })}
            </p>
            {filtered.length ? (
              <ul className="grid list-none gap-3 p-0" aria-label={m.library_results()}>
                {filtered.map(({ podcast, categoryNames }) => (
                  <PodcastCard
                    key={podcast.id}
                    podcast={podcast}
                    categories={categoryNames}
                    actions={renderActions(podcast)}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-border p-8 text-center text-muted-foreground">
                {m.library_no_matches()}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
