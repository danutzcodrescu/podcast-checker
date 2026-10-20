import { randomUUID } from 'node:crypto'
import type { Bindings } from 'pino'

import { getLogger, withLogContext } from './logger'

// Incoming IDs are untrusted telemetry, never authorization. Bound their size
// and alphabet to prevent log injection and unbounded log fields.
export function correlationId(request: Request) {
  const value = request.headers.get('x-correlation-id')
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined
}

export function withRequestLogging<T extends Response | void>(
  request: Request,
  handle: () => Promise<T> | T,
  bindings: Bindings = {},
): Promise<T> {
  const requestId = randomUUID()
  return withLogContext(
    {
      ...bindings,
      requestId,
      correlationId: correlationId(request) ?? requestId,
      method: request.method,
      pathname: new URL(request.url).pathname,
    },
    async () => {
      const log = getLogger()
      const started = performance.now()
      log.debug({ event: 'request.started' }, 'Request started')
      try {
        const response = await handle()
        const status = response instanceof Response ? response.status : undefined
        const level = status && status >= 500 ? 'error' : status && status >= 400 ? 'warn' : 'info'
        log[level](
          {
            event: 'request.completed',
            status,
            durationMs: Math.round(performance.now() - started),
          },
          'Request completed',
        )
        if (response instanceof Response) {
          // Fetch responses can have immutable headers. Preserve streaming bodies.
          const headers = new Headers(response.headers)
          headers.set('x-request-id', requestId)
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          }) as T
        }
        return response
      } catch (err) {
        log.error(
          { event: 'request.failed', err, durationMs: Math.round(performance.now() - started) },
          'Request failed',
        )
        throw err
      }
    },
  )
}
