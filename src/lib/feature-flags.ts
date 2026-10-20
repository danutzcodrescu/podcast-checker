import { createServerFn } from '@tanstack/react-start'

export const getSignupEnabled = createServerFn({ method: 'GET' }).handler(async () => {
  const { isFeatureEnabled } = await import('./feature-flags.server')
  return isFeatureEnabled('signup_enabled')
})
