import { createFileRoute } from '@tanstack/react-router'

import { LatestEpisodesPage } from '#/components/LatestEpisodesPage'
import { getAuthenticatedUser } from '#/lib/auth-middleware'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/latest-episodes')({
  beforeLoad: async () => ({ user: await getAuthenticatedUser() }),
  head: () => ({ meta: [{ title: m.episodes_title() }] }),
  component: LatestEpisodes,
})

function LatestEpisodes() {
  const { user } = Route.useRouteContext()
  return <LatestEpisodesPage email={user.email} />
}
