import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from 'dotenv'
import { Pool } from 'pg'

import * as schema from './auth-schema.ts'

config({ path: ['.env.local', '.env'], quiet: true })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in .env.local, .env, or the environment')
}

const max = Number(process.env.DATABASE_POOL_MAX ?? 2)
if (!Number.isInteger(max) || max < 1 || max > 20) {
  throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 20')
}

// Reuse a small pool across warm invocations; Neon supplies the shared pooler.
const pool = new Pool({
  connectionString: databaseUrl,
  max,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
  allowExitOnIdle: true,
})
pool.on('error', () => console.error('Idle database connection failed'))

export const db = drizzle(pool, { schema })
