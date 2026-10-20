/* eslint-disable no-await-in-loop -- Bound ingestion work and API concurrency within each invocation. */
import { cloudflareEmbeddingsConfigured } from './episode-embeddings'
import { acquireIngestionLease, releaseIngestionLease } from './ingestion-lease'
import { getDueIngestion, processEpisodeEmbeddings, syncPodcastFeed } from './podcast-ingestion'
import { getLogger } from './logger'

// Leave ample cleanup time below Netlify's 15-minute hard termination. The lease
// lasts longer than that hard limit, so retries cannot overlap a live invocation.
const runBudgetMs = 8 * 60_000
const maxFeeds = 5
const maxEmbeddingBatches = 20

export async function runPodcastIngestion() {
  const refreshMinutes = Number(process.env.PODCAST_REFRESH_MINUTES ?? 60)
  const batchSize = Number(process.env.PODCAST_EMBEDDING_BATCH_SIZE ?? 16)
  if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 10080)
    throw new Error('PODCAST_REFRESH_MINUTES must be an integer between 1 and 10080')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32)
    throw new Error('PODCAST_EMBEDDING_BATCH_SIZE must be an integer between 1 and 32')

  const result = { skipped: false, feeds: 0, embeddingBatches: 0, failures: 0 }
  const token = await acquireIngestionLease()
  if (!token) {
    getLogger().info(
      { event: 'ingestion.skipped', reason: 'lease_held' },
      'Another ingestion run holds the lease',
    )
    return { ...result, skipped: true }
  }
  const signal = AbortSignal.timeout(runBudgetMs)
  try {
    const { feeds } = await getDueIngestion()
    for (const feed of feeds.slice(0, maxFeeds)) {
      if (signal.aborted) break
      try {
        await syncPodcastFeed(feed.id, refreshMinutes, signal)
        result.feeds++
      } catch (err) {
        // The ingestion layer persists errors and retry dates on the outbox.
        getLogger().error(
          { event: 'ingestion.feed_failed', err, feedId: feed.id },
          'Podcast feed ingestion failed',
        )
        result.failures++
      }
    }
    if (!signal.aborted && cloudflareEmbeddingsConfigured()) {
      // Re-read after RSS imports so newly discovered episodes can be embedded now.
      const { embeddings } = await getDueIngestion()
      const jobs = embeddings.slice(0, maxEmbeddingBatches * batchSize)
      for (let offset = 0; offset < jobs.length; offset += batchSize) {
        if (signal.aborted) break
        try {
          await processEpisodeEmbeddings(jobs.slice(offset, offset + batchSize), signal)
          result.embeddingBatches++
        } catch (err) {
          getLogger().error(
            {
              event: 'ingestion.embeddings_failed',
              err,
              batchSize: Math.min(batchSize, jobs.length - offset),
            },
            'Episode embedding batch failed',
          )
          result.failures++
          // Stop after a provider failure instead of repeatedly exhausting quotas.
          break
        }
      }
    }
    if (signal.aborted)
      getLogger().warn(
        { event: 'ingestion.budget_exhausted', ...result },
        'Ingestion time budget exhausted',
      )
    return result
  } finally {
    await releaseIngestionLease(token)
  }
}
