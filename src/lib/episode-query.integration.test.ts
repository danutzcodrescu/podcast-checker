// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '#/db/auth-schema'
import { episodeEmbedding, podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import { followedPodcast } from '#/db/library-schema'
import { episodeSearchSession } from '#/db/episode-search-schema'
import { embeddingDimensions, embeddingModel, preprocessingVersion } from '#/lib/episode-text'
import { createTestDatabase } from '#/test/database'

const mocks = vi.hoisted(() => ({ embed: vi.fn(), score: vi.fn() }))
vi.mock('#/lib/episode-query-embedding', () => ({ embedEpisodeQuery: mocks.embed }))
vi.mock('#/lib/episode-reranking-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./episode-reranking-provider')>()),
  scoreEpisodeDocuments: mocks.score,
}))

const database = createTestDatabase()
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

describe.runIf(database.enabled)('database-backed episode search', () => {
  beforeAll(async () => {
    db = await database.start()
    queries = await import('./episode-query')
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
  }, 120_000)
  beforeEach(async () => {
    await db
      .delete(episodeSearchSession)
      .where(inArray(episodeSearchSession.userId, [userId, otherUserId]))
    mocks.embed.mockReset().mockResolvedValue(vector(1))
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    vi.stubEnv('EPISODE_RERANKING_MODEL', 'test-reranker')
    vi.stubEnv('EPISODE_RERANKING_ENABLED', 'true')
    mocks.score.mockReset().mockImplementation(async (_query, documents: string[]) => ({
      scores: documents.map(() => 0.5),
      cost: 0,
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await database.stop(async (cleanupDb) => {
      await cleanupDb.delete(user).where(inArray(user.id, [userId, otherUserId]))
      if (feedIds.length)
        await cleanupDb.delete(podcastFeed).where(inArray(podcastFeed.id, feedIds))
    })
  }, 30_000)

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
    mocks.embed.mockResolvedValue(vector(1))
    const recovered = await queries.readLatestEpisodes(userId, baseInput)
    expect(recovered.semanticUnavailable).toBe(true)
    expect(recovered.episodes).toEqual(result.episodes)
    expect(recovered.searchSessionId).toBe(result.searchSessionId)
    expect(mocks.embed).toHaveBeenCalledOnce()
    mocks.embed.mockRejectedValue(new Error('Provider unavailable'))
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
      searchSessionId: first.searchSessionId!,
    })
    expect(first.total).toBe(28)
    expect(first.episodes).toHaveLength(25)
    expect(second.episodes).toHaveLength(3)
    expect(second.nextOffset).toBeNull()
    expect(new Set([...first.episodes, ...second.episodes].map((item) => item.id)).size).toBe(28)
  })

  it('reranks before pagination using description content beyond the display preview', async () => {
    const feedId = await follow(userId, 7, ['reranking'])
    const baseline = await Promise.all(
      Array.from({ length: 27 }, (_, index) =>
        episode(
          feedId,
          `reranking ${index}`,
          `${'Background. '.repeat(60)}deep description evidence`,
          { age: index },
        ),
      ),
    )
    mocks.score.mockImplementationOnce(async (_query, documents: string[]) => ({
      scores: documents.map((_document, index) => index),
      cost: 0,
    }))
    const input = { ...baseInput, term: 'reranking', searchMode: 'text' as const }
    const first = await queries.readLatestEpisodes(userId, input)
    const documents: string[] = mocks.score.mock.calls[0][1]
    expect(documents[0]).toContain('deep description evidence')
    expect(first.episodes[0].description).not.toContain('deep description evidence')
    expect(first.episodes[0].id).toBe(baseline.at(-1))
    expect(first.ranking).toMatchObject({ status: 'applied', model: 'test-reranker' })
    const second = await queries.readLatestEpisodes(userId, {
      ...input,
      offset: first.nextOffset!,
      searchSessionId: first.searchSessionId!,
    })
    expect(mocks.score).toHaveBeenCalledOnce()
    expect([...first.episodes, ...second.episodes].map(({ id }) => id)).toEqual(
      baseline.map((_id, index) => baseline[baseline.length - 1 - index]),
    )
  })

  it('freezes result membership across ingestion and preserves the reranking tail', async () => {
    const feedId = await follow(userId, 6, ['snapshot'])
    const baseline = await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        episode(feedId, `snapshot ${index}`, 'matching', { age: index }),
      ),
    )
    mocks.score.mockImplementationOnce(async (_query, documents: string[]) => ({
      scores: documents.map((_document, index) => index),
      cost: 0,
    }))
    const input = { ...baseInput, term: 'snapshot', searchMode: 'text' as const }
    const first = await queries.readLatestEpisodes(userId, input)
    expect(mocks.score.mock.calls[0][1]).toHaveLength(50)
    await episode(feedId, 'snapshot new arrival', 'matching')
    let page = first
    const ids = first.episodes.map(({ id }) => id)
    while (page.nextOffset !== null) {
      // oxlint-disable-next-line no-await-in-loop -- The next cursor depends on the previous page.
      page = await queries.readLatestEpisodes(userId, {
        ...input,
        offset: page.nextOffset,
        searchSessionId: first.searchSessionId!,
      })
      ids.push(...page.episodes.map(({ id }) => id))
    }
    expect(ids).toHaveLength(55)
    expect(new Set(ids).size).toBe(55)
    expect(ids).toEqual([
      ...Array.from({ length: 50 }, (_, index) => baseline[49 - index]),
      ...baseline.slice(50),
    ])
    expect(mocks.score).toHaveBeenCalledOnce()
  })

  it('rejects expired, foreign, missing and filter-mismatched snapshots', async () => {
    const input = { ...baseInput, searchMode: 'text' as const }
    const first = await queries.readLatestEpisodes(userId, input)
    const continuation = { ...input, offset: 25, searchSessionId: first.searchSessionId! }
    await expect(queries.readLatestEpisodes(otherUserId, continuation)).rejects.toThrow(
      'Episode search expired',
    )
    await expect(
      queries.readLatestEpisodes(userId, { ...continuation, term: 'different' }),
    ).rejects.toThrow('Episode search expired')
    await expect(
      queries.readLatestEpisodes(userId, { ...continuation, searchSessionId: undefined }),
    ).rejects.toThrow('Episode search expired')
    await db
      .update(episodeSearchSession)
      .set({ expiresAt: new Date(0) })
      .where(eq(episodeSearchSession.id, first.searchSessionId!))
    await expect(queries.readLatestEpisodes(userId, continuation)).rejects.toThrow(
      'Episode search expired',
    )
  })

  it('does not rerank chronological browsing or date-sorted searches', async () => {
    await queries.readLatestEpisodes(userId, { ...baseInput, sort: 'newest' })
    await queries.readLatestEpisodes(userId, { ...baseInput, term: '' })
    expect(mocks.score).not.toHaveBeenCalled()
  })

  it('reuses the model-scoped snapshot for repeated queries without embedding or reranking again', async () => {
    const first = await queries.readLatestEpisodes(userId, baseInput)
    const second = await queries.readLatestEpisodes(userId, baseInput)
    expect(second.searchSessionId).toBe(first.searchSessionId)
    expect(second.episodes).toEqual(first.episodes)
    expect(mocks.score).toHaveBeenCalledOnce()
    expect(mocks.embed).toHaveBeenCalledOnce()
  })

  it('keeps fallback order stable even if the provider recovers before the next page', async () => {
    const feedId = await follow(userId, 8, ['fallback'])
    const baseline = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        episode(feedId, `fallback ${index}`, 'matching', { age: index }),
      ),
    )
    mocks.score.mockRejectedValueOnce(new Error('Provider unavailable'))
    const input = { ...baseInput, term: 'fallback', searchMode: 'text' as const }
    const first = await queries.readLatestEpisodes(userId, input)
    const second = await queries.readLatestEpisodes(userId, {
      ...input,
      offset: 25,
      searchSessionId: first.searchSessionId!,
    })
    expect(first.ranking?.status).toBe('fallback')
    expect(second.ranking).toEqual(first.ranking)
    expect([...first.episodes, ...second.episodes].map(({ id }) => id)).toEqual(baseline)
    expect(mocks.score).toHaveBeenCalledOnce()
  })

  it('isolates ranker caches and rejects snapshots after the model or follows change', async () => {
    const first = await queries.readLatestEpisodes(userId, baseInput)
    vi.stubEnv('EPISODE_RERANKING_MODEL', 'another-model')
    const another = await queries.readLatestEpisodes(userId, baseInput)
    expect(another.searchSessionId).not.toBe(first.searchSessionId)
    expect(mocks.score).toHaveBeenCalledTimes(2)
    await expect(
      queries.readLatestEpisodes(userId, {
        ...baseInput,
        offset: 25,
        searchSessionId: first.searchSessionId!,
      }),
    ).rejects.toThrow('Episode search expired')
    await follow(userId, 999, ['new-follow'])
    await expect(
      queries.readLatestEpisodes(userId, {
        ...baseInput,
        offset: 25,
        searchSessionId: another.searchSessionId!,
      }),
    ).rejects.toThrow('Episode search expired')
  })

  it('expires snapshots after 15 minutes without extending their lifetime on reads', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const first = await queries.readLatestEpisodes(userId, baseInput)

    vi.setSystemTime(now + 14 * 60_000)
    const reused = await queries.readLatestEpisodes(userId, baseInput)
    expect(reused.searchSessionId).toBe(first.searchSessionId)
    expect(mocks.score).toHaveBeenCalledOnce()

    vi.setSystemTime(now + 15 * 60_000 + 1)
    await expect(
      queries.readLatestEpisodes(userId, {
        ...baseInput,
        offset: 25,
        searchSessionId: first.searchSessionId!,
      }),
    ).rejects.toThrow('Episode search expired')
    const refreshed = await queries.readLatestEpisodes(userId, baseInput)
    expect(refreshed.searchSessionId).not.toBe(first.searchSessionId)
    expect(mocks.score).toHaveBeenCalledTimes(2)
  })

  it('hydrates current episode content and advances past deleted snapshot positions', async () => {
    const feedId = await follow(userId, 10, ['hydration'])
    const ids = await Promise.all(
      Array.from({ length: 31 }, (_, index) =>
        episode(feedId, `hydration ${index}`, 'Original description', { age: index }),
      ),
    )
    const input = { ...baseInput, term: 'hydration', searchMode: 'text' as const }
    const first = await queries.readLatestEpisodes(userId, input)
    await db.delete(podcastEpisode).where(eq(podcastEpisode.id, ids[25]))
    await db
      .update(podcastEpisode)
      .set({
        title: 'Updated title that no longer matches',
        cleanedDescription: 'Updated description',
      })
      .where(eq(podcastEpisode.id, ids[26]))
    const second = await queries.readLatestEpisodes(userId, {
      ...input,
      offset: first.nextOffset!,
      searchSessionId: first.searchSessionId!,
    })

    expect(second.episodes.map(({ id }) => id)).toEqual(ids.slice(26))
    expect(second.episodes[0]).toMatchObject({
      title: 'Updated title that no longer matches',
      description: 'Updated description',
      matchType: 'text',
    })
    expect(second.total).toBe(31)
    expect(second.nextOffset).toBeNull()
    expect(second.ranking).toEqual(first.ranking)
    expect(mocks.score).toHaveBeenCalledOnce()
  })

  it('rechecks follow access when hydration happens after an external ranking request', async () => {
    const feedId = await follow(userId, 11, ['access'])
    await Promise.all([
      episode(feedId, 'access first', 'matching'),
      episode(feedId, 'access second', 'matching'),
    ])
    mocks.score.mockImplementationOnce(async () => {
      // Simulate a follow being removed while the provider is working. Episode
      // records remain present, but the earlier retrieval no longer grants access.
      await db
        .delete(followedPodcast)
        .where(and(eq(followedPodcast.userId, userId), eq(followedPodcast.feedId, feedId)))
      return { scores: [0.1, 0.9], cost: 0 }
    })
    const input = { ...baseInput, term: 'access', searchMode: 'text' as const }
    const result = await queries.readLatestEpisodes(userId, input)

    expect(result.episodes).toEqual([])
    expect(result.total).toBe(2)
    expect(result.ranking?.status).toBe('applied')
    await expect(
      queries.readLatestEpisodes(userId, {
        ...input,
        offset: 25,
        searchSessionId: result.searchSessionId!,
      }),
    ).rejects.toThrow('Episode search expired')
  })

  it.each([
    { reason: 'disabled', count: 2, status: 'disabled', podcastId: 12 },
    { reason: 'missing key', count: 2, status: 'disabled', podcastId: 13 },
    { reason: 'one candidate', count: 1, status: 'skipped', podcastId: 14 },
    { reason: 'no candidates', count: 0, status: 'skipped', podcastId: 15 },
  ])(
    'keeps $reason ranking snapshot-scoped without a provider request',
    async ({ reason, count, status, podcastId }) => {
      const feedId = await follow(userId, podcastId, ['policy'])
      const ids = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          episode(feedId, `policy ${index}`, 'matching', { age: index }),
        ),
      )
      if (reason === 'disabled') vi.stubEnv('EPISODE_RERANKING_ENABLED', 'false')
      if (reason === 'missing key') vi.stubEnv('OPENROUTER_API_KEY', '')
      const input = { ...baseInput, podcastId, term: 'policy', searchMode: 'text' as const }
      const first = await queries.readLatestEpisodes(userId, input)
      const repeated = await queries.readLatestEpisodes(userId, input)

      expect(first.episodes.map(({ id }) => id)).toEqual(ids)
      expect(first.ranking?.status).toBe(status)
      expect(repeated.ranking).toEqual(first.ranking)
      expect(repeated.searchSessionId).toBe(first.searchSessionId)
      expect(mocks.score).not.toHaveBeenCalled()
      if (status === 'disabled') {
        vi.stubEnv('EPISODE_RERANKING_ENABLED', 'true')
        vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
        const enabled = await queries.readLatestEpisodes(userId, input)
        expect(enabled.searchSessionId).not.toBe(first.searchSessionId)
        expect(enabled.ranking?.status).toBe('applied')
        expect(mocks.score).toHaveBeenCalledOnce()
      }
    },
  )

  it.each([
    { scores: [0.2], reason: 'incomplete', podcastId: 16 },
    { scores: [NaN, 0.2], reason: 'non-finite', podcastId: 17 },
  ])(
    'persists fallback for $reason scores rather than retrying a cached search',
    async ({ scores, podcastId }) => {
      const feedId = await follow(userId, podcastId, ['invalid'])
      const baseline = await Promise.all([
        episode(feedId, 'invalid first', 'matching', { age: 0 }),
        episode(feedId, 'invalid second', 'matching', { age: 1 }),
      ])
      mocks.score.mockResolvedValueOnce({ scores, cost: 0 })
      const input = { ...baseInput, podcastId, term: 'invalid', searchMode: 'text' as const }
      const first = await queries.readLatestEpisodes(userId, input)
      const repeated = await queries.readLatestEpisodes(userId, input)

      expect(first.episodes.map(({ id }) => id)).toEqual(baseline)
      expect(first.ranking?.status).toBe('fallback')
      expect(repeated.ranking).toEqual(first.ranking)
      expect(repeated.searchSessionId).toBe(first.searchSessionId)
      expect(mocks.score).toHaveBeenCalledOnce()
    },
  )

  it('keeps chronological browsing and date-sorted search live and correctly serialized', async () => {
    const feedId = await follow(userId, 18, ['chronological'])
    const ids = await Promise.all([
      episode(feedId, 'chronological newest', 'matching', { age: 0 }),
      episode(feedId, 'chronological middle', 'matching', { age: 1 }),
      episode(feedId, 'chronological oldest', 'matching', { age: 2 }),
    ])
    const input = { ...baseInput, podcastId: 18, searchMode: 'text' as const }
    const newest = await queries.readLatestEpisodes(userId, { ...input, term: '', sort: 'newest' })
    const oldest = await queries.readLatestEpisodes(userId, {
      ...input,
      term: '',
      sort: 'oldest',
      offset: 1,
    })
    const search = await queries.readLatestEpisodes(userId, {
      ...input,
      term: 'chronological',
      sort: 'oldest',
    })

    expect(newest.episodes.map(({ id }) => id)).toEqual(ids)
    expect(oldest.episodes.map(({ id }) => id)).toEqual([ids[1], ids[0]])
    expect(search.episodes.map(({ id }) => id)).toEqual([ids[2], ids[1], ids[0]])
    expect(newest.total).toBe(3)
    expect(newest.nextOffset).toBeNull()
    expect(newest.episodes[0].publishedAt).toEqual(expect.any(String))
    expect(newest.episodes[0].matchType).toBeNull()
    expect(search.episodes[0].matchType).toBe('text')
    expect(search.searchSessionId).toBeNull()
    expect(search.ranking).toBeNull()
    expect(mocks.score).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
  })
})
