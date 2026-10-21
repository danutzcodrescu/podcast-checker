import type { EpisodeFilters, EpisodeSearchMode } from '#/lib/latest-episodes'
import {
  episodeCategoryMaxLength,
  episodeDays,
  episodeModes,
  episodeSorts,
  episodeTermMaxLength,
} from '#/lib/episode-search-input'
import type { EpisodeDay } from '#/lib/episode-search-input'

/**
 * The latest-episodes view: everything that changes the result set lives in the URL so
 * a link, a reload, or the back button restores it. Defaults are omitted to keep URLs short.
 *
 * `q` is the episode search term, `days=all` means no date limit.
 */
export type EpisodeSearchParams = {
  q?: string
  podcast?: number
  category?: string
  days?: EpisodeDay | 'all'
  sort?: (typeof episodeSorts)[number]
  mode?: EpisodeSearchMode
}

export const defaultEpisodeFilters: EpisodeFilters = {
  podcastId: null,
  categoryId: null,
  days: 7,
  sort: 'newest',
  term: '',
  searchMode: 'hybrid',
}

/** Relevance only orders search results; without a term there is nothing to rank against. */
function sortFor(term: string, sort: EpisodeFilters['sort']): EpisodeFilters['sort'] {
  return term || sort !== 'relevance' ? sort : 'newest'
}

/** Coerces raw URL values and drops anything unrecognised, so the URL is the source of truth. */
export function validateEpisodeSearch(search: Record<string, unknown>): EpisodeSearchParams {
  const params: EpisodeSearchParams = {}

  if (typeof search.q === 'string' && search.q.trim())
    params.q = search.q.trim().slice(0, episodeTermMaxLength)

  const podcast = Number(search.podcast)
  if (Number.isInteger(podcast) && podcast > 0) params.podcast = podcast

  if (typeof search.category === 'string' && search.category)
    params.category = search.category.slice(0, episodeCategoryMaxLength)

  if (search.days === 'all') params.days = 'all'
  else {
    const days = Number(search.days)
    if ((episodeDays as readonly number[]).includes(days)) params.days = days as EpisodeDay
  }

  if (search.sort === 'oldest' || (search.sort === 'relevance' && params.q))
    params.sort = search.sort
  if (params.q && (episodeModes as readonly string[]).includes(search.mode as string))
    params.mode = search.mode as EpisodeSearchMode

  return params
}

export function episodeFiltersFromSearch(search: EpisodeSearchParams): EpisodeFilters {
  const term = search.q ?? defaultEpisodeFilters.term

  return {
    podcastId: search.podcast ?? defaultEpisodeFilters.podcastId,
    categoryId: search.category ?? defaultEpisodeFilters.categoryId,
    days: search.days === 'all' ? null : (search.days ?? defaultEpisodeFilters.days),
    sort: sortFor(term, search.sort ?? defaultEpisodeFilters.sort),
    term,
    // The mode only describes a search, so a view without a term uses the default.
    searchMode: term
      ? (search.mode ?? defaultEpisodeFilters.searchMode)
      : defaultEpisodeFilters.searchMode,
  }
}

export function episodeSearchFromFilters(filters: EpisodeFilters): EpisodeSearchParams {
  const search: EpisodeSearchParams = {}
  const term = filters.term.trim()

  if (term) {
    search.q = term
    const sort = sortFor(term, filters.sort)
    if (sort !== defaultEpisodeFilters.sort) search.sort = sort
    if (filters.searchMode !== defaultEpisodeFilters.searchMode) search.mode = filters.searchMode
  } else if (filters.sort === 'oldest') {
    search.sort = filters.sort
  }

  if (filters.podcastId !== null) search.podcast = filters.podcastId
  if (filters.categoryId !== null) search.category = filters.categoryId
  if (filters.days === null) search.days = 'all'
  else if (filters.days !== defaultEpisodeFilters.days) search.days = filters.days

  return search
}
