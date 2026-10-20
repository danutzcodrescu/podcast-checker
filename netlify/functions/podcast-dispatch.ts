import type { Context } from '@netlify/functions'

import { dispatchNetlifyIngestion } from '../../src/lib/netlify-ingestion'

export default async (_request: Request, context: Context) => {
  if (context.deploy.context !== 'production' || !context.deploy.published)
    return new Response(null, { status: 204 })
  await dispatchNetlifyIngestion()
  return new Response(null, { status: 204 })
}
