import { z } from 'zod'

import { podcastIdInput } from '#/lib/podcast-library-input'

export const episodeSearchExpired = 'Episode search expired'

export const episodesInput = z.object({
  podcastId: podcastIdInput.nullable(),
  categoryId: z.string().max(120).nullable(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable(),
  sort: z.enum(['newest', 'oldest', 'relevance']),
  term: z.string().trim().max(200).default(''),
  searchMode: z.enum(['hybrid', 'text', 'semantic']).default('hybrid'),
  offset: z.number().int().min(0).max(1_000_000),
  searchSessionId: z.uuid().optional(),
})

export type EpisodeFilters = Omit<z.infer<typeof episodesInput>, 'offset' | 'searchSessionId'>
export type EpisodeSearchMode = EpisodeFilters['searchMode']
