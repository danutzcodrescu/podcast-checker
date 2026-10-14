import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { user } from './auth-schema'

export const pocketCastsConnection = pgTable('pocket_casts_connection', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  encryptedTokens: text('encrypted_tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
