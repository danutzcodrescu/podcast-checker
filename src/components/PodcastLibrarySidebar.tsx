import { useHydrated } from '@tanstack/react-router'
import { ChevronDown, Library, Plus, Search } from 'lucide-react'
import { useId, useState } from 'react'

import { CategoryBadge, PodcastArtwork } from '#/components/PodcastCard'
import type { PodcastLibraryFilter } from '#/components/PodcastLibrary'
import { Button } from '#/components/ui/Button'
import { Input } from '#/components/ui/Input'
import type { LibraryPodcast, PodcastLibraryState } from '#/hooks/use-podcast-library'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

type LibraryNavigationProps = {
  library: PodcastLibraryState
  filter: PodcastLibraryFilter
  onFilterChange: (filter: PodcastLibraryFilter) => void
}

function LibraryCategories({ library, filter, onFilterChange }: LibraryNavigationProps) {
  const [addingCategory, setAddingCategory] = useState(false)
  const [categoryName, setCategoryName] = useState('')

  return (
    <div className="rounded-xl border border-card-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 text-base font-bold tracking-tight">{m.library_categories()}</h2>
      <ul className="grid list-none gap-1 p-0" aria-label={m.library_categories()}>
        {library.categories.map(({ id, name, count }) => (
          <li key={id}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`w-full justify-between px-2 text-left font-normal ${filter?.type === 'category' && filter.id === id ? 'bg-accent' : ''}`}
              aria-pressed={filter?.type === 'category' && filter.id === id}
              disabled={library.disabled}
              onClick={() => onFilterChange({ type: 'category', id })}
            >
              <CategoryBadge name={name} /> <span className="text-muted-foreground">{count}</span>
            </Button>
          </li>
        ))}
      </ul>
      {addingCategory ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            if (await library.createCategory(categoryName.trim())) {
              setCategoryName('')
              setAddingCategory(false)
            }
          }}
        >
          <Input
            className="h-10 rounded-lg"
            aria-label={m.library_category_name()}
            placeholder={m.library_category_name()}
            value={categoryName}
            maxLength={60}
            onChange={(event) => setCategoryName(event.target.value)}
            disabled={library.isSaving}
          />
          <div className="flex gap-3">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="px-0 text-link"
              disabled={!categoryName.trim() || library.isSaving}
            >
              {m.library_create()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-0 text-muted-foreground"
              disabled={library.isSaving}
              onClick={() => setAddingCategory(false)}
            >
              {m.library_cancel()}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 justify-start px-0 text-muted-foreground"
          disabled={library.disabled || library.isSaving}
          onClick={() => setAddingCategory(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          {m.library_new_category()}
        </Button>
      )}
    </div>
  )
}

export function PodcastLibrarySidebar({
  library,
  matches,
  filter,
  term,
  onTermChange,
  onFilterChange,
}: LibraryNavigationProps & {
  matches: LibraryPodcast[]
  term: string
  onTermChange: (term: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const hydrated = useHydrated()
  const selection =
    filter?.type === 'category'
      ? library.getCategoryName(filter.id)
      : filter?.type === 'podcast'
        ? library.podcasts.find(({ podcast }) => podcast.id === filter.id)?.podcast.title
        : null
  const status = library.isError
    ? m.library_load_error()
    : library.isPending
      ? m.library_loading()
      : selection

  return (
    <aside className="min-w-0" aria-label={m.library_sidebar()}>
      <Button
        type="button"
        variant="outline"
        className="hidden justify-between text-left tablet:flex"
        disabled={!hydrated}
        aria-label={m.library_toggle()}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-describedby={status ? `${contentId}-status` : undefined}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Library className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block">{m.library_toggle()}</span>
            {status && (
              <span
                id={`${contentId}-status`}
                className={cn(
                  'block text-xs font-normal',
                  library.isError ? 'text-destructive' : 'truncate text-muted-foreground',
                )}
              >
                {status}
              </span>
            )}
          </span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs">
            {library.podcasts.length}
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </Button>
      <div id={contentId} className={cn('grid gap-3 tablet:mt-3', !expanded && 'tablet:hidden')}>
        <div className="rounded-xl border border-card-border bg-surface p-4 shadow-card">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-3 min-h-11 w-full justify-start border-0 p-0 text-left text-base font-bold tracking-tight"
            disabled={library.disabled}
            onClick={() => onFilterChange({ type: 'all' })}
            aria-pressed={filter?.type === 'all'}
          >
            {m.library_followed()}{' '}
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-normal">
              {library.podcasts.length}
            </span>
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-white px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
              type="search"
              aria-label={m.library_filter()}
              placeholder={m.library_filter()}
              value={term}
              disabled={library.disabled}
              onChange={(event) => onTermChange(event.target.value)}
            />
          </div>
          {library.isPending ? (
            <output className="my-4 block text-muted-foreground">{m.library_loading()}</output>
          ) : library.isError ? (
            <div className="my-4">
              <p className="text-destructive" role="alert">
                {m.library_load_error()}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 min-h-0 px-0 py-0 text-link underline"
                onClick={() => void library.refetch()}
              >
                {m.search_retry()}
              </Button>
            </div>
          ) : (
            <ul
              className="my-4 grid max-h-96 list-none gap-3 overflow-y-auto p-0"
              aria-label={m.library_followed()}
            >
              {matches.map(({ podcast, categoryNames }) => (
                <li key={podcast.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-0 w-full justify-start gap-3 p-1 text-left font-normal aria-pressed:bg-accent"
                    disabled={library.disabled}
                    onClick={() => onFilterChange({ type: 'podcast', id: podcast.id })}
                    aria-pressed={filter?.type === 'podcast' && filter.id === podcast.id}
                  >
                    <PodcastArtwork podcast={podcast} small />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-3 text-xs leading-snug font-semibold wrap-anywhere">
                        {podcast.title}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {categoryNames.map((name) => (
                          <CategoryBadge key={name} name={name} />
                        ))}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="py-2 leading-relaxed text-muted-foreground">
                  {library.podcasts.length ? m.library_no_matches() : m.library_follow_hint()}
                </li>
              )}
            </ul>
          )}
        </div>
        <LibraryCategories library={library} filter={filter} onFilterChange={onFilterChange} />
      </div>
    </aside>
  )
}
