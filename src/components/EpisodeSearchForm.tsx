import { LoaderCircle, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '#/components/ui/Button'
import { NativeSelect } from '#/components/ui/NativeSelect'
import type { EpisodeSearchMode } from '#/lib/latest-episodes'
import { m } from '#/paraglide/messages'

export function EpisodeSearchForm({
  active,
  pending,
  disabled,
  onSearch,
  onClear,
}: {
  active: boolean
  pending: boolean
  disabled: boolean
  onSearch: (term: string, mode: EpisodeSearchMode) => void
  onClear: () => void
}) {
  const [term, setTerm] = useState('')
  const [mode, setMode] = useState<EpisodeSearchMode>('hybrid')
  const inputRef = useRef<HTMLInputElement>(null)
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
            maxLength={200}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setTerm(event.target.value)}
          />
          {(term || active) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={m.episodes_search_clear()}
              onClick={() => {
                setTerm('')
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
            onChange={(event) => setMode(event.target.value as EpisodeSearchMode)}
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
