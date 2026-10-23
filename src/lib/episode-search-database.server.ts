import { sql } from 'drizzle-orm'
import { Client } from 'pg'

import { db } from '#/db'
import { runWithAbort } from '#/lib/abort'
import { getLogger } from '#/lib/logger'

type SearchDatabase = Pick<typeof db, 'select' | 'selectDistinctOn' | 'insert' | 'delete'>

async function cancelStatement(pid: number) {
  // A separate connection is necessary: all ordinary pool slots may be executing queries.
  // Reuse the actual pool's connection options, including test isolation and TLS settings.
  const client = new Client({
    ...db.$client.options,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
    statement_timeout: 1000,
  })
  try {
    await client.connect()
    await client.query('select pg_cancel_backend($1)', [pid])
  } catch {
    // A lost cancellation connection must not expose credentials or SQL payloads.
    getLogger().warn(
      { event: 'search.cancellation_unavailable' },
      'Database cancellation unavailable; statement timeout remains active',
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

/** Pin the backend inside a transaction so cancellation cannot target a reused pooled backend. */
export function runEpisodeSearchQuery<T>(
  signal: AbortSignal | undefined,
  operation: (connection: SearchDatabase) => PromiseLike<T>,
): Promise<T> {
  if (!signal) return Promise.resolve(operation(db))
  return runWithAbort(signal, () =>
    db.transaction(async (transaction) => {
      signal.throwIfAborted()
      const {
        rows: [backend],
      } = await transaction.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
      signal.throwIfAborted()
      let cancellation: Promise<void> | undefined
      const onAbort = () => {
        cancellation = cancelStatement(backend.pid)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await operation(transaction)
        // Throw before COMMIT: cancelled snapshot writes roll back rather than being persisted.
        signal.throwIfAborted()
        return result
      } finally {
        signal.removeEventListener('abort', onAbort)
        // Do not return this backend to the pool while a cancellation packet is still in flight.
        await cancellation
      }
    }),
  )
}
