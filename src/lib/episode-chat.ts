import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { episodesInput } from '#/lib/episode-search-input'
import { episodeSearchFromFilters } from '#/lib/episode-search-params'
import type { EpisodeSearchParams } from '#/lib/episode-search-params'
import { savePodcastInput } from '#/lib/podcast-library-input'

export const episodeChatLimit = 10
export const episodeChatPromptLimit = 2000
export const episodeChatToolName = 'resolve_episode_search'
export const episodeChatTimeoutCode = 'CHAT_TIMEOUT'
export const episodeChatFilters = episodesInput
  .omit({ offset: true, searchSessionId: true })
  .extend({
    term: episodesInput.shape.term.unwrap(),
    searchMode: episodesInput.shape.searchMode.unwrap(),
  })
  .strict()

export const episodeChatDecision = z
  .object({
    action: z
      .enum(['search', 'clarify'])
      .describe('Clarify BEFORE searching if ANY constraint is unsupported or ambiguous.'),
    clarification: z
      .string()
      .max(600)
      .nullish()
      .describe(
        'A short question in the listener’s language when clarification is needed; otherwise an empty string. Omitted/null means no correction question.',
      ),
    unsupportedConstraints: z
      .array(z.string().max(200))
      .max(10)
      .nullish()
      .describe(
        'Every unsupported constraint, including duration, arbitrary dates, multiple podcasts/categories, discovery or write actions. Never silently drop one. Use [] when none are identified; omitted/null also means none identified.',
      ),
    filters: episodeChatFilters.describe(
      'Complete resolved criteria, including context from follow-ups. days=null means all time and is the default. Only use IDs from the listener’s library.',
    ),
  })
  .strict()

const chatEpisode = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  publishedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  artworkUrl: z.string().nullable(),
  podcast: savePodcastInput.shape.podcast,
  categories: z.array(z.string()),
  matchType: z.enum(['text', 'semantic']).nullable(),
})

export const episodeChatResult = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('results'),
    filters: episodeChatFilters,
    episodes: z.array(chatEpisode).max(episodeChatLimit),
    total: z.number().int().nonnegative(),
    semanticUnavailable: z.boolean(),
    ranking: z.enum(['applied', 'fallback', 'baseline']).nullable(),
  }),
  z.object({ kind: z.literal('clarification'), message: z.string().min(1).max(600) }),
  z.object({ kind: z.literal('ignored') }),
])

export type EpisodeChatDecision = z.infer<typeof episodeChatDecision>
export type EpisodeChatResult = z.infer<typeof episodeChatResult>
export type EpisodeChatResults = Extract<EpisodeChatResult, { kind: 'results' }>

export const episodeChatTool = toolDefinition({
  name: episodeChatToolName,
  description:
    'Resolve one episode-search request. Either ask for correction without searching, or search only the listener’s followed podcasts. This is the only allowed tool; call it exactly once per response.',
  inputSchema: episodeChatDecision,
  outputSchema: episodeChatResult,
})

export function episodeChatSearchParams(filters: z.infer<typeof episodeChatFilters>) {
  return {
    ...episodeSearchFromFilters(filters),
    days: filters.days ?? 'all',
  } satisfies EpisodeSearchParams
}

/** Tool output is untrusted at the rendering/history boundary, even when it has TS types. */
export function readEpisodeChatResult(output: unknown): EpisodeChatResult | null {
  try {
    const parsed = episodeChatResult.safeParse(
      typeof output === 'string' ? JSON.parse(output) : output,
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
