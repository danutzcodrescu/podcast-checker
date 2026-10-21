import { createFileRoute } from '@tanstack/react-router'

import { DiscoverPage } from '#/components/DiscoverPage'
import { libraryQueryOptions } from '#/lib/library-queries'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_authenticated/discover')({
  loader: async ({ context }) => {
    try {
      await context.queryClient.query(libraryQueryOptions(context.user.email))
    } catch {
      // Keep the page mounted; it shows its inline load error and retries on mount.
    }
  },
  head: () => ({ meta: [{ title: m.search_title() }] }),
  component: Discover,
})

function Discover() {
  const { user } = Route.useRouteContext()
  return <DiscoverPage email={user.email} />
}
