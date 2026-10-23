// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedEpisodeQuery } from './episode-query-embedding'
import { embeddingDimensions } from './episode-text'

const fetchMock = vi.fn()
const vector = (value: number) => Array.from({ length: embeddingDimensions }, () => value)
const response = (value = 1) =>
  Response.json({
    success: true,
    result: { shape: [1, embeddingDimensions], data: [vector(value)] },
  })

beforeEach(() => {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'a'.repeat(32))
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async () => response())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('query embedding reuse', () => {
  it('does not start an embedding for an already cancelled consumer', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(embedEpisodeQuery('already stopped', controller.signal)).rejects.toBe(
      controller.signal.reason,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight embedding when its last consumer leaves and permits retry', async () => {
    let upstreamSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          upstreamSignal = init.signal
          upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), {
            once: true,
          })
        }),
    )
    const controller = new AbortController()
    const reason = new DOMException('Listener stopped', 'AbortError')
    const pending = expect(embedEpisodeQuery('stop lone consumer', controller.signal)).rejects.toBe(
      reason,
    )
    controller.abort(reason)
    await pending
    expect(upstreamSignal?.aborted).toBe(true)
    expect(await embedEpisodeQuery('stop lone consumer')).toEqual(vector(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('isolates cancellation between consumers of the same in-flight embedding', async () => {
    let finish!: (value: Response) => void
    let upstreamSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, init) => {
      upstreamSignal = init.signal
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    })
    const first = new AbortController()
    const second = new AbortController()
    const reason = new DOMException('Listener stopped', 'AbortError')
    const cancelled = expect(
      embedEpisodeQuery('shared consumer isolation', first.signal),
    ).rejects.toBe(reason)
    const remaining = embedEpisodeQuery('shared consumer isolation', second.signal)
    first.abort(reason)
    await cancelled
    expect(upstreamSignal?.aborted).toBe(false)
    finish(response(2))
    expect(await remaining).toEqual(vector(2))
    expect(await embedEpisodeQuery('shared consumer isolation')).toEqual(vector(2))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent requests and reuses vectors until the cache expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const result = await Promise.all([
      embedEpisodeQuery('cache test'),
      embedEpisodeQuery('cache test'),
    ])
    expect(result).toEqual([vector(1), vector(1)])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      queries: ['cache test'],
      instruction:
        'Given a podcast search query, retrieve relevant podcast episodes based on their titles and descriptions.',
    })
    await embedEpisodeQuery('cache test')
    expect(fetchMock).toHaveBeenCalledOnce()
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    await embedEpisodeQuery('cache test')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache failed embedding requests, allowing retries', async () => {
    fetchMock.mockResolvedValueOnce(new Response('private provider details', { status: 503 }))
    await expect(embedEpisodeQuery('retry test')).rejects.toThrow(
      'Cloudflare embedding request failed (HTTP 503)',
    )
    expect(await embedEpisodeQuery('retry test')).toEqual(vector(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('evicts a cancelled shared request so the same query can retry through HTTP', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal)
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }),
    )
    const requests = Promise.allSettled([
      embedEpisodeQuery('cancelled cache query'),
      embedEpisodeQuery('cancelled cache query'),
    ])
    controller.abort(new DOMException('Query timed out', 'TimeoutError'))

    expect(await requests).toEqual([
      { status: 'rejected', reason: controller.signal.reason },
      { status: 'rejected', reason: controller.signal.reason },
    ])
    expect(timeout).toHaveBeenNthCalledWith(1, 10_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(await embedEpisodeQuery('cancelled cache query')).toEqual(vector(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer cached result when an expired in-flight request fails late', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let finish!: (value: Response) => void
    const staleResponse = new Promise<Response>((resolve) => {
      finish = resolve
    })
    fetchMock.mockReturnValueOnce(staleResponse).mockImplementationOnce(async () => response(2))
    const stale = expect(embedEpisodeQuery('replaced cache query')).rejects.toThrow('HTTP 503')
    try {
      vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
      expect(await embedEpisodeQuery('replaced cache query')).toEqual(vector(2))
      finish(new Response('private provider details', { status: 503 }))
      await stale
      expect(await embedEpisodeQuery('replaced cache query')).toEqual(vector(2))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      finish(new Response('private provider details', { status: 503 }))
      await stale
    }
  })
})
