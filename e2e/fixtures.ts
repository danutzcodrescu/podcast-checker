import { test as base, expect } from '@playwright/test'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import * as authSchema from '../src/db/auth-schema'
import { featureFlag } from '../src/db/feature-flag-schema'
import { startApp } from './helpers/app'

export type TestDatabase = NodePgDatabase<typeof authSchema>

type App = { db: TestDatabase; url: string }
type Fixtures = {
  signupEnabled: boolean
  db: TestDatabase
  setSignupEnabled: (enabled: boolean | null) => Promise<void>
  _signupFlag: void
}

export const test = base.extend<Fixtures, { app: App }>({
  app: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies, even when empty.
    async ({}, use) => {
      const container = await new PostgreSqlContainer('pgvector/pgvector:pg18').start()
      const pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 })
      let server: Awaited<ReturnType<typeof startApp>> | undefined
      try {
        const db = drizzle(pool, { schema: authSchema })
        await migrate(db, { migrationsFolder: './drizzle' })
        server = await startApp(container.getConnectionUri())
        await use({ db, url: server.url })
      } finally {
        try {
          await server?.stop()
        } finally {
          try {
            await pool.end()
          } finally {
            await container.stop()
          }
        }
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  baseURL: async ({ app }, use) => use(app.url),
  db: async ({ app }, use) => use(app.db),
  signupEnabled: [true, { option: true }],
  setSignupEnabled: async ({ db }, use) => {
    await use(async (enabled) => {
      if (enabled === null) {
        await db.delete(featureFlag).where(eq(featureFlag.key, 'signup_enabled'))
      } else {
        await db
          .insert(featureFlag)
          .values({ key: 'signup_enabled', enabled })
          .onConflictDoUpdate({ target: featureFlag.key, set: { enabled } })
      }
    })
  },
  _signupFlag: [
    async ({ signupEnabled, setSignupEnabled }, use) => {
      await setSignupEnabled(signupEnabled)
      try {
        await use()
      } finally {
        await setSignupEnabled(true)
      }
    },
    { auto: true },
  ],
})

export { expect }
