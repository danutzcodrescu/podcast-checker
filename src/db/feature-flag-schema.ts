import { boolean, pgTable, text } from 'drizzle-orm/pg-core'

export const featureFlag = pgTable('feature_flag', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
})
