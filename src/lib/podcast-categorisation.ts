import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/db'
import { followedPodcast, podcastCategory } from '#/db/library-schema'
import { classifyPodcast } from './podcast-classification'
import { fetchRss } from './rss-fetch'
import { parseRss } from './rss-parser'
import { getLogger } from './logger'

// The follow is committed before this bounded request. A failed classifier never fails a follow.
export async function categoriseFollow(
  userId: string,
  podcastId: number,
  token: string,
  feedUrl: string,
) {
  const currentFollow = and(
    eq(followedPodcast.userId, userId),
    eq(followedPodcast.podcastId, podcastId),
    eq(followedPodcast.categorisationToken, token),
    sql`cardinality(${followedPodcast.categories}) = 0`,
  )
  try {
    const signal = AbortSignal.timeout(20_000)
    const response = await fetchRss(feedUrl, {}, signal)
    if (!response.xml) return
    const { title, description, publisher, language, metadata } = parseRss(response.xml)
    const category = await classifyPodcast(
      { title, description, publisher, language, categories: metadata.categories },
      signal,
    )
    if (!category) return
    await db
      .update(followedPodcast)
      .set({ categories: [category] })
      .where(
        and(
          currentFollow,
          sql`exists (select 1 from ${podcastCategory} where ${podcastCategory.userId} = ${userId} and ${podcastCategory.id} = ${category})`,
        ),
      )
  } catch (err) {
    getLogger().warn(
      { event: 'podcast.categorisation_failed', err },
      'Podcast categorisation failed',
    )
  } finally {
    await db
      .update(followedPodcast)
      .set({ categorisationToken: null })
      .where(
        and(
          eq(followedPodcast.userId, userId),
          eq(followedPodcast.podcastId, podcastId),
          eq(followedPodcast.categorisationToken, token),
        ),
      )
      .catch(() => undefined)
  }
}
