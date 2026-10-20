import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '../db'
import { isFeatureEnabled } from './feature-flags'

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' && !(await isFeatureEnabled('signup_enabled'))) {
        throw new APIError('NOT_FOUND', {
          code: 'NOT_FOUND',
          message: 'Not found.',
        })
      }
    }),
  },
  plugins: [tanstackStartCookies()],
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
})
