// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loginPocketCasts,
  playNextPocketCasts,
  refreshPocketCasts,
  resolvePocketCastsEpisode,
} from './pocket-casts-api'

const fetchMock = vi.fn()
const podcastUuid = 'fe30f8e0-3da9-0135-9028-63f4b61a9224'
const remoteEpisode = {
  uuid: '3ed1c2fe-6b36-4bec-9c85-80cdfffde695',
  title: 'An episode',
  url: 'https://example.com/episode.mp3',
  published: '2026-10-14T11:00:00Z',
}
const local = {
  podcastId: 123,
  guid: null,
  title: remoteEpisode.title,
  audioUrl: remoteEpisode.url,
  publishedAt: new Date(remoteEpisode.published),
}

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('Pocket Casts API', () => {
  it('exchanges credentials and refreshes using the Web Player scope', async () => {
    fetchMock.mockImplementation(async () =>
      reply({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 }),
    )
    const tokens = await loginPocketCasts('pocket@example.com', 'password')
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' })
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pocketcasts.com/user/login_pocket_casts',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'pocket@example.com',
          password: 'password',
          scope: 'webplayer',
        }),
        redirect: 'error',
      }),
    )
    await refreshPocketCasts(tokens.refreshToken)
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.pocketcasts.com/user/token',
      expect.objectContaining({
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: 'refresh',
          scope: 'webplayer',
        }),
      }),
    )
  })

  it('resolves remote IDs by Apple ID and exact audio URL even when titles differ', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ result: { podcast: { uuid: podcastUuid } } }))
      .mockResolvedValueOnce(reply({ podcast: { episodes: [remoteEpisode] } }))
    const resolved = await resolvePocketCastsEpisode({
      ...local,
      title: 'An RSS title',
      publishedAt: null,
    })
    expect(resolved).toEqual({ ...remoteEpisode, podcast: podcastUuid })
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://cache.pocketcasts.com/podcast/full/${podcastUuid}`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('matches changed audio URLs by title and date but rejects ambiguous or title-only matches', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/podcasts/show')
        ? reply({ result: { podcast: { uuid: podcastUuid } } })
        : reply({ podcast: { episodes: [remoteEpisode] } }),
    )
    expect(await resolvePocketCastsEpisode({ ...local, audioUrl: null })).toMatchObject({
      uuid: remoteEpisode.uuid,
    })
    await expect(
      resolvePocketCastsEpisode({ ...local, audioUrl: null, publishedAt: null }),
    ).rejects.toMatchObject({ code: 'not_found' })
    fetchMock
      .mockResolvedValueOnce(reply({ result: { podcast: { uuid: podcastUuid } } }))
      .mockResolvedValueOnce(
        reply({ podcast: { episodes: [remoteEpisode, { ...remoteEpisode, uuid: podcastUuid }] } }),
      )
    await expect(resolvePocketCastsEpisode(local)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('follows public catalog redirects only to the Pocket Casts CDN without credentials', async () => {
    const destination = `https://podcasts.pocketcasts.com/${podcastUuid}/episodes_full_123.json`
    fetchMock
      .mockResolvedValueOnce(reply({ result: { podcast: { uuid: podcastUuid } } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: destination } }),
      )
      .mockResolvedValueOnce(reply({ podcast: { episodes: [remoteEpisode] } }))
    expect(await resolvePocketCastsEpisode(local)).toMatchObject({ uuid: remoteEpisode.uuid })
    expect(fetchMock).toHaveBeenLastCalledWith(
      destination,
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        redirect: 'error',
      }),
    )
    fetchMock
      .mockResolvedValueOnce(reply({ result: { podcast: { uuid: podcastUuid } } }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/catalog.json' },
        }),
      )
    await expect(resolvePocketCastsEpisode(local)).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('uses the additive Play Next endpoint with remote IDs and verifies the returned queue', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ episodes: [{ uuid: 'current' }, remoteEpisode, { uuid: 'last' }] }),
    )
    const episode = { ...remoteEpisode, podcast: podcastUuid }
    await playNextPocketCasts('access', episode)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pocketcasts.com/up_next/play_next',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access' }),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ version: 2, episode })
    fetchMock.mockResolvedValueOnce(reply({ episodes: [] }))
    await expect(playNextPocketCasts('access', episode)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('redacts upstream authentication and network failures', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'sensitive server response' }, 401))
    await expect(loginPocketCasts('email', 'password')).rejects.toMatchObject({
      code: 'auth',
      message: 'auth',
    })
    fetchMock.mockRejectedValueOnce(new Error('sensitive network details'))
    await expect(loginPocketCasts('email', 'password')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'unavailable',
    })
  })
})
