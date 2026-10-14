// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { embedEpisodeQuery } from './episode-query-embedding'

const mocks = vi.hoisted(() => ({ embed: vi.fn() }))
vi.mock('#/lib/episode-embeddings', () => ({ embedEpisodes: mocks.embed }))

describe('query embedding reuse', () => {
  it('deduplicates concurrent requests and reuses vectors until the cache expires', async () => {
    vi.useFakeTimers()
    try {
      mocks.embed.mockResolvedValue([[1, 0]])
      const result = await Promise.all([
        embedEpisodeQuery('cache test'),
        embedEpisodeQuery('cache test'),
      ])
      expect(result).toEqual([
        [1, 0],
        [1, 0],
      ])
      expect(mocks.embed).toHaveBeenCalledOnce()
      expect(mocks.embed.mock.calls[0][0]).toEqual(['cache test'])
      expect(mocks.embed.mock.calls[0][2]).toBe('query')
      await embedEpisodeQuery('cache test')
      expect(mocks.embed).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(5 * 60_000 + 1)
      await embedEpisodeQuery('cache test')
      expect(mocks.embed).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache failed embedding requests, allowing retries', async () => {
    mocks.embed.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([[0, 1]])
    await expect(embedEpisodeQuery('retry test')).rejects.toThrow('Offline')
    expect(await embedEpisodeQuery('retry test')).toEqual([0, 1])
    expect(mocks.embed).toHaveBeenCalledTimes(2)
  })
})
