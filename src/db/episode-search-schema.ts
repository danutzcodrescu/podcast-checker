import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { user } from './auth-schema'
import type { RankingStatus } from '#/lib/episode-reranking'

export const episodeSearchSession = pgTable(
  'episode_search_session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    // Only IDs and ranking diagnostics are persisted, never queries or episode descriptions.
    episodeIds: uuid('episode_ids').array().notNull(),
    textMatchIds: uuid('text_match_ids').array().notNull(),
    semanticUnavailable: boolean('semantic_unavailable').notNull(),
    ranking: jsonb('ranking').$type<RankingStatus>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('episode_search_session_expiry_idx').on(table.expiresAt),
    index('episode_search_session_lookup_idx').on(table.userId, table.fingerprint, table.expiresAt),
  ],
)
