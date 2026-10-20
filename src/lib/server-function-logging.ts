import { isNotFound, isRedirect } from '@tanstack/react-router'

import { getLogger, withLogContext } from './logger'

// HTTP completion alone misses RPC errors serialized by the framework and
// server functions invoked directly during SSR. Never log function arguments.
export function withServerFunctionLogging<T>(
  meta: { id: string; name: string },
  next: () => Promise<T>,
): Promise<T> {
  return withLogContext({ serverFunction: meta.name, serverFunctionId: meta.id }, async () => {
    const started = performance.now()
    try {
      const result = await next()
      getLogger().info(
        { event: 'server_function.completed', durationMs: Math.round(performance.now() - started) },
        'Server function completed',
      )
      return result
    } catch (err) {
      const controlFlow = isRedirect(err) || isNotFound(err)
      const validation = err instanceof Error && err.name === 'ZodError'
      const level = controlFlow ? 'info' : validation ? 'warn' : 'error'
      getLogger()[level](
        {
          event: controlFlow ? 'server_function.short_circuited' : 'server_function.failed',
          ...(controlFlow ? {} : { err }),
          durationMs: Math.round(performance.now() - started),
        },
        controlFlow ? 'Server function redirected or not found' : 'Server function failed',
      )
      throw err
    }
  })
}
