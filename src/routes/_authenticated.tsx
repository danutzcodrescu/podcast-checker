import { createFileRoute } from '@tanstack/react-router'

import { getAuthenticatedUser } from '#/lib/auth-middleware'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => ({ user: await getAuthenticatedUser() }),
})
