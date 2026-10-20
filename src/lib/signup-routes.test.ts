import { describe, expect, it, vi } from 'vitest'

import { Route as SignupRoute } from '#/routes/signup'
import { Route as SigninRoute } from '#/routes/signin'

const mocks = vi.hoisted(() => ({ enabled: vi.fn() }))

vi.mock('#/lib/feature-flags', () => ({ getSignupEnabled: mocks.enabled }))
vi.mock('#/components/AuthPage', () => ({ AuthPage: () => null }))

describe('registration route guards', () => {
  it('returns the not-found page when sign-up is disabled', async () => {
    mocks.enabled.mockResolvedValueOnce(false)

    await expect(SignupRoute.options.beforeLoad!({} as never)).rejects.toMatchObject({
      isNotFound: true,
    })
  })

  it('allows the sign-up page when enabled', async () => {
    mocks.enabled.mockResolvedValueOnce(true)

    await expect(SignupRoute.options.beforeLoad!({} as never)).resolves.toBeUndefined()
  })

  it.each([false, true])('provides sign-in with signupEnabled=%s', async (enabled) => {
    mocks.enabled.mockResolvedValueOnce(enabled)

    await expect(SigninRoute.options.beforeLoad!({} as never)).resolves.toEqual({
      signupEnabled: enabled,
    })
  })
})
