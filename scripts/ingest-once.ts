import { db } from '../src/db/index'
import { runPodcastIngestion } from '../src/lib/podcast-ingestion-runner'

try {
  console.info('Podcast ingestion completed', await runPodcastIngestion())
} finally {
  await db.$client.end()
}
