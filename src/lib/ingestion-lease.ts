import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../db/index'
import { ingestionLease } from '../db/ingestion-schema'

const name = 'podcast-ingestion'

export async function acquireIngestionLease() {
  const token = randomUUID()
  const [lease] = await db
    .insert(ingestionLease)
    .values({ name, token, expiresAt: sql`now() + interval '20 minutes'` })
    .onConflictDoUpdate({
      target: ingestionLease.name,
      set: { token, expiresAt: sql`now() + interval '20 minutes'` },
      setWhere: sql`${ingestionLease.expiresAt} <= now()`,
    })
    .returning({ token: ingestionLease.token })
  return lease?.token
}

export async function releaseIngestionLease(token: string) {
  await db
    .delete(ingestionLease)
    .where(and(eq(ingestionLease.name, name), eq(ingestionLease.token, token)))
}
