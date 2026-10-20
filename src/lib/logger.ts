// oxlint-disable-next-line import/no-unassigned-import -- Keep Node logging out of browser bundles.
import '@tanstack/react-start/server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from 'dotenv'
import pino from 'pino'
import type { Bindings, DestinationStream, Logger } from 'pino'

config({ path: ['.env.local', '.env'], quiet: true })

// Do not serialize arbitrary error properties (SQL parameters, HTTP headers,
// upstream response bodies, etc.). Drizzle's wrapper message includes SQL values.
function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { type: 'UnknownError' }
  const databaseQuery = 'query' in error && 'params' in error
  const validation = error.name === 'ZodError'
  const message = databaseQuery
    ? 'Database query failed'
    : validation
      ? 'Input validation failed'
      : error.message
  return {
    type: error.name,
    message,
    // Validation/SQL wrapper messages may be multiline and contain input values.
    stack:
      databaseQuery || validation
        ? error.stack
            ?.split('\n')
            .filter((line) => /^\s+at /.test(line))
            .join('\n')
        : error.stack,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
  }
}

export function createLogger(
  destination: DestinationStream = pino.destination({ dest: 1, sync: true }),
) {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: {
        service: 'podcast-checker',
        environment: process.env.CONTEXT || process.env.NODE_ENV || 'development',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (level) => ({ level }) },
      serializers: { err: serializeError },
      redact: {
        paths: [
          'authorization',
          'cookie',
          'password',
          'token',
          'accessToken',
          'refreshToken',
          'secret',
          '*.authorization',
          '*.cookie',
          '*.password',
          '*.token',
          '*.accessToken',
          '*.refreshToken',
          '*.secret',
          'headers',
          'body',
          'query',
          'req',
          'res',
          'request',
          'response',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  )
}

export const logger = createLogger()
const context = new AsyncLocalStorage<Logger>()

export function getLogger() {
  return context.getStore() ?? logger
}

/** Context is isolated across concurrent requests and inherited by awaited work. */
export function withLogContext<T>(bindings: Bindings, action: () => T): T {
  return context.run(getLogger().child(bindings), action)
}
