// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '#/db/auth-schema'
import { podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import { podcastCategory } from '#/db/library-schema'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), classify: vi.fn() }))
vi.mock('./rss-fetch', () => ({ fetchRss: mocks.fetch }))
vi.mock('./podcast-classification', () => ({ classifyPodcast: mocks.classify }))

const testUrl = process.env.PODCAST_TEST_DATABASE_URL
const useContainer = process.env.PODCAST_TEST_CONTAINERS === 'true'
let container: StartedPostgreSqlContainer | undefined
let db: (typeof import('#/db'))['db']
let follows: typeof import('./podcast-follows.server')
let readLibrary: (typeof import('./podcast-library-query.server'))['readPodcastLibrary']
let owner: string
const owners: string[] = []
const feedUrls: string[] = []
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function podcast() {
  const feedUrl = `https://example.com/${randomUUID()}.xml`
  feedUrls.push(feedUrl)
  return {
    id: 123,
    title: 'Web podcast',
    publisher: 'Publisher',
    appleUrl: 'https://example.com/podcast',
    feedUrl,
    artworkUrl: null,
  }
}

async function listener() {
  const id = randomUUID()
  owners.push(id)
  await db.insert(user).values({ id, name: 'Follow test', email: `${id}@example.com` })
  return id
}

// Default tests stay Docker-optional. pnpm test:follows starts its own pgvector
// database; an explicit test URL remains supported for existing integration jobs.
describe.runIf(useContainer || !!testUrl)('follow categorisation lifecycle', () => {
  beforeAll(async () => {
    if (useContainer) {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg18').start()
    }
    vi.stubEnv('DATABASE_URL', container?.getConnectionUri() ?? testUrl!)
    vi.stubEnv('LOG_LEVEL', 'silent')
    db = (await import('#/db')).db
    follows = await import('./podcast-follows.server')
    readLibrary = (await import('./podcast-library-query.server')).readPodcastLibrary
    await migrate(db, { migrationsFolder: './drizzle' })
  }, 120_000)

  beforeEach(async () => {
    owner = await listener()
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    mocks.fetch.mockReset().mockResolvedValue({
      xml: '<rss version="2.0"><channel><title>Web podcast</title><description>JavaScript and CSS</description></channel></rss>',
      url: 'https://example.com/feed.xml',
      etag: null,
      lastModified: null,
    })
    mocks.classify.mockReset().mockResolvedValue('web')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    try {
      if (db) {
        try {
          if (owners.length) await db.delete(user).where(inArray(user.id, owners))
          if (feedUrls.length)
            await db.delete(podcastFeed).where(inArray(podcastFeed.url, feedUrls))
        } finally {
          await db.$client.end()
        }
      }
    } finally {
      try {
        await container?.stop()
      } finally {
        vi.unstubAllEnvs()
      }
    }
  }, 30_000)

  it('categorises a newly saved follow before returning the refreshed library', async () => {
    const show = podcast()
    const library = await follows.savePodcastFollow(owner, { podcast: show, categories: [] })

    expect(library.podcasts).toEqual([
      expect.objectContaining({ podcast: show, categories: ['web'] }),
    ])
    expect(mocks.classify).toHaveBeenCalledOnce()
  })

  it.each([
    { categories: ['History'], expected: ['history'] },
    { categories: [], expected: [] },
  ])(
    'preserves a manual edit to $categories while classification is pending',
    async ({ categories, expected }) => {
      const show = podcast()
      const started = deferred<void>()
      const decision = deferred<string | null>()
      mocks.classify.mockImplementationOnce(() => {
        started.resolve()
        return decision.promise
      })
      const pending = follows.savePodcastFollow(owner, { podcast: show, categories: [] })
      try {
        await Promise.race([started.promise, pending])
        // The follow must already be visible outside its transaction while the
        // provider is pending, not held open until classification completes.
        expect((await readLibrary(owner)).podcasts).toEqual([
          expect.objectContaining({ podcast: show, categories: [] }),
        ])
        await follows.savePodcastFollow(owner, { podcast: show, categories })
        decision.resolve('web')
        expect((await pending).podcasts).toEqual([
          expect.objectContaining({ podcast: show, categories: expected }),
        ])
        expect(mocks.classify).toHaveBeenCalledOnce()
      } finally {
        decision.resolve(null)
        await pending
      }
    },
  )

  it('ignores an old completion without cancelling categorisation of a refollow', async () => {
    const show = podcast()
    const oldStarted = deferred<void>()
    const newStarted = deferred<void>()
    const oldDecision = deferred<string | null>()
    const newDecision = deferred<string | null>()
    mocks.classify
      .mockImplementationOnce(() => {
        oldStarted.resolve()
        return oldDecision.promise
      })
      .mockImplementationOnce(() => {
        newStarted.resolve()
        return newDecision.promise
      })
    const oldFollow = follows.savePodcastFollow(owner, { podcast: show, categories: [] })
    let newFollow: ReturnType<typeof follows.savePodcastFollow> | undefined
    try {
      await Promise.race([oldStarted.promise, oldFollow])
      expect((await follows.removePodcastFollow(owner, show.id)).podcasts).toEqual([])
      newFollow = follows.savePodcastFollow(owner, { podcast: show, categories: [] })
      await Promise.race([newStarted.promise, newFollow])

      oldDecision.resolve('web')
      expect((await oldFollow).podcasts).toEqual([
        expect.objectContaining({ podcast: show, categories: [] }),
      ])
      newDecision.resolve('history')
      expect((await newFollow).podcasts).toEqual([
        expect.objectContaining({ podcast: show, categories: ['history'] }),
      ])
    } finally {
      oldDecision.resolve(null)
      newDecision.resolve(null)
      await Promise.all([oldFollow, newFollow])
    }
  })

  it('only assigns an existing category belonging to the follower', async () => {
    const show = podcast()
    const other = await listener()
    // The other listener still owns the default web category, but this listener
    // has removed theirs. A provider suggestion must not recreate or borrow it.
    await db
      .delete(podcastCategory)
      .where(and(eq(podcastCategory.userId, owner), eq(podcastCategory.id, 'web')))

    const library = await follows.savePodcastFollow(owner, { podcast: show, categories: [] })
    expect(library.podcasts).toEqual([expect.objectContaining({ podcast: show, categories: [] })])
    expect(library.categories.map(({ id }) => id)).not.toContain('web')

    expect(
      (await follows.savePodcastFollow(other, { podcast: show, categories: [] })).podcasts,
    ).toEqual([expect.objectContaining({ podcast: show, categories: ['web'] })])
    expect((await readLibrary(owner)).podcasts[0].categories).toEqual([])
  })

  it.each(['RSS failure', 'invalid RSS', 'classification failure', 'no match', 'empty RSS'])(
    'keeps the committed follow uncategorised after %s',
    async (failure) => {
      const show = podcast()
      if (failure === 'RSS failure') mocks.fetch.mockRejectedValueOnce(new Error('RSS unavailable'))
      if (failure === 'classification failure') {
        mocks.classify.mockRejectedValueOnce(new Error('Model unavailable'))
      }
      if (failure === 'no match') mocks.classify.mockResolvedValueOnce(null)
      if (failure === 'invalid RSS' || failure === 'empty RSS') {
        mocks.fetch.mockResolvedValueOnce({
          xml: failure === 'invalid RSS' ? '<rss><channel></rss>' : null,
          url: show.feedUrl,
          etag: null,
          lastModified: null,
        })
      }

      const library = await follows.savePodcastFollow(owner, { podcast: show, categories: [] })
      expect(library.podcasts).toEqual([expect.objectContaining({ podcast: show, categories: [] })])
      expect((await readLibrary(owner)).podcasts).toEqual(library.podcasts)
    },
  )

  it.each(['selected categories', 'no RSS URL', 'no credentials'])(
    'does not attempt automatic categorisation with %s',
    async (reason) => {
      const original = podcast()
      const show = { ...original, feedUrl: reason === 'no RSS URL' ? null : original.feedUrl }
      const categories = reason === 'selected categories' ? ['History', 'history'] : []
      if (reason === 'no credentials') vi.stubEnv('OPENROUTER_API_KEY', '')

      const library = await follows.savePodcastFollow(owner, { podcast: show, categories })
      expect(library.podcasts).toEqual([
        expect.objectContaining({
          podcast: show,
          categories: reason === 'selected categories' ? ['history'] : [],
        }),
      ])
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.classify).not.toHaveBeenCalled()
    },
  )

  it('does not classify existing follows when saving edits or clearing categories', async () => {
    const show = podcast()
    await follows.savePodcastFollow(owner, { podcast: show, categories: ['History'] })
    const updated = { ...show, title: 'Updated podcast title' }
    expect(
      (await follows.savePodcastFollow(owner, { podcast: updated, categories: [] })).podcasts,
    ).toEqual([expect.objectContaining({ podcast: updated, categories: [] })])
    expect(mocks.classify).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('shares the 20-second budget across RSS and classification without failing the follow', async () => {
    const show = podcast()
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal)
    mocks.classify.mockImplementationOnce(async (_metadata, signal: AbortSignal) => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'))
      signal.throwIfAborted()
    })

    const library = await follows.savePodcastFollow(owner, { podcast: show, categories: [] })
    expect(library.podcasts).toEqual([expect.objectContaining({ podcast: show, categories: [] })])
    expect(timeout).toHaveBeenCalledWith(20_000)
    expect(mocks.fetch.mock.calls[0][2]).toBe(controller.signal)
    expect(mocks.classify.mock.calls[0][1]).toBe(controller.signal)
  })

  it('isolates unfollows and only removes a shared feed after its last follower leaves', async () => {
    const show = podcast()
    const other = await listener()
    const [feed] = await db.insert(podcastFeed).values({ url: show.feedUrl }).returning()
    await db.insert(podcastEpisode).values({
      feedId: feed.id,
      key: 'shared-episode',
      title: 'Shared episode',
      embeddingTitle: 'Shared episode',
      description: '',
      cleanedDescription: '',
    })
    await follows.savePodcastFollow(owner, { podcast: show, categories: ['History'] })
    expect((await follows.removePodcastFollow(other, show.id)).podcasts).toEqual([])
    const shared = await follows.savePodcastFollow(other, { podcast: show, categories: ['Web'] })
    expect(shared.podcasts[0].sync).toMatchObject({ episodes: 1 })

    expect((await follows.removePodcastFollow(owner, show.id)).podcasts).toEqual([])
    expect((await readLibrary(other)).podcasts).toEqual([
      expect.objectContaining({
        podcast: show,
        categories: ['web'],
        sync: expect.objectContaining({ episodes: 1 }),
      }),
    ])
    await follows.removePodcastFollow(other, show.id)
    const refollowed = await follows.savePodcastFollow(owner, {
      podcast: show,
      categories: ['History'],
    })
    expect(refollowed.podcasts[0].sync?.episodes).toBe(0)
  })
})
