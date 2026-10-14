import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth-schema'
import { podcastFeed } from './ingestion-schema'
import type { Podcast } from '#/lib/apple-podcasts'

export const followedPodcast = pgTable(
  'followed_podcast',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    podcastId: bigint('podcast_id', { mode: 'number' }).notNull(),
    podcast: jsonb('podcast').$type<Podcast>().notNull(),
    feedId: uuid('feed_id').references(() => podcastFeed.id),
    categories: text('categories').array().notNull().default([]),
    followedAt: timestamp('followed_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.podcastId] }),
    index('followed_podcast_feed_idx').on(table.feedId),
  ],
)

export const podcastCategory = pgTable(
  'podcast_category',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    name: text('name').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
)
