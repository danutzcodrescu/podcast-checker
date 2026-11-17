// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '../db/auth-schema'
import {
  episodeEmbedding,
  ingestionLease,
  podcastEpisode,
  podcastFeed,
} from '../db/ingestion-schema'
import { followedPodcast } from '../db/library-schema'
import { createTestDatabase } from '../test/database'
import { parseRss } from './rss-parser'
import { embeddingContent, embeddingDimensions, embeddingModel } from './episode-text'

const mocks = vi.hoisted(() => ({ embed: vi.fn(), fetch: vi.fn() }))
vi.mock('./episode-embeddings', () => ({ embedEpisodes: mocks.embed }))
vi.mock('./rss-fetch', () => ({ fetchRss: mocks.fetch }))

const database = createTestDatabase()
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

// Explicitly opt in with an isolated container or dedicated pgvector test URL.
// No developer library records or credentials are used by this integration suite.
describe.runIf(database.enabled)('durable incremental ingestion', () => {
  beforeAll(async () => {
    db = await database.start()
    ingestion = await import('./podcast-ingestion')
    await db
      .insert(user)
      .values({ id: userId, name: 'Ingestion test', email: `${userId}@example.com` })
  }, 120_000)
  beforeEach(() => {
    mocks.embed.mockReset().mockImplementation(async (inputs: string[]) => inputs.map(() => vector))
    mocks.fetch.mockReset()
  })
  afterAll(async () => {
    await database.stop(async (cleanupDb) => {
      await cleanupDb.delete(user).where(eq(user.id, userId))
      if (feedIds.length)
        await cleanupDb.delete(podcastFeed).where(inArray(podcastFeed.id, feedIds))
    })
  }, 30_000)

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

  it('does not rewrite unchanged episode metadata or completed embeddings', async () => {
    const saved = await feed()
    const episodes = parseRss(xml('unchanged')).episodes
    await ingestion.saveFeedEpisodes(saved.id, episodes)
    await ingestion.processEpisodeEmbeddings(await pending(saved.id))
    const read = () =>
      db
        .select({
          id: podcastEpisode.id,
          updatedAt: podcastEpisode.updatedAt,
          revision: sql<string>`podcast_episode.xmin::text`,
          embeddingRevision: sql<string>`episode_embedding.xmin::text`,
        })
        .from(podcastEpisode)
        .innerJoin(episodeEmbedding, eq(episodeEmbedding.episodeId, podcastEpisode.id))
        .where(eq(podcastEpisode.feedId, saved.id))
    const before = await read()
    await ingestion.saveFeedEpisodes(saved.id, parseRss(xml('unchanged')).episodes)
    expect(await read()).toEqual(before)
  })

  it('preserves unchanged rows in a mixed batch and repairs their missing embedding outbox', async () => {
    const saved = await feed()
    const original = parseRss(xml('unchanged')).episodes[0]
    const edited = parseRss(xml('edited')).episodes[0]
    await ingestion.saveFeedEpisodes(saved.id, [original, edited])
    const before = await db
      .select({ id: podcastEpisode.id, key: podcastEpisode.key, revision: sql<string>`xmin::text` })
      .from(podcastEpisode)
      .where(eq(podcastEpisode.feedId, saved.id))
    const unchanged = before.find((row) => row.key === original.key)!
    await db.delete(episodeEmbedding).where(eq(episodeEmbedding.episodeId, unchanged.id))
    const changed = {
      ...edited,
      durationSeconds: 1234,
      explicit: false,
      metadata: { ...edited.metadata, subtitle: 'Updated metadata' },
    }
    await ingestion.saveFeedEpisodes(saved.id, [
      original,
      changed,
      parseRss(xml('new')).episodes[0],
    ])
    const after = await db
      .select({
        id: podcastEpisode.id,
        key: podcastEpisode.key,
        revision: sql<string>`xmin::text`,
        durationSeconds: podcastEpisode.durationSeconds,
        explicit: podcastEpisode.explicit,
        metadata: podcastEpisode.metadata,
      })
      .from(podcastEpisode)
      .where(eq(podcastEpisode.feedId, saved.id))
    expect(after).toHaveLength(3)
    expect(after.find((row) => row.key === original.key)).toMatchObject(unchanged)
    expect(after.find((row) => row.key === edited.key)).toMatchObject({
      durationSeconds: 1234,
      explicit: false,
      metadata: { ...edited.metadata, subtitle: 'Updated metadata' },
    })
    expect(after.find((row) => row.key === edited.key)?.revision).not.toBe(
      before.find((row) => row.key === edited.key)?.revision,
    )
    expect(await pending(saved.id)).toHaveLength(3)
  })

  it.each([
    { guid: 'updated-guid' },
    { title: 'Updated title' },
    { embeddingTitle: 'Updated embedding title' },
    { description: 'Updated description' },
    { descriptionHtml: '<p>Updated description</p>' },
    { cleanedDescription: 'Updated cleaned description' },
    { publishedAt: new Date('2026-11-17T00:00:00.000Z') },
    { durationSeconds: 1234 },
    { episodeNumber: '2' },
    { seasonNumber: '2' },
    { episodeType: 'bonus' },
    { explicit: false },
    { audioUrl: 'https://example.com/updated.mp3' },
    { artworkUrl: 'https://example.com/updated.jpg' },
    { link: 'https://example.com/updated' },
    { metadata: { subtitle: 'Updated', author: null, summary: null } },
  ])('persists metadata edits even when the embedding hash is unchanged: %j', async (change) => {
    const saved = await feed()
    const original = parseRss(xml('metadata')).episodes[0]
    await ingestion.saveFeedEpisodes(saved.id, [original])
    await ingestion.saveFeedEpisodes(saved.id, [{ ...original, ...change }])
    const [row] = await db.select().from(podcastEpisode).where(eq(podcastEpisode.feedId, saved.id))
    expect(row).toMatchObject(change)
    const jobs = await pending(saved.id)
    expect(jobs[0].contentHash).toBe(original.contentHash)
  })

  it('retains unchanged pending embeddings and still accepts later metadata edits', async () => {
    const saved = await feed()
    const original = parseRss(xml('pending')).episodes
    await ingestion.saveFeedEpisodes(saved.id, original)
    const jobs = await pending(saved.id)
    await ingestion.saveFeedEpisodes(saved.id, original)
    expect(await pending(saved.id)).toEqual(jobs)
    await ingestion.saveFeedEpisodes(
      saved.id,
      parseRss(xml('pending', 'Updated pending description.')).episodes,
    )
    const next = await pending(saved.id)
    expect(next[0].episodeId).toBe(jobs[0].episodeId)
    expect(next[0].contentHash).not.toBe(jobs[0].contentHash)
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
