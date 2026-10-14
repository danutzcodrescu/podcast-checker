import { resolve } from 'node:path'
import { definePlugin } from 'nitro'

import { startPodcastWorker } from '../lib/podcast-worker-supervisor'

export default definePlugin((app) => {
  if (process.env.PODCAST_WORKER_ENABLED === 'false') return
  // srvx defaults to five seconds, which would interrupt active embedding batches.
  process.env.SERVER_SHUTDOWN_TIMEOUT ??= '85'
  const development = process.env.NODE_ENV !== 'production'
  const worker = startPodcastWorker({
    development,
    entry: resolve(
      process.cwd(),
      development ? 'scripts/podcast-worker.ts' : '.output/server/podcast-worker.mjs',
    ),
  })
  app.hooks.hook('close', () => worker.close())
})
