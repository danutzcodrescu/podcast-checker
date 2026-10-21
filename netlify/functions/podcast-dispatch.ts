import type { Context } from '@netlify/functions'

import { dispatchNetlifyIngestion, localIngestionContext } from '../../src/lib/netlify-ingestion'
import { getLogger } from '../../src/lib/logger'
import { withRequestLogging } from '../../src/lib/request-logging'

export default (request: Request, context: Context) =>
  withRequestLogging(
    request,
    async () => {
      const local = localIngestionContext()
      if (!local && (context.deploy.context !== 'production' || !context.deploy.published)) {
        getLogger().info(
          { event: 'ingestion.skipped', reason: 'inactive_deploy' },
          'Ingestion dispatch skipped',
        )
        return new Response(null, { status: 204 })
      }
      await dispatchNetlifyIngestion(local)
      getLogger().info({ event: 'ingestion.dispatched' }, 'Background ingestion accepted')
      return new Response(null, { status: 204 })
    },
    {
      functionName: 'podcast-dispatch',
      invocationId: context.requestId,
      deployContext: context.deploy.context,
    },
  )
