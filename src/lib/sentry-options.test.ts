// @vitest-environment node
import { notFound, redirect } from '@tanstack/react-router'
import * as Sentry from '@sentry/tanstackstart-react'
import type { ErrorEvent } from '@sentry/tanstackstart-react'
import { afterEach, describe, expect, it } from 'vitest'

import { beforeSend, sentryOptions } from './sentry-options'

afterEach(async () => {
  await Sentry.close()
})

describe('Sentry privacy policy', () => {
  it('disables sensitive automatic collection, breadcrumbs, tracing, logs, and metrics', () => {
    expect(sentryOptions.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    })
    expect(sentryOptions.maxBreadcrumbs).toBe(0)
    expect(sentryOptions.tracesSampleRate).toBe(0)
    expect(sentryOptions.beforeSendLog()).toBeNull()
    expect(sentryOptions.beforeSendMetric()).toBeNull()
  })

  it('does not report redirects, not-found results, or input validation', () => {
    for (const error of [
      redirect({ to: '/signin' }),
      notFound(),
      Object.assign(new Error('private-input'), { name: 'ZodError' }),
    ]) {
      expect(beforeSend({ type: undefined }, { originalException: error })).toBeNull()
    }
  })

  it('removes private request and error context while retaining stack locations', () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: 'private-email' },
      extra: { arguments: ['private-chat'], query: 'private-query' },
      request: {
        method: 'POST',
        url: 'https://example.com/api/chat?q=private-search#private-fragment',
        headers: { authorization: 'private-token' },
        cookies: { session: 'private-cookie' },
        data: 'private-body',
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Upstream unavailable',
            stacktrace: { frames: [{ lineno: 12 }] },
          },
        ],
      },
    }
    const result = beforeSend(event, { originalException: new Error('Upstream unavailable') })
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(result?.request).toEqual({ method: 'POST', url: 'https://example.com/api/chat' })
    expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(12)
  })

  it('sanitizes database wrapper errors and their nested cause messages', () => {
    const error = Object.assign(new Error('Failed query: private-query'), {
      query: 'private-query',
      params: ['private-input'],
    })
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          { type: 'DatabaseError', value: 'invalid value private-input' },
          { type: 'Error', value: error.message },
        ],
      },
    }
    const result = beforeSend(event, { originalException: error })
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(result?.exception?.values?.map((value) => value.value)).toEqual([
      'Database query failed',
      'Database query failed',
    ])
  })

  it('sanitizes database messages serialized across the server-function boundary', () => {
    const result = beforeSend(
      { type: undefined, exception: { values: [{ value: 'Failed query: private-query' }] } },
      {},
    )
    expect(result?.exception?.values?.[0].value).toBe('Database query failed')
  })

  it('applies the policy to actual SDK captures without contacting Sentry', async () => {
    const envelopes: string[] = []
    Sentry.init({
      ...sentryOptions,
      dsn: 'https://public@example.com/1',
      defaultIntegrations: false,
      transport: () => ({
        send: async (envelope) => {
          if (envelope[1].some(([header]) => header.type === 'event')) {
            envelopes.push(JSON.stringify(envelope))
          }
          return { statusCode: 200 }
        },
        flush: async () => true,
      }),
    } satisfies Sentry.BrowserOptions)
    Sentry.captureException(new Error('Sentry integration test'), {
      extra: { body: 'private-body' },
      user: { email: 'private-email' },
    })
    Sentry.captureException(redirect({ to: '/signin' }))
    await Sentry.flush()
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toContain('Sentry integration test')
    expect(envelopes[0]).not.toContain('private-')
  })
})
