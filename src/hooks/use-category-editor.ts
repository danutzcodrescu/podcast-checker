import { useState } from 'react'

import type { PodcastLibrary } from '#/lib/podcast-library'
import { categoryId } from '#/lib/podcast-library-input'

export function useCategoryEditor({
  categories,
  selected,
  pending,
}: {
  categories: PodcastLibrary['categories']
  selected: string[]
  pending: boolean
}) {
  const [query, setQuery] = useState('')
  const [names, setNames] = useState(selected)
  const [created, setCreated] = useState<string[]>([])
  // A library refresh can include a category created while this editor is open.
  // Keep its local label so the current selection stays consistent.
  const choices = [
    ...new Map(
      [...categories.map(({ name }) => name), ...created].map((name) => [categoryId(name), name]),
    ).values(),
  ]
  const normalizedQuery = categoryId(query)
  const matching = choices.filter((name) => categoryId(name).includes(normalizedQuery))
  const canCreate =
    Boolean(normalizedQuery) && !choices.some((name) => categoryId(name) === normalizedQuery)
  const canAdd = !pending && names.length < 50

  function canSelect(name: string) {
    return !pending && (names.includes(name) || names.length < 50)
  }

  function toggle(name: string) {
    if (!canSelect(name)) return
    setNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    )
  }

  function select(name: string, create = false) {
    if (!name || !canSelect(name)) return
    if (create) setCreated((current) => [...current, name])
    setNames((current) => (current.includes(name) ? current : [...current, name]))
    setQuery('')
  }

  function createCategory() {
    if (canCreate) select(query.trim(), true)
  }

  function selectQuery() {
    if (!normalizedQuery) return
    const found = choices.find((name) => categoryId(name) === normalizedQuery) ?? matching[0]
    select(found ?? query.trim(), !found)
  }

  return {
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
  }
}
