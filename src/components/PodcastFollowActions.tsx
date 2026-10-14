import { Check, Pencil, Plus, Tag, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '#/components/ui/Button'
import { Checkbox } from '#/components/ui/Checkbox'
import { Input } from '#/components/ui/Input'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '#/components/ui/Popover'
import { useCategoryEditor } from '#/hooks/use-category-editor'
import type { Podcast } from '#/lib/apple-podcasts'
import type { PodcastLibrary } from '#/lib/podcast-library'
import { categoryId } from '#/lib/podcast-library-input'
import { m } from '#/paraglide/messages'

function CategoryEditor({
  categories,
  selected,
  pending,
  followed,
  onClose,
  onSave,
}: {
  categories: PodcastLibrary['categories']
  selected: string[]
  pending: boolean
  followed: boolean
  onClose: () => void
  onSave: (names: string[]) => Promise<boolean>
}) {
  const {
    query,
    setQuery,
    names,
    choices,
    matching,
    canCreate,
    canAdd,
    canSelect,
    toggle,
    createCategory,
    selectQuery,
  } = useCategoryEditor({ categories, selected, pending })
  const headingId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <PopoverContent align="end" aria-labelledby={headingId} initialFocus={inputRef}>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (await onSave(names)) onClose()
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id={headingId} className="font-semibold">
            {m.library_add_categories()}
          </h3>
          <PopoverClose
            render={<Button type="button" variant="ghost" size="icon" />}
            aria-label={m.library_close_categories()}
            disabled={pending}
          >
            <X className="size-4" aria-hidden="true" />
          </PopoverClose>
        </div>
        <Input
          ref={inputRef}
          className="mb-3 h-10 rounded-lg"
          type="search"
          aria-label={m.library_find_category()}
          placeholder={m.library_find_category()}
          value={query}
          maxLength={60}
          onChange={(event) => setQuery(event.target.value)}
          disabled={pending}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (!event.nativeEvent.isComposing) selectQuery()
          }}
        />
        <div className="mb-3 max-h-60 overflow-y-auto">
          {matching.map((name, index) => (
            <label
              key={categoryId(name)}
              htmlFor={`${headingId}-category-${index}`}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 hover:bg-accent"
            >
              <Checkbox
                id={`${headingId}-category-${index}`}
                checked={names.includes(name)}
                onCheckedChange={() => toggle(name)}
                disabled={!canSelect(name)}
              />
              <span className="min-w-0 wrap-anywhere">{name}</span>
            </label>
          ))}
          {canCreate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 w-full justify-start px-1 py-0 text-left font-normal text-link"
              disabled={!canAdd}
              onClick={createCategory}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span className="wrap-anywhere">
                {m.library_create_category({ name: query.trim() })}
              </span>
            </Button>
          )}
          {choices.length === 0 && !query.trim() && (
            <p className="text-sm text-muted-foreground">{m.library_categories_hint()}</p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {pending
            ? m.library_saving()
            : followed
              ? m.library_save_categories()
              : m.library_follow_save()}
        </Button>
      </form>
    </PopoverContent>
  )
}

export function PodcastFollowActions({
  podcast,
  categories,
  selected,
  followed,
  disabled,
  pending,
  onSave,
  onUnfollow,
}: {
  podcast: Podcast
  categories: PodcastLibrary['categories']
  selected: string[]
  followed: boolean
  disabled: boolean
  pending: boolean
  onSave: (podcast: Podcast, names: string[]) => Promise<boolean>
  onUnfollow: (id: number) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex w-40 flex-col gap-2">
      <Button
        type="button"
        variant={followed ? 'outline' : 'default'}
        size="sm"
        className="w-full"
        disabled={disabled || pending}
        aria-label={
          followed
            ? m.library_unfollow_label({ title: podcast.title })
            : m.library_follow_label({ title: podcast.title })
        }
        onClick={() => {
          void (followed ? onUnfollow(podcast.id) : onSave(podcast, []))
        }}
      >
        {followed ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        {followed ? m.library_following() : m.library_follow()}
      </Button>
      <Popover
        open={open}
        onOpenChange={(nextOpen, eventDetails) => {
          if (pending) eventDetails.cancel()
          else setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          render={<Button type="button" variant="outline" size="sm" className="w-full" />}
          disabled={disabled || pending}
          aria-label={
            followed
              ? m.library_edit_tags_label({ title: podcast.title })
              : m.library_add_tags_label({ title: podcast.title })
          }
        >
          {followed ? (
            <Pencil className="size-4" aria-hidden="true" />
          ) : (
            <Tag className="size-4" aria-hidden="true" />
          )}
          {followed ? m.library_edit_tags() : m.library_add_tags()}
        </PopoverTrigger>
        {open && (
          <CategoryEditor
            categories={categories}
            selected={selected}
            pending={pending}
            followed={followed}
            onClose={() => setOpen(false)}
            onSave={(names) => onSave(podcast, names)}
          />
        )}
      </Popover>
    </div>
  )
}
