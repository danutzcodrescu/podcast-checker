// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '#/db/auth-schema'
import { episodeEmbedding, podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { embeddingDimensions, embeddingModel, preprocessingVersion } from '#/lib/episode-text'

const mocks = vi.hoisted(() => ({ embed: vi.fn() }))
vi.mock('#/lib/episode-query-embedding', () => ({ embedEpisodeQuery: mocks.embed }))

const testUrl = process.env.PODCAST_TEST_DATABASE_URL
const userId = randomUUID()
const otherUserId = randomUUID()
const feedIds: string[] = []
let db: (typeof import('#/db'))['db']
let queries: typeof import('./episode-query')
const term = 'roman water systems'
const baseInput = {
  podcastId: null,
  categoryId: null,
  days: null,
  sort: 'relevance' as const,
  term,
  searchMode: 'hybrid' as const,
  offset: 0,
}

function vector(similarity: number) {
  return Array.from({ length: embeddingDimensions }, (_, index) =>
    index === 0 ? similarity : index === 1 ? Math.sqrt(1 - similarity ** 2) : 0,
  )
}

async function follow(owner: string, podcastId: number, categories: string[]) {
  const [feed] = await db
    .insert(podcastFeed)
    .values({ url: `https://example.com/search-${randomUUID()}.xml` })
    .returning()
  feedIds.push(feed.id)
  await db.insert(followedPodcast).values({
    userId: owner,
    podcastId,
    feedId: feed.id,
    categories,
    podcast: {
      id: podcastId,
      title: `Show ${podcastId}`,
      publisher: '',
      appleUrl: 'https://example.com',
      feedUrl: feed.url,
      artworkUrl: null,
    },
  })
  return feed.id
}

async function episode(
  feedId: string,
  title: string,
  description: string,
  options: {
    similarity?: number
    age?: number
    status?: 'ready' | 'pending' | 'failed'
    model?: string
    version?: number
  } = {},
) {
  const [saved] = await db
    .insert(podcastEpisode)
    .values({
      feedId,
      key: randomUUID(),
      title,
      embeddingTitle: title,
      description,
      cleanedDescription: description,
      publishedAt: new Date(Date.now() - (options.age ?? 0) * 86_400_000),
    })
    .returning()
  if (options.similarity !== undefined) {
    await db.insert(episodeEmbedding).values({
      episodeId: saved.id,
      input: title,
      contentHash: 'test',
      model: options.model ?? embeddingModel,
      preprocessingVersion: options.version ?? preprocessingVersion,
      status: options.status ?? 'ready',
      embedding: vector(options.similarity),
    })
  }
  return saved.id
}

describe.runIf(!!testUrl)('database-backed episode search', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl
    db = (await import('#/db')).db
    queries = await import('./episode-query')
    await migrate(db, { migrationsFolder: './drizzle' })
    await db.insert(user).values(
      [userId, otherUserId].map((id) => ({
        id,
        name: 'Search test',
        email: `${id}@example.com`,
      })),
    )
    const feedId = await follow(userId, 1, ['development'])
    const secondFeed = await follow(userId, 2, ['history'])
    const privateFeed = await follow(otherUserId, 3, ['history'])
    const [followed] = await db
      .select()
      .from(followedPodcast)
      .where(inArray(followedPodcast.feedId, [feedId]))
    await db
      .insert(followedPodcast)
      .values({ ...followed, podcastId: 4, podcast: { ...followed.podcast, id: 4 } })
    await Promise.all([
      episode(feedId, 'Roman water systems', 'A historical discussion.'),
      episode(feedId, 'City planning', `${'Background context. '.repeat(40)}${term}`),
      episode(feedId, 'Aqueduct engineering', 'Pipes supplied ancient settlements.', {
        similarity: 0.8,
      }),
      episode(feedId, 'Ancient channels', 'An older discussion.', { similarity: 1, age: 10 }),
      episode(feedId, 'Baking cookies', 'Ovens and recipes.', { similarity: 0 }),
      episode(feedId, 'Wrong model', 'Incompatible vector.', {
        similarity: 1,
        model: 'another-model',
      }),
      episode(feedId, 'Wrong version', 'Incompatible preprocessing.', {
        similarity: 1,
        version: 2,
      }),
      episode(feedId, 'Pending item', 'Still indexing.', { similarity: 1, status: 'pending' }),
      episode(feedId, 'Failed item', 'Retry needed.', { similarity: 1, status: 'failed' }),
      episode(feedId, '100% progress', 'A literal wildcard.'),
      episode(secondFeed, 'Reservoir design', 'Keeping supplies flowing.', { similarity: 0.6 }),
      episode(privateFeed, 'Private aqueducts', 'Not followed by this account.', { similarity: 1 }),
    ])
  })
  beforeEach(() => {
    mocks.embed.mockReset().mockResolvedValue(vector(1))
  })
  afterAll(async () => {
    if (!db) return
    await db.delete(user).where(inArray(user.id, [userId, otherUserId]))
    if (feedIds.length) await db.delete(podcastFeed).where(inArray(podcastFeed.id, feedIds))
    await db.$client.end()
  })

  it('searches full titles and descriptions, including unembedded episodes and content beyond previews', async () => {
    const result = await queries.readLatestEpisodes(userId, { ...baseInput, searchMode: 'text' })
    expect(result.total).toBe(2)
    expect(result.episodes.map((item) => item.title)).toEqual([
      'Roman water systems',
      'City planning',
    ])
    expect(result.episodes.every((item) => item.matchType === 'text')).toBe(true)
    expect(result.episodes[1].description).not.toContain(term)
    const reorderedWords = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      term: 'systems roman',
      searchMode: 'text',
    })
    expect(reorderedWords.total).toBe(2)
    const literalWildcard = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      term: '%',
      searchMode: 'text',
    })
    expect(literalWildcard.episodes.map((item) => item.title)).toEqual(['100% progress'])
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('ranks compatible ready embeddings by cosine similarity and excludes unrelated or private episodes', async () => {
    const result = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      searchMode: 'semantic',
    })
    expect(result.total).toBe(3)
    expect(result.episodes.map((item) => item.title)).toEqual([
      'Ancient channels',
      'Aqueduct engineering',
      'Reservoir design',
    ])
    expect(result.episodes.every((item) => item.matchType === 'semantic')).toBe(true)
    expect(mocks.embed).toHaveBeenCalledWith(term)
  })

  it('combines text and semantic matches and applies podcast, category and date filters', async () => {
    const hybrid = await queries.readLatestEpisodes(userId, baseInput)
    expect(hybrid.total).toBe(5)
    expect(hybrid.episodes[0].title).toBe('Roman water systems')
    expect(hybrid.episodes.filter((item) => item.matchType === 'semantic')).toHaveLength(3)
    const recent = await queries.readLatestEpisodes(userId, { ...baseInput, days: 7 })
    expect(recent.total).toBe(4)
    expect(recent.episodes.some((item) => item.title === 'Ancient channels')).toBe(false)
    const podcast = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      podcastId: 1,
      days: 7,
      searchMode: 'semantic',
    })
    expect(podcast.episodes.map((item) => item.title)).toEqual(['Aqueduct engineering'])
    const category = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      categoryId: 'history',
      searchMode: 'semantic',
    })
    expect(category.episodes.map((item) => item.title)).toEqual(['Reservoir design'])
  })

  it('keeps text search available on provider failure without silently substituting semantic-only results', async () => {
    mocks.embed.mockRejectedValue(new Error('Provider unavailable'))
    const result = await queries.readLatestEpisodes(userId, baseInput)
    expect(result.semanticUnavailable).toBe(true)
    expect(result.total).toBe(2)
    await expect(
      queries.readLatestEpisodes(userId, { ...baseInput, searchMode: 'semantic' }),
    ).rejects.toThrow('Semantic episode search is unavailable')
  })

  it('paginates filtered search results without duplicating shared-feed episodes', async () => {
    const feedId = await follow(userId, 5, ['development'])
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        episode(feedId, `${term} ${index}`, 'Another text match.'),
      ),
    )
    const first = await queries.readLatestEpisodes(userId, { ...baseInput, searchMode: 'text' })
    const second = await queries.readLatestEpisodes(userId, {
      ...baseInput,
      searchMode: 'text',
      offset: first.nextOffset!,
    })
    expect(first.total).toBe(28)
    expect(first.episodes).toHaveLength(25)
    expect(second.episodes).toHaveLength(3)
    expect(second.nextOffset).toBeNull()
    expect(new Set([...first.episodes, ...second.episodes].map((item) => item.id)).size).toBe(28)
  })
})
