import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

// A bounded serverless run owns this lease; crashes recover after expiration.
export const ingestionLease = pgTable('ingestion_lease', {
  name: text('name').primaryKey(),
  token: uuid('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const podcastFeed = pgTable(
  'podcast_feed',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    url: text('url').notNull().unique(),
    resolvedUrl: text('resolved_url'),
    title: text('title'),
    description: text('description'),
    language: text('language'),
    publisher: text('publisher'),
    metadata: jsonb('metadata'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    status: text('status')
      .$type<'queued' | 'syncing' | 'ready' | 'failed'>()
      .default('queued')
      .notNull(),
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('podcast_feed_due_idx').on(table.nextSyncAt)],
)

export const podcastEpisode = pgTable(
  'podcast_episode',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    feedId: uuid('feed_id')
      .notNull()
      .references(() => podcastFeed.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    guid: text('guid'),
    title: text('title').notNull(),
    embeddingTitle: text('embedding_title').notNull(),
    description: text('description').notNull(),
    descriptionHtml: text('description_html'),
    cleanedDescription: text('cleaned_description').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    episodeNumber: text('episode_number'),
    seasonNumber: text('season_number'),
    episodeType: text('episode_type'),
    explicit: boolean('explicit'),
    audioUrl: text('audio_url'),
    artworkUrl: text('artwork_url'),
    link: text('link'),
    metadata: jsonb('metadata'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('podcast_episode_feed_key_idx').on(table.feedId, table.key)],
)

export const episodeEmbedding = pgTable(
  'episode_embedding',
  {
    episodeId: uuid('episode_id')
      .primaryKey()
      .references(() => podcastEpisode.id, { onDelete: 'cascade' }),
    input: text('input').notNull(),
    contentHash: text('content_hash').notNull(),
    model: text('model').notNull(),
    preprocessingVersion: integer('preprocessing_version').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    status: text('status').$type<'pending' | 'ready' | 'failed'>().default('pending').notNull(),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  },
  (table) => [index('episode_embedding_pending_idx').on(table.status, table.nextAttemptAt)],
)
