import { createFileRoute } from '@tanstack/react-router'

import { LibraryPage } from '#/components/library-page'
import { getAuthenticatedUser } from '#/lib/auth-middleware'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/')({
  beforeLoad: async () => ({ user: await getAuthenticatedUser() }),
  head: () => ({ meta: [{ title: m.library_title() }] }),
  component: Home,
})

function Home() {
  const { user } = Route.useRouteContext()
  return <LibraryPage email={user.email} />
}
