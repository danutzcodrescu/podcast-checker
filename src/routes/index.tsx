import { createFileRoute, redirect } from '@tanstack/react-router'

import { getDefaultPodcastRoute } from '#/lib/podcast-library'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    throw redirect({ to: await getDefaultPodcastRoute(), replace: true })
  },
})
