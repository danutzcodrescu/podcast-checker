import { PgBoss } from 'pg-boss'
import { config } from 'dotenv'
import { parentPort } from 'node:worker_threads'

import { db } from '../src/db/index'
import {
  getDueIngestion,
  processEpisodeEmbeddings,
  syncPodcastFeed,
} from '../src/lib/podcast-ingestion'
import type { EmbeddingJob } from '../src/lib/podcast-ingestion'
import { cloudflareEmbeddingsConfigured } from '../src/lib/episode-embeddings'

config({ path: ['.env.local', '.env'], quiet: true })

let shutdown: (() => Promise<void>) | undefined
let shutdownRequested = false
function requestShutdown() {
  shutdownRequested = true
  if (shutdown) void shutdown()
}
// Capture shutdown even while queue initialization is still awaiting the DB.
parentPort?.on('message', (message) => {
  if (message === 'shutdown') requestShutdown()
})
process.once('SIGTERM', requestShutdown)
process.once('SIGINT', requestShutdown)

function setting(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`)
  return value
}

const refreshMinutes = setting('PODCAST_REFRESH_MINUTES', 60, 10080)
const feedConcurrency = setting('PODCAST_FEED_CONCURRENCY', 1, 8)
const embeddingConcurrency = setting('PODCAST_EMBEDDING_CONCURRENCY', 1, 8)
const batchSize = setting('PODCAST_EMBEDDING_BATCH_SIZE', 16, 32)
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, max: 10 })
boss.on('error', (error) => console.error('Podcast queue error', error.message))

const feedQueue = 'podcast-feed-sync'
const embeddingQueue = 'podcast-episode-embed-cloudflare'
const embeddingsEnabled = cloudflareEmbeddingsConfigured()
const dispatchQueue = 'podcast-dispatch'

await boss.start()
const options = {
  policy: 'exclusive' as const,
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  heartbeatSeconds: 60,
  expireInSeconds: 900,
}
await boss.createQueue(feedQueue, options)
await boss.createQueue(embeddingQueue, options)
await boss.createQueue(dispatchQueue, { policy: 'exclusive', retryLimit: 3, retryDelay: 5 })
// Old OpenAI payloads have obsolete content hashes and must not hold back new jobs.
// Keep completed/failed history, but retire waiting jobs from the previous provider.
if (await boss.getQueue('podcast-episode-embed'))
  await boss.deleteQueuedJobs('podcast-episode-embed')

async function dispatch() {
  const { feeds, embeddings } = await getDueIngestion()
  if (feeds.length)
    await boss.insert(
      feedQueue,
      feeds.map((feed) => ({ data: { feedId: feed.id }, singletonKey: feed.id })),
    )
  if (embeddingsEnabled && embeddings.length)
    await boss.insert(
      embeddingQueue,
      embeddings.map((data) => ({
        data,
        singletonKey: data.episodeId,
      })),
    )
}

await boss.work<{ feedId: string }>(
  feedQueue,
  { localConcurrency: feedConcurrency },
  async ([job]) => {
    await syncPodcastFeed(job.data.feedId, refreshMinutes, job.signal)
  },
)
if (embeddingsEnabled)
  await boss.work<EmbeddingJob>(
    embeddingQueue,
    { localConcurrency: embeddingConcurrency, batchSize },
    async (jobs) => {
      await processEpisodeEmbeddings(
        jobs.map((job) => job.data),
        AbortSignal.any(jobs.map((job) => job.signal)),
      )
    },
  )
await boss.work(dispatchQueue, dispatch)
await boss.schedule(dispatchQueue, '* * * * *')
// Fast initial ingestion; the persistent minute schedule is also a restart-safe backstop.
let dispatching: Promise<void> | undefined
const tick = () => {
  if (dispatching) return
  dispatching = dispatch()
    .catch((error: Error) => console.error('Podcast dispatch failed', error.message))
    .finally(() => {
      dispatching = undefined
    })
}
const timer = setInterval(tick, 5000)
tick()
console.info(
  `Podcast worker running: ${feedConcurrency} feed worker(s), ${embeddingConcurrency} embedding worker(s), batch ${batchSize}, refresh ${refreshMinutes}m`,
)
if (!embeddingsEnabled)
  console.warn(
    'Cloudflare embeddings paused: configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, then restart the app. RSS imports remain active.',
  )

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await dispatching
  await boss.stop({ graceful: true, timeout: 70_000 })
  await db.$client.end()
  console.info('Podcast worker stopped')
  parentPort?.close()
}
shutdown = stop
if (shutdownRequested) await stop()
// eslint-disable-next-line unicorn/require-post-message-target-origin -- Node MessagePort API, not window.postMessage.
else parentPort?.postMessage('ready')
