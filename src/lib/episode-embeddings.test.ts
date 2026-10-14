// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cloudflareEmbeddingsConfigured, embedEpisodes } from './episode-embeddings'
import { embeddingDimensions, embeddingModel } from './episode-text'

const fetchMock = vi.fn()
const accountId = 'a'.repeat(32)
const vector = (value: number) => Array.from({ length: embeddingDimensions }, () => value)
const response = (vectors: number[][]) =>
  Response.json({
    success: true,
    result: { shape: [vectors.length, embeddingDimensions], data: vectors },
  })

beforeEach(() => {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', accountId)
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token')
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('Cloudflare embedding batches', () => {
  it('sends episode documents to the account-scoped model endpoint and preserves batch order', async () => {
    fetchMock.mockResolvedValue(response([vector(1), vector(2)]))
    expect(await embedEpisodes(['first', 'second'])).toEqual([vector(1), vector(2)])
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${embeddingModel}`,
    )
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ documents: ['first', 'second'] })
  })

  it('uses query instructions rather than document embeddings for semantic searches', async () => {
    fetchMock.mockResolvedValue(response([vector(1)]))
    await embedEpisodes(['roman aqueducts'], undefined, 'query')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      queries: ['roman aqueducts'],
      instruction: expect.stringContaining('podcast'),
    })
  })

  it('rejects mismatched row counts and dimensions instead of storing incorrect vectors', async () => {
    fetchMock.mockResolvedValueOnce(response([vector(1)]))
    await expect(embedEpisodes(['first', 'second'])).rejects.toThrow('did not match')
    fetchMock.mockResolvedValueOnce(
      Response.json({ success: true, result: { shape: [1, 1536], data: [Array(1536).fill(1)] } }),
    )
    await expect(embedEpisodes(['first'])).rejects.toThrow('invalid embedding response')
  })

  it('reports the daily allowance error code without retaining raw provider messages', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { success: false, errors: [{ code: 3036, message: 'sensitive provider error body' }] },
        { status: 429 },
      ),
    )
    await expect(embedEpisodes(['first'])).rejects.toThrow(
      'Cloudflare embedding request failed (HTTP 429; code 3036): daily free neuron allowance exhausted; resets at 00:00 UTC',
    )
  })

  it('rejects provider error envelopes even when the HTTP status is successful', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: false, errors: [{ code: 3040 }] }))
    await expect(embedEpisodes(['first'])).rejects.toThrow('model temporarily out of capacity')
  })

  it('handles non-JSON failures without exposing response bodies', async () => {
    fetchMock.mockResolvedValue(new Response('sensitive provider error body', { status: 503 }))
    await expect(embedEpisodes(['first'])).rejects.toThrow(
      'Cloudflare embedding request failed (HTTP 503)',
    )
  })

  it('validates configuration and batch limits before sending any request', async () => {
    expect(cloudflareEmbeddingsConfigured()).toBe(true)
    await expect(embedEpisodes(Array(33).fill('episode'))).rejects.toThrow()
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'invalid-account-id')
    expect(cloudflareEmbeddingsConfigured()).toBe(false)
    await expect(embedEpisodes(['first'])).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
