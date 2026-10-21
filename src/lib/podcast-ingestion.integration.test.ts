// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq, inArray, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '../db/auth-schema'
import {
  episodeEmbedding,
  ingestionLease,
  podcastEpisode,
  podcastFeed,
} from '../db/ingestion-schema'
import { followedPodcast } from '../db/library-schema'
import { parseRss } from './rss-parser'
import { embeddingContent, embeddingDimensions, embeddingModel } from './episode-text'

const mocks = vi.hoisted(() => ({ embed: vi.fn(), fetch: vi.fn() }))
vi.mock('./episode-embeddings', () => ({ embedEpisodes: mocks.embed }))
vi.mock('./rss-fetch', () => ({ fetchRss: mocks.fetch }))

const testUrl = process.env.PODCAST_TEST_DATABASE_URL
const userId = randomUUID()
const feedIds: string[] = []
let db: (typeof import('../db/index'))['db']
let ingestion: typeof import('./podcast-ingestion')
const vector = Array.from({ length: embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0))
const xml = (guid: string, description = 'The history of Britain.') =>
  `<rss version="2.0"><channel><title>History</title><item><guid>${guid}</guid><title>Britain</title><description>${description}</description></item></channel></rss>`

async function feed() {
  const [saved] = await db
    .insert(podcastFeed)
    .values({ url: `https://example.com/${randomUUID()}` })
    .returning()
  feedIds.push(saved.id)
  await db.insert(followedPodcast).values({
    userId,
    podcastId: feedIds.length,
    feedId: saved.id,
    podcast: {
      id: feedIds.length,
      title: 'History',
      publisher: '',
      appleUrl: 'https://example.com',
      feedUrl: saved.url,
      artworkUrl: null,
    },
  })
  return saved
}

async function pending(feedId: string) {
  return db
    .select({ episodeId: episodeEmbedding.episodeId, contentHash: episodeEmbedding.contentHash })
    .from(episodeEmbedding)
    .innerJoin(podcastEpisode, eq(podcastEpisode.id, episodeEmbedding.episodeId))
    .where(eq(podcastEpisode.feedId, feedId))
}

// Explicitly opt in with a dedicated pgvector-enabled database. No developer
// library records or credentials are used by this integration suite.
describe.runIf(!!testUrl)('durable incremental ingestion', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl
    db = (await import('../db/index')).db
    ingestion = await import('./podcast-ingestion')
    await migrate(db, { migrationsFolder: './drizzle' })
    await db
      .insert(user)
      .values({ id: userId, name: 'Ingestion test', email: `${userId}@example.com` })
  })
  beforeEach(() => {
    mocks.embed.mockReset().mockImplementation(async (inputs: string[]) => inputs.map(() => vector))
    mocks.fetch.mockReset()
  })
  afterAll(async () => {
    if (!db) return
    await db.delete(user).where(eq(user.id, userId))
    if (feedIds.length) await db.delete(podcastFeed).where(inArray(podcastFeed.id, feedIds))
    await db.$client.end()
  })

  it('migrates old vectors and failed inputs to pending Cloudflare embeddings with matching hashes', async () => {
    const client = await db.$client.connect()
    const schema = `migration_${randomUUID().replaceAll('-', '')}`
    const input = embeddingContent('History', 'Britain’s past.').input
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      await client.query(`CREATE TABLE episode_embedding (
        episode_id uuid PRIMARY KEY, input text NOT NULL, content_hash text NOT NULL,
        model text NOT NULL, preprocessing_version integer NOT NULL,
        embedding vector(1536), status text NOT NULL, last_error text,
        next_attempt_at timestamptz NOT NULL, embedded_at timestamptz
      )`)
      await client.query(
        `INSERT INTO episode_embedding VALUES
        ($1, $3, 'old-hash', 'text-embedding-3-small', 1, $4::vector, 'ready', NULL, now() + interval '1 hour', now()),
        ($2, $3, 'old-hash', 'text-embedding-3-small', 1, NULL, 'failed', 'HTTP 429', now() + interval '1 hour', NULL)`,
        [randomUUID(), randomUUID(), input, JSON.stringify(Array.from({ length: 1536 }, () => 1))],
      )
      await client.query(await readFile('./drizzle/0003_cloudflare_embeddings.sql', 'utf8'))
      const { rows } = await client.query(
        "SELECT *, format_type(a.atttypid, a.atttypmod) AS vector_type FROM episode_embedding, pg_attribute a WHERE a.attrelid = 'episode_embedding'::regclass AND a.attname = 'embedding'",
      )
      expect(rows).toHaveLength(2)
      for (const row of rows)
        expect(row).toMatchObject({
          input,
          model: embeddingModel,
          content_hash: embeddingContent('History', 'Britain’s past.').hash,
          vector_type: 'vector(1024)',
          embedding: null,
          embedded_at: null,
          last_error: null,
          status: 'pending',
        })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('embeds only new episodes across repeated syncs, edits, and redelivered jobs', async () => {
    const saved = await feed()
    await ingestion.saveFeedEpisodes(saved.id, parseRss(xml('one')).episodes)
    const jobs = await pending(saved.id)
    await ingestion.processEpisodeEmbeddings(jobs)
    await ingestion.saveFeedEpisodes(
      saved.id,
      parseRss(xml('one', 'An edited description.')).episodes,
    )
    await ingestion.processEpisodeEmbeddings(jobs)
    expect(mocks.embed).toHaveBeenCalledOnce()
    const [existing] = await db
      .select()
      .from(episodeEmbedding)
      .where(eq(episodeEmbedding.episodeId, jobs[0].episodeId))
    expect(existing.input).toContain('The history of Britain.')
    expect(existing.embedding).toEqual(vector)
    await ingestion.saveFeedEpisodes(saved.id, parseRss(xml('two')).episodes)
    await ingestion.processEpisodeEmbeddings(await pending(saved.id))
    expect(mocks.embed).toHaveBeenCalledTimes(2)
    expect(mocks.embed.mock.calls[1][0]).toHaveLength(1)
    expect(await pending(saved.id)).toHaveLength(2)
  })

  it('persists failed embeddings for retry without re-embedding successful ones', async () => {
    const saved = await feed()
    await ingestion.saveFeedEpisodes(saved.id, parseRss(xml('retry')).episodes)
    const jobs = await pending(saved.id)
    mocks.embed.mockRejectedValueOnce(new Error('rate limited'))
    await expect(ingestion.processEpisodeEmbeddings(jobs)).rejects.toThrow('rate limited')
    const [failed] = await db
      .select()
      .from(episodeEmbedding)
      .where(eq(episodeEmbedding.episodeId, jobs[0].episodeId))
    expect(failed).toMatchObject({ status: 'failed', embedding: null })
    await ingestion.processEpisodeEmbeddings(jobs)
    await ingestion.processEpisodeEmbeddings(jobs)
    expect(mocks.embed).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale embedding result when pending episode text changes during the API call', async () => {
    const saved = await feed()
    await ingestion.saveFeedEpisodes(saved.id, parseRss(xml('changing')).episodes)
    const jobs = await pending(saved.id)
    mocks.embed.mockImplementationOnce(async () => {
      await ingestion.saveFeedEpisodes(
        saved.id,
        parseRss(xml('changing', 'New pending text.')).episodes,
      )
      return [vector]
    })
    await ingestion.processEpisodeEmbeddings(jobs)
    const [row] = await db
      .select()
      .from(episodeEmbedding)
      .where(eq(episodeEmbedding.episodeId, jobs[0].episodeId))
    expect(row).toMatchObject({ status: 'pending', embedding: null })
    await ingestion.processEpisodeEmbeddings(await pending(saved.id))
    expect(mocks.embed.mock.calls[1][0][0]).toContain('New pending text.')
  })

  it('handles conditional refreshes, retains archived episodes, and stops refreshing unfollowed feeds', async () => {
    const saved = await feed()
    expect((await ingestion.getDueIngestion()).feeds.some((row) => row.id === saved.id)).toBe(true)
    mocks.fetch.mockResolvedValueOnce({
      xml: xml('archive'),
      url: saved.url,
      etag: 'version-1',
      lastModified: null,
    })
    await ingestion.syncPodcastFeed(saved.id, 60)
    mocks.fetch.mockResolvedValueOnce({
      xml: null,
      url: saved.url,
      etag: 'version-1',
      lastModified: null,
    })
    await ingestion.syncPodcastFeed(saved.id, 60)
    expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ etag: 'version-1' })
    expect(await pending(saved.id)).toHaveLength(1)
    const [synced] = await db.select().from(podcastFeed).where(eq(podcastFeed.id, saved.id))
    expect(synced.status).toBe('ready')
    expect(synced.nextSyncAt.getTime()).toBeGreaterThan(Date.now())
    expect((await ingestion.getDueIngestion()).feeds.some((row) => row.id === saved.id)).toBe(false)
    mocks.fetch.mockResolvedValueOnce({
      xml: '<rss><channel><title>History</title></channel></rss>',
      url: saved.url,
      etag: null,
      lastModified: null,
    })
    await ingestion.syncPodcastFeed(saved.id, 60)
    expect(await pending(saved.id)).toHaveLength(1)
    await db.delete(followedPodcast).where(eq(followedPodcast.feedId, saved.id))
    await db
      .update(podcastFeed)
      .set({ nextSyncAt: new Date(0) })
      .where(eq(podcastFeed.id, saved.id))
    const due = await ingestion.getDueIngestion()
    expect(due.feeds.some((row) => row.id === saved.id)).toBe(false)
    const episodeIds = new Set((await pending(saved.id)).map((row) => row.episodeId))
    expect(due.embeddings.some((row) => episodeIds.has(row.episodeId))).toBe(false)
    await ingestion.syncPodcastFeed(saved.id, 60)
    await ingestion.processEpisodeEmbeddings(await pending(saved.id))
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('leases one serverless run atomically, recovers expiry, and guards release by token', async () => {
    const { acquireIngestionLease, releaseIngestionLease } = await import('./ingestion-lease')
    const tokens = await Promise.all([acquireIngestionLease(), acquireIngestionLease()])
    const token = tokens.find((value) => value !== undefined)!
    try {
      expect(tokens.filter(Boolean)).toHaveLength(1)
      await releaseIngestionLease(randomUUID())
      expect(await acquireIngestionLease()).toBeUndefined()
      await db.update(ingestionLease).set({ expiresAt: sql`now() - interval '1 second'` })
      const replacement = await acquireIngestionLease()
      expect(replacement).toBeTruthy()
      expect(replacement).not.toBe(token)
      await releaseIngestionLease(token)
      expect(await acquireIngestionLease()).toBeUndefined()
      await releaseIngestionLease(replacement!)
      const next = await acquireIngestionLease()
      expect(next).toBeTruthy()
      await releaseIngestionLease(next!)
    } finally {
      await db.delete(ingestionLease)
    }
  })
})
