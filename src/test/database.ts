import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { vi } from 'vitest'

type TestDatabase = (typeof import('#/db'))['db']

// Each suite owns its fixture. The app database is imported only after selecting
// an explicit test URL or an isolated container, never the app's default URL.
export function createTestDatabase() {
  const testUrl = process.env.PODCAST_TEST_DATABASE_URL
  const useContainer = process.env.PODCAST_TEST_CONTAINERS === 'true'
  let container: StartedPostgreSqlContainer | undefined
  let db: TestDatabase | undefined

  return {
    enabled: useContainer || !!testUrl,
    async start() {
      if (useContainer) {
        container = await new PostgreSqlContainer('pgvector/pgvector:pg18').start()
      }
      const url = container?.getConnectionUri() ?? testUrl
      if (!url) throw new Error('Integration tests require an explicit test database')
      vi.stubEnv('DATABASE_URL', url)
      vi.stubEnv('LOG_LEVEL', 'silent')
      db = (await import('#/db')).db
      await migrate(db, { migrationsFolder: './drizzle' })
      return db
    },
    async stop(cleanup: (db: TestDatabase) => Promise<void>) {
      try {
        if (db) {
          try {
            await cleanup(db)
          } finally {
            await db.$client.end()
          }
        }
      } finally {
        try {
          await container?.stop()
        } finally {
          vi.unstubAllEnvs()
        }
      }
    },
  }
}
