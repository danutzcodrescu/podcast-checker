import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast } from '#/db/library-schema'
import { podcastEpisode } from '#/db/ingestion-schema'
import { pocketCastsConnection } from '#/db/pocket-casts-schema'
import {
  loginPocketCasts,
  playNextPocketCasts,
  PocketCastsError,
  refreshPocketCasts,
  resolvePocketCastsEpisode,
} from './pocket-casts-api'
import { decryptPocketCastsTokens, encryptPocketCastsTokens } from './pocket-casts-tokens'

export async function readPocketCastsConnection(userId: string) {
  const [connection] = await db
    .select({ email: pocketCastsConnection.email })
    .from(pocketCastsConnection)
    .where(eq(pocketCastsConnection.userId, userId))
  return connection ?? null
}

export async function connectPocketCastsAccount(userId: string, email: string, password: string) {
  // Check encryption configuration before exchanging credentials.
  encryptPocketCastsTokens(userId, { accessToken: '', refreshToken: '', expiresAt: 0 })
  const tokens = await loginPocketCasts(email, password)
  const encryptedTokens = encryptPocketCastsTokens(userId, tokens)
  await db
    .insert(pocketCastsConnection)
    .values({ userId, email, encryptedTokens })
    .onConflictDoUpdate({
      target: pocketCastsConnection.userId,
      set: { email, encryptedTokens, updatedAt: new Date() },
    })
  return { email }
}

export async function disconnectPocketCastsAccount(userId: string) {
  await db.delete(pocketCastsConnection).where(eq(pocketCastsConnection.userId, userId))
  return null
}

export async function queuePocketCastsEpisode(userId: string, episodeId: string) {
  const [local] = await db
    .select({
      podcastId: followedPodcast.podcastId,
      guid: podcastEpisode.guid,
      audioUrl: podcastEpisode.audioUrl,
      title: podcastEpisode.title,
      publishedAt: podcastEpisode.publishedAt,
    })
    .from(podcastEpisode)
    .innerJoin(
      followedPodcast,
      and(eq(followedPodcast.feedId, podcastEpisode.feedId), eq(followedPodcast.userId, userId)),
    )
    .where(eq(podcastEpisode.id, episodeId))
    .limit(1)
  if (!local) throw new PocketCastsError('not_found')
  // Lock per account across server instances: refresh-token rotation and rapid
  // queue clicks cannot race. Store refreshed tokens even if queueing fails.
  const error = await db.transaction(async (tx) => {
    const [connection] = await tx
      .select()
      .from(pocketCastsConnection)
      .where(eq(pocketCastsConnection.userId, userId))
      .for('update')
    if (!connection) return new PocketCastsError('not_connected')
    try {
      let tokens = decryptPocketCastsTokens(userId, connection.encryptedTokens)
      const refresh = async () => {
        tokens = await refreshPocketCasts(tokens.refreshToken)
        await tx
          .update(pocketCastsConnection)
          .set({
            encryptedTokens: encryptPocketCastsTokens(userId, tokens),
            updatedAt: new Date(),
          })
          .where(eq(pocketCastsConnection.userId, userId))
      }
      const episode = await resolvePocketCastsEpisode(local)
      if (tokens.expiresAt <= Date.now() + 60_000) await refresh()
      try {
        await playNextPocketCasts(tokens.accessToken, episode)
      } catch (cause) {
        if (!(cause instanceof PocketCastsError) || cause.code !== 'auth') throw cause
        await refresh()
        await playNextPocketCasts(tokens.accessToken, episode)
      }
      return null
    } catch (cause) {
      if (cause instanceof PocketCastsError && cause.code === 'auth') {
        await tx.delete(pocketCastsConnection).where(eq(pocketCastsConnection.userId, userId))
      }
      return cause instanceof PocketCastsError ? cause : new PocketCastsError('unavailable')
    }
  })
  if (error) throw error
  return null
}
