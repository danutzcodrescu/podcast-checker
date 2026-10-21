import { createHash } from 'node:crypto'
import { and, desc, eq, gt, lt } from 'drizzle-orm'

import { db } from '#/db'
import { episodeSearchSession } from '#/db/episode-search-schema'
import { episodeSearchExpired } from '#/lib/episode-search-input'

export const searchSessionDurationMs = 15 * 60_000

export function episodeSearchFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function loadEpisodeSearchSession(id: string, userId: string, fingerprint: string) {
  const [session] = await db
    .select()
    .from(episodeSearchSession)
    .where(
      and(
        eq(episodeSearchSession.id, id),
        eq(episodeSearchSession.userId, userId),
        eq(episodeSearchSession.fingerprint, fingerprint),
        gt(episodeSearchSession.expiresAt, new Date()),
      ),
    )
  if (!session) throw new Error(episodeSearchExpired)
  return session
}

export async function findEpisodeSearchSession(userId: string, fingerprint: string) {
  const [session] = await db
    .select()
    .from(episodeSearchSession)
    .where(
      and(
        eq(episodeSearchSession.userId, userId),
        eq(episodeSearchSession.fingerprint, fingerprint),
        gt(episodeSearchSession.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(episodeSearchSession.expiresAt))
    .limit(1)
  return session
}

export async function saveEpisodeSearchSession(
  session: Omit<typeof episodeSearchSession.$inferInsert, 'id' | 'expiresAt'>,
) {
  await db.delete(episodeSearchSession).where(lt(episodeSearchSession.expiresAt, new Date()))
  const [saved] = await db
    .insert(episodeSearchSession)
    .values({
      ...session,
      expiresAt: new Date(Date.now() + searchSessionDurationMs),
    })
    .returning()
  return saved
}
