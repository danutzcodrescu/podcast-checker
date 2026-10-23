import { createFileRoute } from '@tanstack/react-router'

import { handleEpisodeChatRequest } from '#/lib/episode-chat.server'

export const Route = createFileRoute('/api/chat')({
  server: { handlers: { POST: ({ request }) => handleEpisodeChatRequest(request) } },
})
