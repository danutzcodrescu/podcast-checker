import { asc, desc, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { episodeEmbedding, podcastEpisode, podcastFeed } from '#/db/ingestion-schema'
import type { Podcast } from '#/lib/apple-podcasts'
import type { PodcastSync } from '#/lib/podcast-sync'
import { runEpisodeSearchQuery } from '#/lib/episode-search-database.server'

export async function readPodcastLibrary(userId: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const counts = db
    .select({
      feedId: podcastEpisode.feedId,
      episodes: sql<number>`count(*)::int`.as('episode_count'),
      embedded: sql<number>`count(*) filter (where ${episodeEmbedding.status} = 'ready')::int`.as(
        'embedded_count',
      ),
      failed: sql<number>`count(*) filter (where ${episodeEmbedding.status} = 'failed')::int`.as(
        'failed_count',
      ),
    })
    .from(podcastEpisode)
    .leftJoin(episodeEmbedding, eq(episodeEmbedding.episodeId, podcastEpisode.id))
    .where(
      sql`${podcastEpisode.feedId} in (select feed_id from followed_podcast where user_id = ${userId})`,
    )
    .groupBy(podcastEpisode.feedId)
    .as('episode_counts')
  const [rows, categories] = await runEpisodeSearchQuery(signal, (connection) =>
    Promise.all([
      connection
        .select({
          podcast: followedPodcast.podcast,
          categories: followedPodcast.categories,
          feed: {
            id: podcastFeed.id,
            status: podcastFeed.status,
            lastSyncedAt: podcastFeed.lastSyncedAt,
          },
          episodes: counts.episodes,
          embedded: counts.embedded,
          failed: counts.failed,
        })
        .from(followedPodcast)
        .leftJoin(podcastFeed, eq(podcastFeed.id, followedPodcast.feedId))
        .leftJoin(counts, eq(counts.feedId, podcastFeed.id))
        .where(eq(followedPodcast.userId, userId))
        .orderBy(desc(followedPodcast.followedAt), asc(followedPodcast.podcastId)),
      connection
        .select({ id: podcastCategory.id, name: podcastCategory.name })
        .from(podcastCategory)
        .where(eq(podcastCategory.userId, userId))
        .orderBy(asc(podcastCategory.name)),
    ]),
  )
  const podcasts: { podcast: Podcast; categories: string[]; sync?: PodcastSync | null }[] =
    rows.map((row) => ({
      podcast: row.podcast,
      categories: row.categories,
      sync: row.feed
        ? {
            status: row.feed.status,
            episodes: row.episodes ?? 0,
            embedded: row.embedded ?? 0,
            failed: row.failed ?? 0,
            lastSyncedAt: row.feed.lastSyncedAt?.toISOString() ?? null,
          }
        : null,
    }))
  return { podcasts, categories }
}
