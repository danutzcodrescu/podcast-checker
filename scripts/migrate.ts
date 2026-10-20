import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from 'dotenv'
import { Pool } from 'pg'
import { logger } from '../src/lib/logger'

config({ path: ['.env.local', '.env'], quiet: true })
const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set')
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 })

try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  logger.info({ event: 'database.migrated' }, 'Database migrations applied')
} catch (err) {
  logger.error({ event: 'database.migration_failed', err }, 'Database migrations failed')
  process.exitCode = 1
} finally {
  await pool.end()
}
