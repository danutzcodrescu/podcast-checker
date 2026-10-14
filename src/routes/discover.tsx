import { createFileRoute } from '@tanstack/react-router'

import { DiscoverPage } from '#/components/DiscoverPage'
import { getAuthenticatedUser } from '#/lib/auth-middleware'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/discover')({
  beforeLoad: async () => ({ user: await getAuthenticatedUser() }),
  head: () => ({ meta: [{ title: m.search_title() }] }),
  component: Discover,
})

function Discover() {
  const { user } = Route.useRouteContext()
  return <DiscoverPage email={user.email} />
}
