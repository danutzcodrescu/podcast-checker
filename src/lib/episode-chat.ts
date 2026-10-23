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
      .optional()
      .describe(
        'A short question in the listener’s language when clarification is needed. Omit it when no correction question is needed.',
      ),
    unsupportedConstraints: z
      .array(z.string().max(200))
      .max(10)
      .optional()
      .describe(
        'Every unsupported constraint, including duration, arbitrary dates, multiple podcasts/categories, discovery or write actions. Never silently drop one. Omit it when none are identified.',
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringLeaves(value: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (Array.isArray(value)) return value.flatMap((item) => stringLeaves(item, depth + 1))
  if (!isPlainObject(value)) return []
  return Object.values(value).flatMap((item) => stringLeaves(item, depth + 1))
}

/**
 * Some providers encode absent optional metadata as `{}` instead of omitting it
 * or sending `null`. Repair only those two fixed fields: never coerce malformed
 * filters or invent search criteria. Non-empty objects keep their meaning as a
 * clarification question or unsupported constraints, so search stays blocked.
 */
export function repairEpisodeChatToolInput(
  input: unknown,
): { input: Record<string, unknown>; repairs: string[] } | null {
  if (!isPlainObject(input)) return null
  const repaired = { ...input }
  const repairs: string[] = []

  const clarification = repaired.clarification
  if (clarification === null) {
    delete repaired.clarification
    repairs.push('clarification:null')
  } else if (isPlainObject(clarification)) {
    const question = stringLeaves(clarification).join(' ').slice(0, 600)
    if (question) {
      repaired.clarification = question
      repairs.push('clarification:object')
    } else {
      delete repaired.clarification
      repairs.push('clarification:empty-object')
    }
  }

  const constraints = repaired.unsupportedConstraints
  if (constraints === null) {
    delete repaired.unsupportedConstraints
    repairs.push('unsupportedConstraints:null')
  } else if (isPlainObject(constraints)) {
    if (Object.keys(constraints).length === 0) {
      delete repaired.unsupportedConstraints
      repairs.push('unsupportedConstraints:empty-object')
    } else {
      const values = stringLeaves(constraints)
        .slice(0, 10)
        .map((value) => value.slice(0, 200))
      // A non-empty object signals a constraint even when it has no text leaves.
      repaired.unsupportedConstraints = values.length ? values : ['unsupported constraint']
      repairs.push(
        values.length ? 'unsupportedConstraints:object' : 'unsupportedConstraints:untextual-object',
      )
    }
  }

  return repairs.length ? { input: repaired, repairs } : null
}

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
