import handler from '@tanstack/react-start/server-entry'

import { paraglideMiddleware } from '#/paraglide/server'

export default {
  fetch(request: Request) {
    // The router handles URL rewriting; keep the original request here.
    return paraglideMiddleware(request, () => handler.fetch(request))
  },
}
