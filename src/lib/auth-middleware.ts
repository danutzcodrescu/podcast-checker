import { redirect } from '@tanstack/react-router'
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '#/lib/auth'

export const requireAuth = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })

  if (!session) {
    throw redirect({ to: '/signin' })
  }

  return next({ context: { session } })
})

export const getAuthenticatedUser = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(({ context }) => ({ email: context.session.user.email }))
