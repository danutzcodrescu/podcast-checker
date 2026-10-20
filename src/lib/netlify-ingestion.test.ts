// @vitest-environment node
import type { Context } from '@netlify/functions'
import { afterEach, describe, expect, it, vi } from 'vitest'

import dispatch from '../../netlify/functions/podcast-dispatch'
import background from '../../netlify/functions/podcast-ingest-background'
import { authorizedIngestionRequest, dispatchNetlifyIngestion } from './netlify-ingestion'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./podcast-ingestion-runner', () => ({ runPodcastIngestion: mocks.run }))

const secret = 'a'.repeat(64)
const context = (deployContext = 'production', published = true) =>
  ({ deploy: { context: deployContext, published } }) as Context
const request = (token = secret, method = 'POST') =>
  new Request('https://podcasts.example.com/.netlify/functions/podcast-ingest-background', {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await background(request(), context())
    expect(mocks.run).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})
