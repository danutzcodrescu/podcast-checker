import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { featureFlag } from '#/db/feature-flag-schema'
import { getSignupEnabled, isFeatureEnabled } from './feature-flags'

const mocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn(), limit: vi.fn() }))

vi.mock('#/db', () => ({ db: { select: mocks.select } }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (handler: () => Promise<boolean>) => handler }),
}))

beforeEach(() => {
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
})

describe('database feature flags', () => {
  it('defaults missing flags to false', async () => {
    expect(await isFeatureEnabled('unknown')).toBe(false)
    expect(mocks.from).toHaveBeenCalledWith(featureFlag)
    expect(mocks.where).toHaveBeenCalledWith(eq(featureFlag.key, 'unknown'))
    expect(mocks.limit).toHaveBeenCalledWith(1)
  })

  it('reads the signup flag and reflects toggles without caching', async () => {
    mocks.limit
      .mockResolvedValueOnce([{ enabled: false }])
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ enabled: false }])

    expect(await getSignupEnabled()).toBe(false)
    expect(await getSignupEnabled()).toBe(true)
    expect(await getSignupEnabled()).toBe(false)
    expect(mocks.where).toHaveBeenCalledWith(eq(featureFlag.key, 'signup_enabled'))
    expect(mocks.select).toHaveBeenCalledTimes(3)
  })

  it('does not enable flags when the database is unavailable', async () => {
    mocks.limit.mockRejectedValueOnce(new Error('Database unavailable'))

    await expect(isFeatureEnabled('signup_enabled')).rejects.toThrow('Database unavailable')
  })
})
