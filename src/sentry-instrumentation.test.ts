// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { init } = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('@sentry/tanstackstart-react', () => ({ init }))
// Do not load the developer's .env.local or send errors during tests.
vi.mock('dotenv', () => ({ config: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('SENTRY_DSN', '')
  vi.stubEnv('VITE_SENTRY_DSN', '')
  vi.stubEnv('SENTRY_ENVIRONMENT', '')
  vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Sentry initialization', () => {
  it('does not initialize either SDK without a DSN', async () => {
    await import('./instrument.client')
    await import('./instrument.server')
    expect(init).not.toHaveBeenCalled()
  })

  it('uses only the public browser DSN and environment in the client', async () => {
    vi.stubEnv('SENTRY_DSN', 'server-dsn')
    vi.stubEnv('VITE_SENTRY_DSN', 'browser-dsn')
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'preview')
    await import('./instrument.client')
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'browser-dsn',
        environment: 'preview',
        tracesSampleRate: 0,
      }),
    )
  })

  it('uses server runtime settings rather than build-time browser settings', async () => {
    vi.stubEnv('SENTRY_DSN', 'server-dsn')
    vi.stubEnv('SENTRY_ENVIRONMENT', 'production')
    vi.stubEnv('VITE_SENTRY_DSN', 'browser-dsn')
    await import('./instrument.server')
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'server-dsn',
        environment: 'production',
        tracesSampleRate: 0,
      }),
    )
  })

  it('labels server events with the Netlify context when not overridden', async () => {
    vi.stubEnv('SENTRY_DSN', 'server-dsn')
    vi.stubEnv('CONTEXT', 'deploy-preview')
    await import('./instrument.server')
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'deploy-preview' }))
  })
})
