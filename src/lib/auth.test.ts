// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auth } from './auth'

const mocks = vi.hoisted(() => ({ enabled: vi.fn() }))

vi.mock('./feature-flags.server', () => ({ isFeatureEnabled: mocks.enabled }))
vi.mock('#/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const schema = await import('#/db/auth-schema')
  return { db: drizzle.mock({ schema }) }
})
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  createAuthMiddleware: (handler: unknown) => handler,
}))

beforeEach(() => mocks.enabled.mockResolvedValue(false))

describe('sign-up protection', () => {
  const before = auth.options.hooks!.before!

  it('rejects sign-up requests with a generic HTTP 404 when disabled', async () => {
    await expect(before({ path: '/sign-up/email' } as never)).rejects.toMatchObject({
      status: 'NOT_FOUND',
      body: { code: 'NOT_FOUND', message: 'Not found.' },
    })
    expect(mocks.enabled).toHaveBeenCalledWith('signup_enabled')
  })

  it('allows sign-up requests when enabled', async () => {
    mocks.enabled.mockResolvedValue(true)

    await expect(before({ path: '/sign-up/email' } as never)).resolves.toBeUndefined()
  })

  it.each(['/sign-in/email', '/get-session', '/sign-out'])(
    'leaves existing-account endpoint %s available without checking the flag',
    async (path) => {
      await expect(before({ path } as never)).resolves.toBeUndefined()
      expect(mocks.enabled).not.toHaveBeenCalled()
    },
  )

  it('does not allow registration if the flag cannot be read', async () => {
    mocks.enabled.mockRejectedValueOnce(new Error('Database unavailable'))

    await expect(before({ path: '/sign-up/email' } as never)).rejects.toThrow(
      'Database unavailable',
    )
  })
})
