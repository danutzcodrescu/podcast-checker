import { isNotFound, isRedirect } from '@tanstack/react-router'
import type { BrowserOptions, ErrorEvent, EventHint } from '@sentry/tanstackstart-react'

// Match the application's logging policy: no credentials, search text, chat
// content, SQL parameters, or arbitrary error properties in external telemetry.
export function beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  const error = hint.originalException
  if (isRedirect(error) || isNotFound(error)) return null
  if (error instanceof Error && error.name === 'ZodError') return null

  const databaseError = error instanceof Error && 'query' in error && 'params' in error
  for (const exception of event.exception?.values ?? []) {
    if (databaseError || exception.value?.startsWith('Failed query:')) {
      exception.value = 'Database query failed'
    }
  }

  delete event.extra
  delete event.user
  if (event.request) {
    const { method, url } = event.request
    // Do not retain headers, cookies, request bodies, or query strings.
    event.request = { method, url: url?.split(/[?#]/, 1)[0] }
  }
  return event
}

export const sentryOptions = {
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  beforeSend,
  beforeSendLog: () => null,
  beforeSendMetric: () => null,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
} satisfies BrowserOptions
