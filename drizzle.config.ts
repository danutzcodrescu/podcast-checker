import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set')
}

export default defineConfig({
  out: './drizzle',
  schema: [
    './src/db/auth-schema.ts',
    './src/db/library-schema.ts',
    './src/db/ingestion-schema.ts',
    './src/db/pocket-casts-schema.ts',
  ],
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
