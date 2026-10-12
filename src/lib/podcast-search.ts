import { createServerFn } from '@tanstack/react-start'

import { podcastSearchInput, searchApplePodcasts } from '#/lib/apple-podcasts'
import { requireAuth } from '#/lib/auth-middleware'

export const searchPodcasts = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .validator(podcastSearchInput)
  .handler(({ data }) => searchApplePodcasts(data.term))
