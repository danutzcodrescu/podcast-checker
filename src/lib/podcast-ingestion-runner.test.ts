// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runPodcastIngestion } from './podcast-ingestion-runner'
import { logger } from './logger'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  configured: vi.fn(),
  due: vi.fn(),
  sync: vi.fn(),
  embed: vi.fn(),
}))
vi.mock('./ingestion-lease', () => ({
  acquireIngestionLease: mocks.acquire,
  releaseIngestionLease: mocks.release,
}))
vi.mock('./episode-embeddings', () => ({ cloudflareEmbeddingsConfigured: mocks.configured }))
vi.mock('./podcast-ingestion', () => ({
  getDueIngestion: mocks.due,
  syncPodcastFeed: mocks.sync,
  processEpisodeEmbeddings: mocks.embed,
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(logger, 'info').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
  vi.stubEnv('PODCAST_REFRESH_MINUTES', '60')
  vi.stubEnv('PODCAST_EMBEDDING_BATCH_SIZE', '16')
  mocks.acquire.mockResolvedValue('lease-token')
  mocks.configured.mockReturnValue(true)
  mocks.due.mockResolvedValue({ feeds: [], embeddings: [] })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('bounded serverless ingestion', () => {
  it('skips an overlapping invocation', async () => {
    mocks.acquire.mockResolvedValueOnce(undefined)
    expect(await runPodcastIngestion()).toMatchObject({ skipped: true })
    expect(mocks.due).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('bounds work and re-reads embeddings after importing feeds', async () => {
    const feeds = Array.from({ length: 10 }, (_, i) => ({ id: `${i}` }))
    const embeddings = Array.from({ length: 500 }, (_, i) => ({
      episodeId: `${i}`,
      contentHash: 'h',
    }))
    mocks.due
      .mockResolvedValueOnce({ feeds, embeddings: [] })
      .mockResolvedValueOnce({ feeds: [], embeddings })
    expect(await runPodcastIngestion()).toEqual({
      skipped: false,
      feeds: 5,
      embeddingBatches: 20,
      failures: 0,
    })
    expect(mocks.sync).toHaveBeenCalledTimes(5)
    expect(mocks.embed).toHaveBeenCalledTimes(20)
    expect(mocks.embed.mock.calls.every(([jobs]) => jobs.length === 16)).toBe(true)
    expect(mocks.release).toHaveBeenCalledWith('lease-token')
  })

  it('keeps RSS ingestion active without Cloudflare credentials', async () => {
    mocks.configured.mockReturnValue(false)
    mocks.due.mockResolvedValue({ feeds: [{ id: 'one' }], embeddings: [] })
    expect(await runPodcastIngestion()).toMatchObject({ feeds: 1, embeddingBatches: 0 })
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('continues after feed errors but stops after a provider error', async () => {
    mocks.due.mockResolvedValue({
      feeds: [{ id: 'one' }, { id: 'two' }],
      embeddings: Array.from({ length: 32 }, () => ({ episodeId: 'e', contentHash: 'h' })),
    })
    mocks.sync.mockRejectedValueOnce(new Error('RSS failed'))
    mocks.embed.mockRejectedValueOnce(new Error('Quota exhausted'))
    expect(await runPodcastIngestion()).toMatchObject({ feeds: 1, failures: 2 })
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ingestion.feed_failed',
        feedId: 'one',
        err: expect.any(Error),
      }),
      'Podcast feed ingestion failed',
    )
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ingestion.embeddings_failed',
        batchSize: 16,
        err: expect.any(Error),
      }),
      'Episode embedding batch failed',
    )
    expect(mocks.embed).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledWith('lease-token')
  })

  it('releases the lease even if the database query fails', async () => {
    mocks.due.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(runPodcastIngestion()).rejects.toThrow('Database unavailable')
    expect(mocks.release).toHaveBeenCalledWith('lease-token')
  })

  it('stops starting work once its time budget expires', async () => {
    const signal = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(signal.signal)
    mocks.due.mockResolvedValue({ feeds: [{ id: 'one' }, { id: 'two' }], embeddings: [] })
    mocks.sync.mockImplementationOnce(async () => signal.abort())
    expect(await runPodcastIngestion()).toMatchObject({ feeds: 1 })
    expect(mocks.sync).toHaveBeenCalledOnce()
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('validates batch sizes before acquiring work', async () => {
    vi.stubEnv('PODCAST_EMBEDDING_BATCH_SIZE', '33')
    await expect(runPodcastIngestion()).rejects.toThrow('PODCAST_EMBEDDING_BATCH_SIZE')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })
})
