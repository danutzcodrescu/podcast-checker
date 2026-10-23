// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { user } from '#/db/auth-schema'
import { createTestDatabase } from '#/test/database'

const database = createTestDatabase()
let db: (typeof import('#/db'))['db']
let runQuery: (typeof import('./episode-search-database.server'))['runEpisodeSearchQuery']

describe.runIf(database.enabled)('database search cancellation', () => {
  beforeAll(async () => {
    // A single pool slot forces the next query to reuse the cancelled transaction's backend.
    vi.stubEnv('DATABASE_POOL_MAX', '1')
    db = await database.start()
    runQuery = (await import('./episode-search-database.server')).runEpisodeSearchQuery
  }, 120_000)
  afterAll(async () => {
    await database.stop(async () => {})
  }, 30_000)

  it('does not acquire a backend or invoke the operation for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const operation = vi.fn()
    await expect(runQuery(controller.signal, operation)).rejects.toBe(controller.signal.reason)
    expect(operation).not.toHaveBeenCalled()
    expect(db.$client.idleCount).toBe(1)
  })

  it('cancels the real PostgreSQL statement, rolls back writes, and safely reuses only its pinned backend', async () => {
    const controller = new AbortController()
    const id = randomUUID()
    const [{ pid }] = await db
      .select({ pid: sql<number>`pg_backend_pid()` })
      .from(sql`(select 1) as probe`)
    let statementError: unknown
    const reason = new DOMException('Listener stopped', 'AbortError')
    const rejected = expect(
      runQuery(controller.signal, async (connection) => {
        await connection
          .insert(user)
          .values({ id, name: 'Cancelled search', email: `${id}@example.com` })
        try {
          return await connection
            .select({ sleep: sql`pg_sleep(20)` })
            .from(sql`(select 1) as probe`)
        } catch (error) {
          statementError = error
          throw error
        }
      }),
    ).rejects.toBe(reason)
    // Observe the real pg_sleep statement from an independent connection, not a timing guess.
    const observer = await databaseObserver()
    let releaseCancellation!: () => void
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve
    })
    const originalEnd = Client.prototype.end
    let closingCancellation = false
    // Delay completion of the real cancellation connection's cleanup. The original
    // transaction must retain its backend even after its cancelled SQL has failed.
    const end = vi.spyOn(Client.prototype, 'end').mockImplementationOnce(function (this: Client) {
      closingCancellation = true
      return new Promise<void>((resolve, reject) =>
        originalEnd.call(this, (error) => (error ? reject(error) : resolve())),
      ).then(() => cancellationGate)
    })
    try {
      await vi.waitFor(async () => {
        const {
          rows: [backend],
        } = await observer.query<{ query: string; state: string }>(
          'select query, state from pg_stat_activity where pid = $1',
          [pid],
        )
        expect(backend.state).toBe('active')
        expect(backend.query).toContain('pg_sleep(20)')
      })
      controller.abort(reason)
      await rejected
      // Queue immediately: cancellation must finish before this pool slot is released.
      const reuse = db
        .select({ pid: sql<number>`pg_backend_pid()`, sleep: sql`pg_sleep(0.1)` })
        .from(sql`(select 1) as probe`)
        .execute()
      await vi.waitFor(() => {
        expect(closingCancellation).toBe(true)
        expect(db.$client.waitingCount).toBe(1)
        expect(db.$client.idleCount).toBe(0)
      })
      releaseCancellation()
      const [reused] = await reuse
      expect(reused.pid).toBe(pid)
      expect(statementError).toMatchObject({ cause: { code: '57014' } })
      expect(await db.select().from(user).where(eq(user.id, id))).toEqual([])
      // An unrelated backend also survives the cancellation.
      expect((await observer.query('select 1 as ok')).rows).toEqual([{ ok: 1 }])
    } finally {
      releaseCancellation()
      end.mockRestore()
      controller.abort(reason)
      await rejected
      await observer.end()
      await db.delete(user).where(eq(user.id, id))
    }
  })

  it('removes the cancellation listener before a completed backend is used by a later request', async () => {
    const controller = new AbortController()
    const [completed] = await runQuery(controller.signal, (connection) =>
      connection.select({ pid: sql<number>`pg_backend_pid()` }).from(sql`(select 1) as probe`),
    )
    const later = db
      .select({ pid: sql<number>`pg_backend_pid()`, sleep: sql`pg_sleep(0.1)` })
      .from(sql`(select 1) as probe`)
      .execute()
    controller.abort()
    expect((await later)[0].pid).toBe(completed.pid)
  })
})

async function databaseObserver() {
  const client = new Client({
    ...db.$client.options,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
  })
  await client.connect()
  return client
}
