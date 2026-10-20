import type { Context } from '@netlify/functions'

import { authorizedIngestionRequest } from '../../src/lib/netlify-ingestion'

export default async (request: Request, context: Context) => {
  // Preview deploys must not run jobs against the production database.
  // Background responses are discarded by Netlify (the caller receives 202).
  if (context.deploy.context !== 'production' || !context.deploy.published) return
  if (request.method !== 'POST' || !authorizedIngestionRequest(request)) return
  const { runPodcastIngestion } = await import('../../src/lib/podcast-ingestion-runner')
  console.info('Podcast ingestion completed', await runPodcastIngestion())
}
