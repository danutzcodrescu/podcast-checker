import { createHash } from 'node:crypto'
import { and, desc, eq, gt, lt } from 'drizzle-orm'

import { db } from '#/db'
import { episodeSearchSession } from '#/db/episode-search-schema'
import { episodePageSize, episodeSearchExpired } from './episode-search-input'
import type { EpisodeSearchInput } from './episode-search-input'
import { createEpisodeRetrieval } from './episode-retrieval.server'
import { embeddingModel, preprocessingVersion } from './episode-text'
import {
  rerankEpisodes,
  rerankingCandidateLimit,
  rerankingConfiguration,
} from './episode-reranking'

const searchSessionDurationMs = 15 * 60_000

export async function readEpisodeSearchSnapshot(userId: string, data: EpisodeSearchInput) {
  const retrieval = createEpisodeRetrieval(userId, data)
  // Preserve the fingerprint's field order and scope so existing snapshots can
  // still be continued after deployment. Never persist the query itself.
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        term: data.term,
        podcastId: data.podcastId,
        categoryId: data.categoryId,
        days: data.days,
        searchMode: data.searchMode,
        configuration: rerankingConfiguration(),
        retrieval: { embeddingModel, preprocessingVersion },
        followed: await retrieval.readFollows(),
      }),
    )
    .digest('hex')

  async function readSnapshotPage(session: typeof episodeSearchSession.$inferSelect) {
    const ids = session.episodeIds.slice(data.offset, data.offset + episodePageSize)
    const rows = await retrieval.hydrate(ids)
    const positions = new Map(ids.map((id, index) => [id, index]))
    rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    const textMatches = new Set(session.textMatchIds)
    // Advance by snapshot positions, not hydrated rows: deleted or inaccessible
    // episodes may shorten a page but must not repeat earlier positions.
    const nextOffset = data.offset + ids.length
    return {
      episodes: rows.map((row) => Object.assign(row, { textMatch: textMatches.has(row.id) })),
      total: session.episodeIds.length,
      nextOffset: nextOffset < session.episodeIds.length ? nextOffset : null,
      semanticUnavailable: session.semanticUnavailable,
      searchSessionId: session.id,
      ranking: session.ranking,
    }
  }

  if (data.searchSessionId) {
    return readSnapshotPage(
      await loadEpisodeSearchSession(data.searchSessionId, userId, fingerprint),
    )
  }
  if (data.offset > 0) throw new Error(episodeSearchExpired)
  const cached = await findEpisodeSearchSession(userId, fingerprint)
  if (cached) return readSnapshotPage(cached)

  const { matches, semanticUnavailable } = await retrieval.findMatches()
  const candidateIds = matches.slice(0, rerankingCandidateLimit).map(({ id }) => id)
  const { ids, ranking } = await rerankEpisodes(
    data.term,
    await retrieval.loadCandidates(candidateIds),
  )
  const session = await saveEpisodeSearchSession({
    userId,
    fingerprint,
    episodeIds: [...ids, ...matches.slice(rerankingCandidateLimit).map(({ id }) => id)],
    textMatchIds: matches.filter(({ textMatch }) => textMatch).map(({ id }) => id),
    semanticUnavailable,
    ranking,
  })
  return readSnapshotPage(session)
}

async function loadEpisodeSearchSession(id: string, userId: string, fingerprint: string) {
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

async function findEpisodeSearchSession(userId: string, fingerprint: string) {
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

async function saveEpisodeSearchSession(
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
