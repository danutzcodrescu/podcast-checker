import handler from '@tanstack/react-start/server-entry'

import { paraglideMiddleware } from '#/paraglide/server'
import { withRequestLogging } from '#/lib/request-logging'

export default {
  fetch(request: Request) {
    // The router handles URL rewriting; keep the original request here.
    return withRequestLogging(request, () =>
      paraglideMiddleware(request, () => handler.fetch(request)),
    )
  },
}
