import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { db } from '../src/db/index'

try {
  await migrate(db, { migrationsFolder: './drizzle' })
  console.info('Database migrations applied')
} finally {
  await db.$client.end()
}
