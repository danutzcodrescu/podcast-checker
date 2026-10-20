import { db } from '../src/db/index'
import { runPodcastIngestion } from '../src/lib/podcast-ingestion-runner'
import { getLogger, withLogContext } from '../src/lib/logger'
import { randomUUID } from 'node:crypto'

try {
  await withLogContext({ component: 'ingest-once', correlationId: randomUUID() }, async () => {
    try {
      const result = await runPodcastIngestion()
      getLogger().info({ event: 'ingestion.completed', ...result }, 'Podcast ingestion completed')
    } catch (err) {
      getLogger().error({ event: 'ingestion.failed', err }, 'Podcast ingestion failed')
      process.exitCode = 1
    }
  })
} finally {
  await db.$client.end()
}
