import { useQuery } from '@tanstack/react-query'
import { useHydrated } from '@tanstack/react-router'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button } from '#/components/ui/Button'
import { PodcastCard } from '#/components/PodcastCard'
import type { Podcast } from '#/lib/apple-podcasts'
import { searchPodcasts } from '#/lib/podcast-search'
import { m } from '#/paraglide/messages'

const searchStateClassName =
  'flex flex-col items-center gap-4 px-5 py-16 text-center wrap-anywhere mobile:px-0 mobile:py-12'
const searchStateIconClassName =
  'mb-1 grid size-16 place-items-center rounded-full bg-surface-muted text-surface-muted-foreground'

export function PodcastSearch({
  renderActions,
  getCategories,
}: {
  renderActions?: (podcast: Podcast) => ReactNode
  getCategories?: (podcast: Podcast) => string[]
}) {
  const hydrated = useHydrated()
  const [term, setTerm] = useState('')
  const [submittedTerm, setSubmittedTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    data: podcasts,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['podcast-search', submittedTerm],
    queryFn: ({ signal }) => searchPodcasts({ data: { term: submittedTerm }, signal }),
    enabled: Boolean(submittedTerm),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = term.trim()
    if (!query || isFetching) return
    if (query === submittedTerm && isError) void refetch()
    else setSubmittedTerm(query)
  }

  function clear() {
    setTerm('')
    setSubmittedTerm('')
    inputRef.current?.focus()
  }

  return (
    <section aria-labelledby="search-heading">
      <h1
        id="search-heading"
        className="m-0 text-page-title leading-tight font-bold tracking-tight"
      >
        {m.search_heading()}
      </h1>
      <p className="mt-3 mb-7 text-base text-muted-foreground">{m.search_subtitle()}</p>
      <search>
        <form className="flex gap-4 mobile:flex-col mobile:gap-3" onSubmit={submit}>
          <div className="flex min-w-0 flex-1 items-center gap-4 rounded-lg border border-input bg-white px-4 text-muted-foreground focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ring mobile:gap-3 mobile:px-3">
            <Search className="size-5 shrink-0" aria-hidden="true" />
            <input
              className="min-h-12 w-full min-w-0 flex-1 border-0 bg-transparent py-3 text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
              ref={inputRef}
              id="podcast-query"
              type="search"
              aria-label={m.search_label()}
              placeholder={m.search_placeholder()}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              maxLength={200}
              autoComplete="off"
              disabled={!hydrated}
            />
            {term && (
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent"
                aria-label={m.search_clear()}
                onClick={clear}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            className="w-auto min-w-32"
            disabled={!hydrated || !term.trim() || isFetching}
          >
            {isFetching && <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
            {m.search_button()}
          </Button>
        </form>
      </search>
      <p className="mt-3 mb-7 text-xs text-muted-foreground">{m.search_source()}</p>

      <div className="border-t border-border" aria-busy={isFetching}>
        <output
          className={
            isFetching
              ? searchStateClassName
              : submittedTerm && !isError && podcasts?.length
                ? 'mt-6 mb-4 block text-sm font-semibold wrap-anywhere'
                : 'sr-only'
          }
          aria-live="polite"
          aria-atomic="true"
        >
          {isFetching ? (
            <>
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              <span>{m.search_loading()}</span>
            </>
          ) : submittedTerm && !isError && podcasts ? (
            podcasts.length === 1 ? (
              m.search_result_one({ term: submittedTerm })
            ) : (
              m.search_result_many({ count: podcasts.length, term: submittedTerm })
            )
          ) : null}
        </output>
        {!isFetching && !submittedTerm ? (
          <div className={searchStateClassName}>
            <span className={searchStateIconClassName}>
              <Search className="size-7" aria-hidden="true" />
            </span>
            <h2 className="m-0 text-lg font-semibold">{m.search_empty_heading()}</h2>
            <p className="m-0 max-w-lg leading-relaxed text-muted-foreground">
              {m.search_empty_description()}
            </p>
          </div>
        ) : !isFetching && !isError && podcasts?.length === 0 ? (
          <div className={searchStateClassName}>
            <span className={searchStateIconClassName}>
              <Search className="size-7" aria-hidden="true" />
            </span>
            <h2 className="m-0 text-lg font-semibold">
              {m.search_no_results({ term: submittedTerm })}
            </h2>
            <p className="m-0 max-w-lg leading-relaxed text-muted-foreground">
              {m.search_no_results_hint()}
            </p>
          </div>
        ) : null}

        {isError && !isFetching && (
          <div className={searchStateClassName}>
            <p className="m-0 max-w-lg leading-relaxed text-destructive" role="alert">
              {m.search_error()}
            </p>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-foreground hover:bg-accent"
              onClick={() => void refetch()}
            >
              {m.search_retry()}
            </button>
          </div>
        )}

        {!isFetching && !isError && submittedTerm && podcasts && podcasts.length > 0 && (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label={m.search_results_label()}>
            {podcasts.map((podcast) => (
              <PodcastCard
                key={podcast.id}
                podcast={podcast}
                categories={getCategories?.(podcast)}
                actions={renderActions?.(podcast)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
