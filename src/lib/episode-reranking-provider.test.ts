// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultRerankingModel, scoreEpisodeDocuments } from './episode-reranking-provider'

const fetchMock = vi.fn()
const documents = [
  'Episode: First\nDescription: Incidental',
  'Episode: Second\nDescription: Relevant',
]
const signal = new AbortController().signal
const score = () =>
  scoreEpisodeDocuments('sleep advice', documents, defaultRerankingModel, 'test-key', signal)
const valid = {
  model: defaultRerankingModel,
  results: [
    { index: 1, relevance_score: 2.5, document: { text: documents[1] } },
    { index: 0, relevance_score: -1, document: { text: documents[0] } },
  ],
  usage: { cost: 0 },
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(() => Response.json(valid))
})
afterEach(() => vi.unstubAllGlobals())

describe('TanStack AI OpenRouter NVIDIA reranker', () => {
  it('uses the official adapter and maps returned indices rather than response order', async () => {
    expect(await score()).toEqual({ scores: [-1, 2.5], cost: 0 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const request: Request = fetchMock.mock.calls[0][0]
    expect(request.url).toBe('https://openrouter.ai/api/v1/rerank')
    expect(request.headers.get('authorization')).toBe('Bearer test-key')
    expect(await request.clone().json()).toMatchObject({
      model: defaultRerankingModel,
      query: 'sleep advice',
      documents,
      top_n: 2,
    })
  })

  it.each([
    {},
    { ...valid, results: [valid.results[0]] },
    { ...valid, results: [valid.results[0], valid.results[0]] },
    { ...valid, results: [{ index: 5, relevance_score: 1, document: {} }, valid.results[0]] },
    { ...valid, results: [{ index: -1, relevance_score: 1, document: {} }, valid.results[0]] },
    { ...valid, results: [{ index: 0, relevance_score: '1', document: {} }, valid.results[0]] },
  ])('rejects malformed or incomplete results via SDK and application validation', async (body) => {
    fetchMock.mockImplementation(() => Response.json(body))
    await expect(score()).rejects.toThrow()
  })

  it('reuses SDK retries for transient failures, without switching model', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: 'Temporarily unavailable', code: 503 } }, { status: 503 }),
    )
    expect((await score()).scores).toEqual([-1, 2.5])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = await Promise.all(
      fetchMock.mock.calls.map(([request]) => (request as Request).clone().json()),
    )
    expect(bodies.every((body) => body.model === defaultRerankingModel)).toBe(true)
  })

  it('does not retry permanent request failures', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({ error: { message: 'Invalid request', code: 400 } }, { status: 400 }),
    )
    await expect(score()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('honors an already aborted overall deadline', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      scoreEpisodeDocuments('query', documents, defaultRerankingModel, 'key', controller.signal),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
