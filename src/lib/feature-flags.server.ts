// oxlint-disable-next-line import/no-unassigned-import -- Marks this database-backed module as server-only.
import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { featureFlag } from '#/db/feature-flag-schema'

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const [flag] = await db
    .select({ enabled: featureFlag.enabled })
    .from(featureFlag)
    .where(eq(featureFlag.key, key))
    .limit(1)

  return flag?.enabled === true
}
