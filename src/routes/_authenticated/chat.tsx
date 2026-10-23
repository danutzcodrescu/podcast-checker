import { createFileRoute } from '@tanstack/react-router'

import { EpisodeChatPage } from '#/components/EpisodeChatPage'
import { libraryQueryOptions } from '#/lib/library-queries'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_authenticated/chat')({
  loader: async ({ context }) => {
    try {
      await context.queryClient.query(libraryQueryOptions(context.user.email))
    } catch {
      /* The page provides an inline retry. */
    }
  },
  head: () => ({ meta: [{ title: m.chat_title() }] }),
  component: Chat,
})

function Chat() {
  const { user } = Route.useRouteContext()
  return <EpisodeChatPage email={user.email} />
}
