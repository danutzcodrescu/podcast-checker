// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { user } from '#/db/auth-schema'
import { followedPodcast } from '#/db/library-schema'
import { podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import { pocketCastsConnection } from '#/db/pocket-casts-schema'
import { PocketCastsError } from './pocket-casts-api'
import { decryptPocketCastsTokens } from './pocket-casts-tokens'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  refresh: vi.fn(),
  resolve: vi.fn(),
  playNext: vi.fn(),
}))
vi.mock('./pocket-casts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pocket-casts-api')>()),
  loginPocketCasts: mocks.login,
  refreshPocketCasts: mocks.refresh,
  resolvePocketCastsEpisode: mocks.resolve,
  playNextPocketCasts: mocks.playNext,
}))

const testUrl = process.env.PODCAST_TEST_DATABASE_URL
const owner = randomUUID()
const other = randomUUID()
let db: (typeof import('#/db'))['db']
let service: typeof import('./pocket-casts-service')
let feedId: string
let episodeId: string
const remote = {
  uuid: randomUUID(),
  podcast: randomUUID(),
  title: 'Episode',
  url: 'https://example.com/audio.mp3',
  published: '2026-10-14T11:00:00Z',
}
const originalTokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
}
const newTokens = {
  accessToken: 'rotated-access',
  refreshToken: 'rotated-refresh',
  expiresAt: Date.now() + 3_600_000,
}

describe.runIf(!!testUrl)('database-backed Pocket Casts connection', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', testUrl!)
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-at-least-32-characters-long')
    db = (await import('#/db')).db
    service = await import('./pocket-casts-service')
    await migrate(db, { migrationsFolder: './drizzle' })
    await db
      .insert(user)
      .values([owner, other].map((id) => ({ id, name: 'Pocket test', email: `${id}@example.com` })))
    const [feed] = await db
      .insert(podcastFeed)
      .values({ url: `https://example.com/${randomUUID()}.xml` })
      .returning()
    feedId = feed.id
    await db.insert(followedPodcast).values({
      userId: owner,
      podcastId: 123,
      feedId,
      categories: [],
      podcast: {
        id: 123,
        title: 'Podcast',
        publisher: '',
        appleUrl: 'https://example.com',
        feedUrl: feed.url,
        artworkUrl: null,
      },
    })
    const [episode] = await db
      .insert(podcastEpisode)
      .values({
        feedId,
        key: 'episode',
        title: remote.title,
        embeddingTitle: remote.title,
        description: '',
        cleanedDescription: '',
        audioUrl: remote.url,
        publishedAt: new Date(remote.published),
      })
      .returning()
    episodeId = episode.id
  })

  beforeEach(async () => {
    mocks.login.mockReset().mockResolvedValue(originalTokens)
    mocks.refresh.mockReset().mockResolvedValue(newTokens)
    mocks.resolve.mockReset().mockResolvedValue(remote)
    mocks.playNext.mockReset().mockResolvedValue(undefined)
    await db
      .delete(pocketCastsConnection)
      .where(inArray(pocketCastsConnection.userId, [owner, other]))
  })

  afterAll(async () => {
    if (db) {
      await db.delete(user).where(inArray(user.id, [owner, other]))
      if (feedId) await db.delete(podcastFeed).where(eq(podcastFeed.id, feedId))
      await db.$client.end()
    }
    vi.unstubAllEnvs()
  })

  it('stores encrypted tokens, returns only email, and scopes connection and queue access to the owner', async () => {
    await service.connectPocketCastsAccount(owner, 'pocket@example.com', 'private-password')
    const [saved] = await db
      .select()
      .from(pocketCastsConnection)
      .where(eq(pocketCastsConnection.userId, owner))
    expect(saved.encryptedTokens).not.toContain('access')
    expect(JSON.stringify(saved)).not.toContain('private-password')
    expect(await service.readPocketCastsConnection(owner)).toEqual({ email: 'pocket@example.com' })
    expect(await service.readPocketCastsConnection(other)).toBeNull()
    await service.connectPocketCastsAccount(other, 'other@example.com', 'password')
    await expect(service.queuePocketCastsEpisode(other, episodeId)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.resolve).not.toHaveBeenCalled()
    await service.queuePocketCastsEpisode(owner, episodeId)
    expect(mocks.playNext).toHaveBeenCalledWith('access', remote)
    await service.disconnectPocketCastsAccount(owner)
    expect(await service.readPocketCastsConnection(owner)).toBeNull()
    expect(await service.readPocketCastsConnection(other)).toEqual({ email: 'other@example.com' })
  })

  it('serializes concurrent queue updates and persists a single refresh-token rotation', async () => {
    mocks.login.mockResolvedValueOnce({ ...originalTokens, expiresAt: 0 })
    await service.connectPocketCastsAccount(owner, 'pocket@example.com', 'password')
    await Promise.all([
      service.queuePocketCastsEpisode(owner, episodeId),
      service.queuePocketCastsEpisode(owner, episodeId),
    ])
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith('refresh')
    expect(mocks.playNext).toHaveBeenCalledTimes(2)
    expect(mocks.playNext).toHaveBeenLastCalledWith('rotated-access', remote)
    const [saved] = await db
      .select()
      .from(pocketCastsConnection)
      .where(eq(pocketCastsConnection.userId, owner))
    expect(decryptPocketCastsTokens(owner, saved.encryptedTokens)).toEqual(newTokens)
  })

  it('keeps rotated tokens when a later queue request fails and allows retry', async () => {
    await service.connectPocketCastsAccount(owner, 'pocket@example.com', 'password')
    mocks.playNext
      .mockRejectedValueOnce(new PocketCastsError('auth'))
      .mockRejectedValueOnce(new PocketCastsError('unavailable'))
    await expect(service.queuePocketCastsEpisode(owner, episodeId)).rejects.toMatchObject({
      code: 'unavailable',
    })
    const [saved] = await db
      .select()
      .from(pocketCastsConnection)
      .where(eq(pocketCastsConnection.userId, owner))
    expect(decryptPocketCastsTokens(owner, saved.encryptedTokens)).toEqual(newTokens)
    await service.queuePocketCastsEpisode(owner, episodeId)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.playNext).toHaveBeenLastCalledWith('rotated-access', remote)
  })

  it('removes a rejected session and never queues unmatched episodes or unconnected accounts', async () => {
    await expect(service.queuePocketCastsEpisode(owner, episodeId)).rejects.toMatchObject({
      code: 'not_connected',
    })
    await service.connectPocketCastsAccount(owner, 'pocket@example.com', 'password')
    mocks.resolve.mockRejectedValueOnce(new PocketCastsError('not_found'))
    await expect(service.queuePocketCastsEpisode(owner, episodeId)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.playNext).not.toHaveBeenCalled()
    mocks.playNext.mockRejectedValueOnce(new PocketCastsError('auth'))
    mocks.refresh.mockRejectedValueOnce(new PocketCastsError('auth'))
    await expect(service.queuePocketCastsEpisode(owner, episodeId)).rejects.toMatchObject({
      code: 'auth',
    })
    expect(await service.readPocketCastsConnection(owner)).toBeNull()
  })
})
