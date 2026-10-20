// @vitest-environment node
import type { Context } from '@netlify/functions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import dispatch from '../../netlify/functions/podcast-dispatch'
import background from '../../netlify/functions/podcast-ingest-background'
import { authorizedIngestionRequest, dispatchNetlifyIngestion } from './netlify-ingestion'
import { createLogger, logger } from './logger'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./podcast-ingestion-runner', () => ({ runPodcastIngestion: mocks.run }))

const secret = 'a'.repeat(64)
const context = (deployContext = 'production', published = true) =>
  ({ requestId: 'netlify-invocation', deploy: { context: deployContext, published } }) as Context
const request = (token = secret, method = 'POST') =>
  new Request('https://podcasts.example.com/.netlify/functions/podcast-ingest-background', {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })

let entries: any[]
beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'info')
  entries = []
  const captured = createLogger({
    write: (line) => {
      entries.push(JSON.parse(line))
    },
  })
  vi.spyOn(logger, 'child').mockImplementation((bindings) => captured.child(bindings))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Netlify ingestion', () => {
  it('requires a configured secret and rejects missing or wrong credentials', () => {
    vi.stubEnv('INGESTION_SECRET', '')
    expect(() => authorizedIngestionRequest(request())).toThrow('INGESTION_SECRET')
    vi.stubEnv('INGESTION_SECRET', secret)
    expect(authorizedIngestionRequest(request())).toBe(true)
    expect(authorizedIngestionRequest(request('wrong'))).toBe(false)
    expect(authorizedIngestionRequest(new Request('https://example.com'))).toBe(false)
  })

  it('dispatches only to the configured HTTPS site with a bounded authenticated request', async () => {
    vi.stubEnv('INGESTION_SECRET', secret)
    vi.stubEnv('URL', 'https://podcasts.example.com')
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    await dispatchNetlifyIngestion()
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://podcasts.example.com/.netlify/functions/podcast-ingest-background'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    )
    fetch.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(dispatchNetlifyIngestion()).rejects.toThrow('HTTP 500')
    vi.stubEnv('URL', 'http://example.com')
    await expect(dispatchNetlifyIngestion()).rejects.toThrow('HTTPS')
  })

  it('never dispatches from preview or unpublished deploys', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await dispatch(request(), context('deploy-preview'))
    await dispatch(request(), context('production', false))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('only runs background jobs for authenticated POSTs on the published production deploy', async () => {
    vi.stubEnv('INGESTION_SECRET', secret)
    await background(request(), context('deploy-preview'))
    await background(request(), context('production', false))
    await background(request('wrong'), context())
    await background(request(secret, 'GET'), context())
    expect(mocks.run).not.toHaveBeenCalled()
    mocks.run.mockResolvedValueOnce({ feeds: 1 })
    await background(request(), context())
    expect(mocks.run).toHaveBeenCalledOnce()
  })

  it('correlates dispatch and background logs without forwarding credentials into logs', async () => {
    vi.stubEnv('INGESTION_SECRET', secret)
    vi.stubEnv('URL', 'https://podcasts.example.com')
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    await dispatch(
      new Request('https://podcasts.example.com/.netlify/functions/podcast-dispatch'),
      context(),
    )
    const headers = fetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe(`Bearer ${secret}`)
    expect(headers['x-correlation-id']).toBeTruthy()
    mocks.run.mockResolvedValueOnce({ feeds: 2, failures: 0 })
    await background(
      new Request('https://podcasts.example.com/.netlify/functions/podcast-ingest-background', {
        method: 'POST',
        headers,
      }),
      context(),
    )
    const dispatched = entries.find((entry) => entry.event === 'ingestion.dispatched')
    const completed = entries.find((entry) => entry.event === 'ingestion.completed')
    expect(completed).toMatchObject({
      correlationId: dispatched.correlationId,
      invocationId: 'netlify-invocation',
      functionName: 'podcast-ingest-background',
      feeds: 2,
    })
    expect(completed.requestId).not.toBe(dispatched.requestId)
    expect(JSON.stringify(entries)).not.toContain(secret)
  })

  it('logs and rethrows background runner failures so Netlify can retry them', async () => {
    vi.stubEnv('INGESTION_SECRET', secret)
    const err = new Error('Database unavailable')
    mocks.run.mockRejectedValueOnce(err)
    await expect(background(request(), context())).rejects.toBe(err)
    expect(entries.find((entry) => entry.event === 'request.failed')).toMatchObject({
      level: 'error',
      invocationId: 'netlify-invocation',
      err: { message: 'Database unavailable' },
    })
  })
})
