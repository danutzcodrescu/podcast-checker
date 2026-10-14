import { z } from 'zod'

export type PocketCastsErrorCode =
  | 'auth'
  | 'not_connected'
  | 'not_found'
  | 'unavailable'
  | 'configuration'

export class PocketCastsError extends Error {
  constructor(public code: PocketCastsErrorCode) {
    super(code)
  }
}

const tokensInput = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().positive(),
})

export type PocketCastsTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

// These are the Web Player's private JSON endpoints. Only fixed Pocket Casts
// hosts are fetched. The public cache redirects to its catalog CDN; authenticated
// requests never follow redirects or forward tokens to a different host.
async function request(url: string, body?: unknown, token?: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
      redirect: body === undefined ? 'manual' : 'error',
    })
    if (body === undefined && response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new PocketCastsError('unavailable')
      const destination = new URL(location, url)
      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== 'podcasts.pocketcasts.com' ||
        destination.username ||
        destination.password ||
        destination.port
      ) {
        throw new PocketCastsError('unavailable')
      }
      response = await fetch(destination.href, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      })
    }
  } catch {
    throw new PocketCastsError('unavailable')
  }
  if (response.status === 401 || response.status === 403) throw new PocketCastsError('auth')
  if (response.status === 404) throw new PocketCastsError('not_found')
  if (!response.ok) throw new PocketCastsError('unavailable')
  try {
    return await response.json()
  } catch {
    throw new PocketCastsError('unavailable')
  }
}

function parseTokens(data: unknown): PocketCastsTokens {
  const result = tokensInput.safeParse(data)
  if (!result.success) throw new PocketCastsError('unavailable')
  return {
    accessToken: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresAt: Date.now() + result.data.expiresIn * 1000,
  }
}

export async function loginPocketCasts(email: string, password: string) {
  return parseTokens(
    await request('https://api.pocketcasts.com/user/login_pocket_casts', {
      email,
      password,
      scope: 'webplayer',
    }),
  )
}

export async function refreshPocketCasts(refreshToken: string) {
  return parseTokens(
    await request('https://api.pocketcasts.com/user/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'webplayer',
    }),
  )
}

const remoteEpisodeInput = z.object({
  uuid: z.guid(),
  title: z.string(),
  url: z.string(),
  published: z.string(),
  guid: z.string().optional(),
})

export type PocketCastsEpisode = z.infer<typeof remoteEpisodeInput> & { podcast: string }
export type LocalPocketCastsEpisode = {
  podcastId: number
  guid: string | null
  audioUrl: string | null
  title: string
  publishedAt: Date | null
}

export async function resolvePocketCastsEpisode(
  local: LocalPocketCastsEpisode,
): Promise<PocketCastsEpisode> {
  const lookup = z
    .object({
      result: z.object({ podcast: z.object({ uuid: z.guid() }).nullable() }),
    })
    .safeParse(
      await request('https://refresh.pocketcasts.com/podcasts/show', {
        id: local.podcastId,
        v: '1.7',
        device: 'podcast-checker',
      }),
    )
  if (!lookup.success || !lookup.data.result.podcast) throw new PocketCastsError('not_found')
  const podcast = lookup.data.result.podcast.uuid
  const result = z
    .object({
      podcast: z.object({ episodes: z.array(remoteEpisodeInput) }),
    })
    .safeParse(await request(`https://cache.pocketcasts.com/podcast/full/${podcast}`))
  if (!result.success) throw new PocketCastsError('unavailable')
  const episodes = result.data.podcast.episodes
  // Local UUIDs are database IDs, not Pocket Casts IDs. Never queue them or
  // guess from a title alone. Require a unique GUID, audio URL, or title/date.
  const matches = [
    episodes.filter((episode) => local.guid && episode.guid === local.guid),
    episodes.filter((episode) => local.audioUrl && episode.url === local.audioUrl),
    episodes.filter(
      (episode) =>
        local.publishedAt &&
        episode.title.trim().toLowerCase() === local.title.trim().toLowerCase() &&
        Math.abs(new Date(episode.published).getTime() - local.publishedAt.getTime()) < 60_000,
    ),
  ]
  const match = matches.find((items) => items.length === 1)?.[0]
  if (!match) throw new PocketCastsError('not_found')
  return { ...match, podcast }
}

export async function playNextPocketCasts(token: string, episode: PocketCastsEpisode) {
  // Use the server's additive Play Next operation rather than replacing a
  // snapshot of the queue, which could erase changes made on another device.
  const result = await request(
    'https://api.pocketcasts.com/up_next/play_next',
    {
      version: 2,
      episode: {
        uuid: episode.uuid,
        podcast: episode.podcast,
        title: episode.title,
        url: episode.url,
        published: episode.published,
      },
    },
    token,
  )
  const parsed = z.object({ episodes: z.array(z.object({ uuid: z.string() })) }).safeParse(result)
  if (!parsed.success || !parsed.data.episodes.some(({ uuid }) => uuid === episode.uuid)) {
    throw new PocketCastsError('unavailable')
  }
}
