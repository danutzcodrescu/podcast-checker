// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedEpisodes } from './episode-embeddings'

const fetchMock = vi.fn()
const vector = (value: number) => Array.from({ length: 1536 }, () => value)

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('embedding provider batches', () => {
  it('maps out-of-order provider results back to the correct episodes', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
      }),
    )
    expect(await embedEpisodes(['first', 'second'])).toEqual([vector(1), vector(2)])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ model: 'text-embedding-3-small', dimensions: 1536 })
  })

  it('rejects duplicate indices rather than assigning vectors to the wrong episodes', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          { index: 0, embedding: vector(1) },
          { index: 0, embedding: vector(2) },
        ],
      }),
    )
    await expect(embedEpisodes(['first', 'second'])).rejects.toThrow('did not match')
  })

  it('returns retryable HTTP failures without retaining the provider error body', async () => {
    fetchMock.mockResolvedValue(new Response('sensitive provider error body', { status: 429 }))
    await expect(embedEpisodes(['first'])).rejects.toThrow('Embedding request failed (HTTP 429)')
  })
})
