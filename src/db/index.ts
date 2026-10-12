import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from 'dotenv'

import * as schema from './auth-schema.ts'

config({ path: ['.env.local', '.env'], quiet: true })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in .env.local, .env, or the environment')
}

export const db = drizzle(databaseUrl, { schema })
