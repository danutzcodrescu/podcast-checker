import type { Context } from '@netlify/functions'

import { authorizedIngestionRequest, localIngestionContext } from '../../src/lib/netlify-ingestion'
import { getLogger } from '../../src/lib/logger'
import { withRequestLogging } from '../../src/lib/request-logging'

export default (request: Request, context: Context) =>
  withRequestLogging(
    request,
    async () => {
      // Preview deploys must not run jobs against the production database.
      // Background responses are discarded by Netlify (the caller receives 202).
      if (
        !localIngestionContext() &&
        (context.deploy.context !== 'production' || !context.deploy.published)
      ) {
        getLogger().info(
          { event: 'ingestion.skipped', reason: 'inactive_deploy' },
          'Background ingestion skipped',
        )
        return
      }
      if (request.method !== 'POST' || !authorizedIngestionRequest(request)) {
        getLogger().warn(
          { event: 'ingestion.rejected', reason: 'unauthorized_or_invalid_method' },
          'Background ingestion rejected',
        )
        return
      }
      const { runPodcastIngestion } = await import('../../src/lib/podcast-ingestion-runner')
      const result = await runPodcastIngestion()
      getLogger().info({ event: 'ingestion.completed', ...result }, 'Podcast ingestion completed')
    },
    {
      functionName: 'podcast-ingest-background',
      invocationId: context.requestId,
      deployContext: context.deploy.context,
    },
  )
