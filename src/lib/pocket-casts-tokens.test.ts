// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { decryptPocketCastsTokens, encryptPocketCastsTokens } from './pocket-casts-tokens'

afterEach(() => vi.unstubAllEnvs())

describe('Pocket Casts token storage', () => {
  it('encrypts tokens with fresh nonces and binds them to the owning account', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-at-least-32-characters-long')
    const tokens = { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: 123 }
    const encrypted = encryptPocketCastsTokens('owner', tokens)
    expect(encrypted).not.toContain(tokens.accessToken)
    expect(encrypted).not.toBe(encryptPocketCastsTokens('owner', tokens))
    expect(decryptPocketCastsTokens('owner', encrypted)).toEqual(tokens)
    expect(() => decryptPocketCastsTokens('other', encrypted)).toThrow('auth')
    const tampered = Buffer.from(encrypted, 'base64')
    tampered[tampered.length - 1] ^= 1
    expect(() => decryptPocketCastsTokens('owner', tampered.toString('base64'))).toThrow('auth')
  })

  it('requires a stable encryption secret and rejects tokens encrypted with a previous secret', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    expect(() =>
      encryptPocketCastsTokens('owner', { accessToken: '', refreshToken: '', expiresAt: 0 }),
    ).toThrow('configuration')
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-at-least-32-characters-long')
    const encrypted = encryptPocketCastsTokens('owner', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
    })
    vi.stubEnv('BETTER_AUTH_SECRET', 'another-test-secret-at-least-32-characters-long')
    expect(() => decryptPocketCastsTokens('owner', encrypted)).toThrow('auth')
  })
})
