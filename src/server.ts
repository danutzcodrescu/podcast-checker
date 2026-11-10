// oxlint-disable-next-line import/no-unassigned-import -- Initialize before the server handler.
import './instrument.server'

import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'

import { paraglideMiddleware } from '#/paraglide/server'
import { withRequestLogging } from '#/lib/request-logging'

export default wrapFetchWithSentry({
  fetch(request: Request) {
    // The router handles URL rewriting; keep the original request here.
    return withRequestLogging(request, () =>
      paraglideMiddleware(request, () => handler.fetch(request)),
    )
  },
})
