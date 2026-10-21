import { z } from 'zod'

import { podcastIdInput } from '#/lib/podcast-library-input'

export const episodeSearchExpired = 'Episode search expired'
export const episodePageSize = 25
export const episodeTermMaxLength = 200
export const episodeCategoryMaxLength = 120

// One source for the values the URL parser and the server input agree on.
export const episodeDays = [7, 30, 90] as const
export type EpisodeDay = (typeof episodeDays)[number]
export const episodeSorts = ['newest', 'oldest', 'relevance'] as const
export const episodeModes = ['hybrid', 'text', 'semantic'] as const

export const episodesInput = z.object({
  podcastId: podcastIdInput.nullable(),
  categoryId: z.string().max(episodeCategoryMaxLength).nullable(),
  days: z
    .union([z.literal(episodeDays[0]), z.literal(episodeDays[1]), z.literal(episodeDays[2])])
    .nullable(),
  sort: z.enum(episodeSorts),
  term: z.string().trim().max(episodeTermMaxLength).default(''),
  searchMode: z.enum(episodeModes).default('hybrid'),
  offset: z.number().int().min(0).max(1_000_000),
  searchSessionId: z.uuid().optional(),
})

export type EpisodeSearchInput = z.infer<typeof episodesInput>
export type EpisodeFilters = Omit<EpisodeSearchInput, 'offset' | 'searchSessionId'>
export type EpisodeSearchMode = EpisodeFilters['searchMode']
