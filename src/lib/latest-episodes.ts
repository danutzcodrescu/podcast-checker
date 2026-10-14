import { createServerFn } from '@tanstack/react-start'

import { requireAuth } from '#/lib/auth-middleware'
import { episodesInput, readLatestEpisodes } from '#/lib/episode-query'

export type { EpisodeFilters, EpisodeSearchMode } from '#/lib/episode-query'

export const getLatestEpisodes = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .validator(episodesInput)
  .handler(({ context, data }) => readLatestEpisodes(context.session.user.id, data))

export type LatestEpisode = Awaited<ReturnType<typeof getLatestEpisodes>>['episodes'][number]
