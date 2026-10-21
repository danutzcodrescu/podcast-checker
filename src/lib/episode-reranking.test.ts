// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { episodeRankingDocument, rerankEpisodes, rerankingTimeoutMs } from './episode-reranking'

const mocks = vi.hoisted(() => ({ score: vi.fn(), info: vi.fn(), warn: vi.fn() }))
vi.mock('#/lib/episode-reranking-provider', () => ({
  defaultRerankingModel: 'test-reranker',
  rerankingVersion: 'test-v1',
  scoreEpisodeDocuments: mocks.score,
}))
vi.mock('#/lib/logger', () => ({ getLogger: () => ({ info: mocks.info, warn: mocks.warn }) }))

const candidates = ['a', 'b', 'c'].map((id) => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  podcastTitle: 'Show',
}))

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  vi.stubEnv('EPISODE_RERANKING_MODEL', '')
  vi.stubEnv('EPISODE_RERANKING_ENABLED', '')
  mocks.score.mockReset().mockResolvedValue({ scores: [0.1, 0.9, 0.9], cost: 0 })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('episode reranking orchestration', () => {
  it('sorts by relevance with baseline order as a deterministic tie breaker', async () => {
    const result = await rerankEpisodes('better sleep', candidates)
    expect(result.ids).toEqual(['b', 'c', 'a'])
    expect(result.ranking).toMatchObject({ status: 'applied', model: 'test-reranker' })
    expect(mocks.score).toHaveBeenCalledWith(
      'better sleep',
      candidates.map(episodeRankingDocument),
      'test-reranker',
      'test-key',
      expect.any(AbortSignal),
    )
  })

  it('supports an explicit model override', async () => {
    vi.stubEnv('EPISODE_RERANKING_MODEL', 'another-model')
    expect((await rerankEpisodes('query', candidates)).ranking.model).toBe('another-model')
  })

  it.each(['missing-key', 'disabled'])('does not call the provider when %s', async (reason) => {
    if (reason === 'missing-key') vi.stubEnv('OPENROUTER_API_KEY', '')
    else vi.stubEnv('EPISODE_RERANKING_ENABLED', 'false')
    const result = await rerankEpisodes('query', candidates)
    expect(result.ids).toEqual(['a', 'b', 'c'])
    expect(result.ranking.status).toBe('disabled')
    expect(mocks.score).not.toHaveBeenCalled()
  })

  it('skips zero or one candidate', async () => {
    expect((await rerankEpisodes('query', [])).ranking.status).toBe('skipped')
    expect((await rerankEpisodes('query', candidates.slice(0, 1))).ids).toEqual(['a'])
    expect(mocks.score).not.toHaveBeenCalled()
  })

  it.each([[0.1], [0.1, NaN, 0.2], [0.1, Infinity, 0.2]])(
    'falls back on invalid scores %j',
    async (...scores) => {
      mocks.score.mockResolvedValue({ scores })
      expect((await rerankEpisodes('query', candidates)).ranking.status).toBe('fallback')
    },
  )

  it('falls back without logging sensitive provider errors', async () => {
    mocks.score.mockRejectedValue(new Error('private query and description'))
    const result = await rerankEpisodes('private query', candidates)
    expect(result.ids).toEqual(['a', 'b', 'c'])
    expect(result.ranking.status).toBe('fallback')
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private')
  })

  it('passes a single bounded timeout to the provider', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await rerankEpisodes('query', candidates)
    expect(timeout).toHaveBeenCalledWith(rerankingTimeoutMs)
  })

  it('uses descriptions beyond the display preview and caps document bytes', () => {
    const document = episodeRankingDocument({
      ...candidates[0],
      description: `${'x'.repeat(550)}important ${'é'.repeat(12_000)}`,
    })
    expect(document).toContain('important')
    expect(Buffer.byteLength(document)).toBeLessThanOrEqual(6_000)
    expect(document).not.toContain('\uFFFD')
  })
})
