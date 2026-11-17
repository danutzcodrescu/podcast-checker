import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { episodeScope, latestEpisodesQueryOptions } from './episode-queries'
import { defaultEpisodeFilters } from './episode-search-params'
import { libraryQueryOptions } from './library-queries'
import type { PodcastLibrary } from './podcast-library'
import type { PodcastSync } from './podcast-sync'

const mocks = vi.hoisted(() => ({ library: vi.fn(), episodes: vi.fn() }))
vi.mock('./podcast-library', () => ({ getPodcastLibrary: mocks.library }))
vi.mock('./latest-episodes', () => ({ getLatestEpisodes: mocks.episodes }))

const email = 'listener@example.com'
const complete: PodcastSync = {
  status: 'ready',
  episodes: 10,
  embedded: 10,
  failed: 0,
  lastSyncedAt: '2026-11-17T10:00:00.000Z',
}
const cleanups: Array<() => void> = []

function library(
  sync: PodcastSync | null,
  feedUrl: string | null = 'https://example.com/rss',
): PodcastLibrary {
  return {
    podcasts: [
      {
        podcast: {
          id: 1,
          title: 'History',
          publisher: '',
          appleUrl: 'https://example.com',
          feedUrl,
          artworkUrl: null,
        },
        categories: [],
        sync,
      },
    ],
    categories: [],
  }
}

async function observeLibrary(data: PodcastLibrary) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  client.mount()
  const options = libraryQueryOptions(email)
  mocks.library.mockResolvedValue(data)
  await client.query(options)
  const observer = new QueryObserver(client, options)
  const unsubscribe = observer.subscribe(() => undefined)
  cleanups.push(() => {
    unsubscribe()
    client.unmount()
    client.clear()
  })
  mocks.library.mockClear()
  return client
}

function browsingKey(sync: PodcastSync) {
  return latestEpisodesQueryOptions(email, defaultEpisodeFilters, episodeScope(library(sync)))
    .queryKey
}

beforeEach(() => {
  vi.useFakeTimers()
  focusManager.setFocused(true)
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

describe('database-friendly query refresh', () => {
  it.each([
    ['complete', library(complete)],
    ['empty', { podcasts: [], categories: [] }],
    ['no feed', library(null, null)],
    ['failed feed', library({ ...complete, status: 'failed', embedded: 0 })],
    ['failed embeddings awaiting retry', library({ ...complete, embedded: 8, failed: 2 })],
  ])('does not poll a library that is %s', async (_label, data) => {
    await observeLibrary(data)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.library).not.toHaveBeenCalled()
  })

  it.each([
    ['queued', { ...complete, status: 'queued' }],
    ['syncing', { ...complete, status: 'syncing' }],
    ['embedding', { ...complete, embedded: 5 }],
    ['partially failed with pending embeddings', { ...complete, embedded: 5, failed: 2 }],
    ['not yet linked', null],
  ] satisfies Array<[string, PodcastSync | null]>)(
    'polls while %s, then stops on completion',
    async (_label, sync) => {
      await observeLibrary(library(sync))
      mocks.library.mockResolvedValue(library(complete))
      await vi.advanceTimersByTimeAsync(15_000)
      expect(mocks.library).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mocks.library).toHaveBeenCalledOnce()
    },
  )

  it('resumes progress polling after a mutation queues an import', async () => {
    const client = await observeLibrary(library(complete))
    client.setQueryData(
      libraryQueryOptions(email).queryKey,
      library({ ...complete, status: 'queued' }),
    )
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.library).toHaveBeenCalledOnce()
  })

  it('does not repeatedly poll after a request fails', async () => {
    await observeLibrary(library({ ...complete, status: 'queued' }))
    mocks.library.mockRejectedValue(new Error('Database unavailable'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.library).toHaveBeenCalledOnce()
  })

  it('still refreshes a completed library on focus after it becomes stale', async () => {
    await observeLibrary(library(complete))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.library).not.toHaveBeenCalled()
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.library).toHaveBeenCalledOnce()
  })

  it('does not give episode browsing its own polling timer', () => {
    expect(
      latestEpisodesQueryOptions(email, defaultEpisodeFilters, episodeScope(library(complete)))
        .refetchInterval,
    ).toBe(false)
  })

  it('refreshes browsing when imports progress, including the final successful sync', () => {
    expect(browsingKey({ ...complete, episodes: 11 })).not.toEqual(browsingKey(complete))
    expect(browsingKey({ ...complete, lastSyncedAt: '2026-11-17T11:00:00.000Z' })).not.toEqual(
      browsingKey(complete),
    )
    expect(browsingKey({ ...complete, status: 'syncing' })).toEqual(browsingKey(complete))
  })

  it('keeps a search snapshot stable while imports progress', () => {
    const filters = { ...defaultEpisodeFilters, term: 'history' }
    const key = (sync: PodcastSync) =>
      latestEpisodesQueryOptions(email, filters, episodeScope(library(sync))).queryKey
    expect(key({ ...complete, episodes: 11, lastSyncedAt: '2026-11-17T11:00:00.000Z' })).toEqual(
      key(complete),
    )
  })
})
