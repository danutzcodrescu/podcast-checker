import { describe, expect, it } from 'vitest'

import {
  defaultEpisodeFilters,
  episodeFiltersFromSearch,
  episodeSearchFromFilters,
  validateEpisodeSearch,
} from '#/lib/episode-search-params'

describe('episode search params', () => {
  it('keeps a default view out of the URL', () => {
    expect(validateEpisodeSearch({})).toEqual({})
    expect(episodeSearchFromFilters(defaultEpisodeFilters)).toEqual({})
  })

  it('coerces the filters a user can pick', () => {
    expect(
      validateEpisodeSearch({
        q: '  async code ',
        podcast: '123',
        category: 'development',
        days: '30',
        sort: 'relevance',
        mode: 'text',
      }),
    ).toEqual({
      q: 'async code',
      podcast: 123,
      category: 'development',
      days: 30,
      sort: 'relevance',
      mode: 'text',
    })
  })

  it.each([
    { podcast: '0' },
    { podcast: 'abc' },
    { category: '' },
    { days: '5' },
    { days: 'abc' },
    { sort: 'random' },
    { mode: 'magic' },
    { q: '   ' },
  ])('ignores an unsupported value and falls back to the default', (search) => {
    expect(validateEpisodeSearch(search)).toEqual({})
    expect(episodeFiltersFromSearch(validateEpisodeSearch(search))).toEqual(defaultEpisodeFilters)
  })

  it('round-trips every filter through the URL', () => {
    const filters = {
      podcastId: 123,
      categoryId: 'development',
      days: 90 as const,
      sort: 'oldest' as const,
      term: 'async code',
      searchMode: 'semantic' as const,
    }
    expect(
      episodeFiltersFromSearch(validateEpisodeSearch(episodeSearchFromFilters(filters))),
    ).toEqual(filters)
  })

  it('represents "all time" as days=all', () => {
    const filters = { ...defaultEpisodeFilters, days: null }
    expect(episodeSearchFromFilters(filters)).toEqual({ days: 'all' })
    expect(episodeFiltersFromSearch({ days: 'all' })).toEqual(filters)
  })

  it('drops relevance ordering when there is no search term', () => {
    expect(validateEpisodeSearch({ sort: 'relevance' })).toEqual({})
    expect(episodeFiltersFromSearch({ sort: 'relevance' })).toEqual(defaultEpisodeFilters)
    expect(episodeSearchFromFilters({ ...defaultEpisodeFilters, sort: 'relevance' })).toEqual({})
    expect(
      episodeSearchFromFilters({ ...defaultEpisodeFilters, term: 'x', sort: 'relevance' }),
    ).toEqual({ q: 'x', sort: 'relevance' })
  })

  it('keeps date ordering without a search term', () => {
    expect(validateEpisodeSearch({ sort: 'oldest' })).toEqual({ sort: 'oldest' })
    expect(episodeFiltersFromSearch({ sort: 'oldest' })).toEqual({
      ...defaultEpisodeFilters,
      sort: 'oldest',
    })
  })

  it('drops the search mode when there is no search term', () => {
    expect(validateEpisodeSearch({ mode: 'text' })).toEqual({})
    expect(episodeFiltersFromSearch({ mode: 'text' })).toEqual(defaultEpisodeFilters)
    expect(episodeSearchFromFilters({ ...defaultEpisodeFilters, searchMode: 'semantic' })).toEqual(
      {},
    )
    expect(
      episodeSearchFromFilters({ ...defaultEpisodeFilters, term: 'x', searchMode: 'semantic' }),
    ).toEqual({ q: 'x', mode: 'semantic' })
  })
})
