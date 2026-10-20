// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import * as authSchema from '#/db/auth-schema'

const mocks = vi.hoisted(() => ({ db: undefined as NodePgDatabase<typeof authSchema> | undefined }))
vi.mock('#/db', () => ({
  get db() {
    return mocks.db
  },
}))
// HTTP auth endpoints set their own cookies; this plugin is only needed by Start server functions.
vi.mock('better-auth/tanstack-start', () => ({
  tanstackStartCookies: () => ({ id: 'test-cookies' }),
}))

const testUrl = process.env.PODCAST_TEST_DATABASE_URL

describe.runIf(!!testUrl)('database-backed sign-up flag', () => {
  it('blocks registration by default, supports live toggles, and preserves sign-in', async () => {
    const pool = new Pool({ connectionString: testUrl })
    const client = await pool.connect()
    const schema = `signup_${randomUUID().replaceAll('-', '')}`
    const origin = 'http://localhost:3000'
    vi.stubEnv('BETTER_AUTH_URL', origin)
    vi.stubEnv('BETTER_AUTH_SECRET', 'signup-integration-test-secret-at-least-32-characters')
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      // Keep the auth migration's explicitly qualified foreign keys inside this test schema.
      const authMigration = await readFile('./drizzle/0000_auth.sql', 'utf8')
      await client.query(authMigration.replaceAll('"public".', `"${schema}".`))
      await client.query(await readFile('./drizzle/0008_feature_flags.sql', 'utf8'))
      mocks.db = drizzle(client, { schema: authSchema })
      const { auth } = await import('./auth')
      const credentials = {
        name: 'Listener',
        email: 'listener@example.com',
        password: 'password123',
      }
      const post = (path: string) =>
        auth.handler(
          new Request(`${origin}/api/auth/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify(credentials),
          }),
        )

      const disabled = await post('sign-up/email')
      expect(disabled.status).toBe(404)
      expect(await disabled.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' })
      expect((await client.query('SELECT * FROM "user"')).rows).toHaveLength(0)

      await client.query("UPDATE feature_flag SET enabled = true WHERE key = 'signup_enabled'")
      expect((await post('sign-up/email')).status).toBe(200)
      expect((await client.query('SELECT * FROM "user"')).rows).toHaveLength(1)

      await client.query("UPDATE feature_flag SET enabled = false WHERE key = 'signup_enabled'")
      expect((await post('sign-up/email')).status).toBe(404)
      expect((await post('sign-in/email')).status).toBe(200)

      await client.query("DELETE FROM feature_flag WHERE key = 'signup_enabled'")
      expect((await post('sign-up/email')).status).toBe(404)
      expect((await client.query('SELECT * FROM "user"')).rows).toHaveLength(1)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
      vi.unstubAllEnvs()
    }
  })
})
