/* eslint-disable no-await-in-loop -- Sequential page fetching and bounded DB chunks prevent unbounded ingestion load. */
import { and, eq, exists, inArray, ne, sql } from 'drizzle-orm'

import { db } from '../db/index'
import { episodeEmbedding, podcastEpisode, podcastFeed } from '../db/ingestion-schema'
import { followedPodcast } from '../db/library-schema'
import { embedEpisodes } from './episode-embeddings'
import { embeddingModel, preprocessingVersion } from './episode-text'
import { fetchRss } from './rss-fetch'
import { parseRss } from './rss-parser'

export type EmbeddingJob = { episodeId: string; contentHash: string }
export const hasFollowers = (feedId: typeof podcastFeed.id | typeof podcastEpisode.feedId) =>
  exists(
    db
      .select({ id: followedPodcast.feedId })
      .from(followedPodcast)
      .where(eq(followedPodcast.feedId, feedId)),
  )

export async function saveFeedEpisodes(
  feedId: string,
  episodes: ReturnType<typeof parseRss>['episodes'],
  signal?: AbortSignal,
) {
  // Bound transaction size, while preserving each episode and its embedding outbox atomically.
  for (let offset = 0; offset < episodes.length; offset += 50) {
    signal?.throwIfAborted()
    await db.transaction(async (tx) => {
      const batch = episodes.slice(offset, offset + 50)
      const saved = await tx
        .insert(podcastEpisode)
        .values(
          batch.map(({ input: _input, contentHash: _hash, ...metadata }) => ({
            ...metadata,
            feedId,
          })),
        )
        .onConflictDoUpdate({
          target: [podcastEpisode.feedId, podcastEpisode.key],
          set: {
            guid: sql`excluded.guid`,
            title: sql`excluded.title`,
            embeddingTitle: sql`excluded.embedding_title`,
            description: sql`excluded.description`,
            descriptionHtml: sql`excluded.description_html`,
            cleanedDescription: sql`excluded.cleaned_description`,
            publishedAt: sql`excluded.published_at`,
            durationSeconds: sql`excluded.duration_seconds`,
            episodeNumber: sql`excluded.episode_number`,
            seasonNumber: sql`excluded.season_number`,
            episodeType: sql`excluded.episode_type`,
            explicit: sql`excluded.explicit`,
            audioUrl: sql`excluded.audio_url`,
            artworkUrl: sql`excluded.artwork_url`,
            link: sql`excluded.link`,
            metadata: sql`excluded.metadata`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: podcastEpisode.id, key: podcastEpisode.key })
      const ids = new Map(saved.map((row) => [row.key, row.id]))
      await tx
        .insert(episodeEmbedding)
        .values(
          batch.map(({ key, input, contentHash }) => ({
            episodeId: ids.get(key)!,
            input,
            contentHash,
            model: embeddingModel,
            preprocessingVersion,
          })),
        )
        .onConflictDoUpdate({
          target: episodeEmbedding.episodeId,
          // Completed vectors are immutable on ordinary RSS refreshes. Only an
          // unembedded episode may adopt updated text while waiting for a retry.
          set: {
            input: sql`excluded.input`,
            contentHash: sql`excluded.content_hash`,
            model: embeddingModel,
            preprocessingVersion,
            status: 'pending',
            lastError: null,
            nextAttemptAt: new Date(),
          },
          setWhere: and(
            ne(episodeEmbedding.status, 'ready'),
            sql`${episodeEmbedding.contentHash} <> excluded.content_hash`,
          ),
        })
    })
  }
}

export async function syncPodcastFeed(
  feedId: string,
  refreshMinutes: number,
  signal?: AbortSignal,
) {
  const [feed] = await db
    .select()
    .from(podcastFeed)
    .where(and(eq(podcastFeed.id, feedId), hasFollowers(podcastFeed.id)))
  if (!feed) return
  await db
    .update(podcastFeed)
    .set({ status: 'syncing', lastError: null })
    .where(eq(podcastFeed.id, feedId))
  try {
    // Feeds with archive pages are fetched without conditional headers so edits
    // or new entries on older pages are not hidden by the first page's 304.
    const response = await fetchRss(
      feed.url,
      feed.metadata && (feed.metadata as { paginated?: boolean }).paginated ? {} : feed,
      signal,
    )
    if (response.xml !== null) {
      const first = parseRss(response.xml)
      let page = first
      let baseUrl = response.url
      const visited = new Set([baseUrl])
      let pages = 1
      while (true) {
        await saveFeedEpisodes(feedId, page.episodes, signal)
        if (page.skipped)
          console.warn(`RSS feed ${feedId}: skipped ${page.skipped} unidentifiable items`)
        if (!page.nextUrl) break
        const nextUrl = new URL(page.nextUrl, baseUrl).href
        if (visited.has(nextUrl) || pages >= 20)
          throw new Error('RSS archive pagination loop or 20-page limit reached')
        visited.add(nextUrl)
        const next = await fetchRss(nextUrl, {}, signal)
        if (next.xml === null) throw new Error('Unexpected unmodified RSS archive response')
        page = parseRss(next.xml)
        baseUrl = next.url
        pages++
      }
      await db
        .update(podcastFeed)
        .set({
          title: first.title,
          description: first.description,
          language: first.language,
          publisher: first.publisher,
          metadata: { ...first.metadata, paginated: pages > 1 },
          etag: response.etag,
          lastModified: response.lastModified,
          resolvedUrl: response.url,
        })
        .where(eq(podcastFeed.id, feedId))
    }
    signal?.throwIfAborted()
    await db
      .update(podcastFeed)
      .set({
        status: 'ready',
        lastError: null,
        lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + refreshMinutes * 60_000),
      })
      .where(eq(podcastFeed.id, feedId))
  } catch (error) {
    await db
      .update(podcastFeed)
      .set({
        status: 'failed',
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'RSS sync failed',
        nextSyncAt: new Date(Date.now() + refreshMinutes * 60_000),
      })
      .where(eq(podcastFeed.id, feedId))
    throw error
  }
}

export async function processEpisodeEmbeddings(jobs: EmbeddingJob[], signal?: AbortSignal) {
  if (!jobs.length) return
  const rows = await db
    .select({ embedding: episodeEmbedding })
    .from(episodeEmbedding)
    .innerJoin(podcastEpisode, eq(podcastEpisode.id, episodeEmbedding.episodeId))
    .where(
      and(
        inArray(
          episodeEmbedding.episodeId,
          jobs.map((job) => job.episodeId),
        ),
        ne(episodeEmbedding.status, 'ready'),
        eq(episodeEmbedding.model, embeddingModel),
        eq(episodeEmbedding.preprocessingVersion, preprocessingVersion),
        hasFollowers(podcastEpisode.feedId),
      ),
    )
  const current = rows
    .map(({ embedding }) => embedding)
    .filter((row) =>
      jobs.some((job) => job.episodeId === row.episodeId && job.contentHash === row.contentHash),
    )
  if (!current.length) return
  const guard = (row: (typeof current)[number]) =>
    and(
      eq(episodeEmbedding.episodeId, row.episodeId),
      eq(episodeEmbedding.contentHash, row.contentHash),
      eq(episodeEmbedding.model, embeddingModel),
      eq(episodeEmbedding.preprocessingVersion, preprocessingVersion),
      ne(episodeEmbedding.status, 'ready'),
    )
  try {
    const vectors = await embedEpisodes(
      current.map((row) => row.input),
      signal,
    )
    signal?.throwIfAborted()
    await db.transaction(async (tx) => {
      for (const [index, row] of current.entries()) {
        await tx
          .update(episodeEmbedding)
          .set({
            embedding: vectors[index],
            status: 'ready',
            embeddedAt: new Date(),
            lastError: null,
          })
          .where(guard(row))
      }
    })
  } catch (error) {
    for (const row of current) {
      await db
        .update(episodeEmbedding)
        .set({
          status: 'failed',
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Embedding failed',
          nextAttemptAt: new Date(Date.now() + 60 * 60_000),
        })
        .where(guard(row))
    }
    throw error
  }
}

export async function getDueIngestion() {
  const feeds = await db
    .select({ id: podcastFeed.id })
    .from(podcastFeed)
    .where(and(sql`${podcastFeed.nextSyncAt} <= now()`, hasFollowers(podcastFeed.id)))
    .orderBy(podcastFeed.nextSyncAt)
    .limit(100)
  const embeddings = await db
    .select({ episodeId: episodeEmbedding.episodeId, contentHash: episodeEmbedding.contentHash })
    .from(episodeEmbedding)
    .innerJoin(podcastEpisode, eq(podcastEpisode.id, episodeEmbedding.episodeId))
    .where(
      and(
        ne(episodeEmbedding.status, 'ready'),
        eq(episodeEmbedding.model, embeddingModel),
        eq(episodeEmbedding.preprocessingVersion, preprocessingVersion),
        sql`${episodeEmbedding.nextAttemptAt} <= now()`,
        hasFollowers(podcastEpisode.feedId),
      ),
    )
    .orderBy(episodeEmbedding.nextAttemptAt, episodeEmbedding.episodeId)
    .limit(500)
  return { feeds, embeddings }
}
