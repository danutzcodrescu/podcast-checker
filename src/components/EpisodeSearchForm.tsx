import { LoaderCircle, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '#/components/ui/Button'
import { NativeSelect } from '#/components/ui/NativeSelect'
import { episodeTermMaxLength } from '#/lib/episode-search-input'
import type { EpisodeSearchMode } from '#/lib/latest-episodes'
import { m } from '#/paraglide/messages'

type SearchDraft = {
  term: string
  mode: EpisodeSearchMode
}

export function EpisodeSearchForm({
  searchTerm,
  searchMode,
  active,
  pending,
  disabled,
  onSearch,
  onClear,
}: {
  searchTerm: string
  searchMode: EpisodeSearchMode
  active: boolean
  pending: boolean
  disabled: boolean
  onSearch: (term: string, mode: EpisodeSearchMode) => void
  onClear: () => void
}) {
  // The submitted search lives in the URL; keep a draft so typing does not navigate. Any change to
  // the submitted values (submit, back/forward, a shared link) drops the draft, so the form always
  // reflects the URL again — including when the URL returns to the state the draft was typed in.
  const [draft, setDraft] = useState<SearchDraft | null>(null)
  const [submitted, setSubmitted] = useState({ searchTerm, searchMode })
  if (submitted.searchTerm !== searchTerm || submitted.searchMode !== searchMode) {
    setSubmitted({ searchTerm, searchMode })
    setDraft(null)
  }
  const term = draft ? draft.term : searchTerm
  const mode = draft ? draft.mode : searchMode
  const inputRef = useRef<HTMLInputElement>(null)
  function draftFor(patch: Partial<SearchDraft>): SearchDraft {
    return { term, mode, ...patch }
  }
  return (
    <search className="mb-6" aria-label={m.episodes_search_label()}>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (term.trim() && !pending && !disabled) onSearch(term.trim(), mode)
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-input bg-white px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ring mobile:basis-full">
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="min-h-12 w-full min-w-0 border-0 bg-transparent py-3 text-base outline-none [&::-webkit-search-cancel-button]:appearance-none"
            aria-label={m.episodes_search_label()}
            aria-describedby="episodes-search-help"
            placeholder={m.episodes_search_placeholder()}
            value={term}
            maxLength={episodeTermMaxLength}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setDraft(draftFor({ term: event.target.value }))}
          />
          {(term || active) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={m.episodes_search_clear()}
              onClick={() => {
                setDraft(draftFor({ term: '' }))
                onClear()
                inputRef.current?.focus()
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <label className="min-w-0 mobile:flex-1 mobile:[&>div]:w-full">
          <span className="sr-only">{m.episodes_search_mode()}</span>
          <NativeSelect
            className="h-12 rounded-lg bg-surface"
            value={mode}
            disabled={disabled}
            onChange={(event) =>
              setDraft(draftFor({ mode: event.target.value as EpisodeSearchMode }))
            }
          >
            <option value="hybrid">{m.episodes_search_hybrid()}</option>
            <option value="text">{m.episodes_search_text()}</option>
            <option value="semantic">{m.episodes_search_semantic()}</option>
          </NativeSelect>
        </label>
        <Button
          type="submit"
          className="h-12 w-auto"
          disabled={disabled || pending || !term.trim()}
        >
          {pending && active && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {m.search_button()}
        </Button>
      </form>
      <p id="episodes-search-help" className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {m.episodes_search_help()}
      </p>
    </search>
  )
}
