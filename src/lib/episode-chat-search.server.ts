import {
  episodeChatDecision,
  episodeChatLimit,
  episodeChatResult,
  episodeChatTool,
} from '#/lib/episode-chat'
import { readLatestEpisodes } from '#/lib/episode-query'
import { readPodcastLibrary } from '#/lib/podcast-library-query.server'
import { m } from '#/paraglide/messages'

export function createEpisodeChatSearch(userId: string, signal: AbortSignal, locale: 'en' | 'fr') {
  let used = false
  const correction = m.chat_correction({}, { locale })

  async function resolve(input: unknown) {
    // Claim synchronously before any await: even parallel tool calls cannot fan out searches.
    if (used) return { kind: 'ignored' as const }
    used = true
    signal.throwIfAborted()
    const decision = episodeChatDecision.parse(input)
    const clarification = decision.clarification?.trim() ?? ''
    if (decision.action === 'clarify' || decision.unsupportedConstraints?.length || clarification) {
      return {
        kind: 'clarification' as const,
        message: clarification || correction,
      }
    }

    // Re-read at execution time. Never silently drop an invalid/foreign filter and broaden scope.
    const library = await readPodcastLibrary(userId, signal)
    signal.throwIfAborted()
    const { filters } = decision
    if (
      (filters.podcastId !== null &&
        !library.podcasts.some(({ podcast }) => podcast.id === filters.podcastId)) ||
      (filters.categoryId !== null &&
        !library.categories.some(({ id }) => id === filters.categoryId))
    )
      return { kind: 'clarification' as const, message: correction }

    const effectiveFilters = {
      ...filters,
      sort: !filters.term && filters.sort === 'relevance' ? ('newest' as const) : filters.sort,
    }
    const result = await readLatestEpisodes(
      userId,
      {
        ...effectiveFilters,
        offset: 0,
      },
      signal,
    )
    signal.throwIfAborted()
    const episodes = [
      ...new Map(result.episodes.map((episode) => [episode.id, episode])).values(),
    ].slice(0, episodeChatLimit)
    return episodeChatResult.parse({
      kind: 'results',
      filters: effectiveFilters,
      episodes,
      total: result.total,
      semanticUnavailable: result.semanticUnavailable ?? false,
      ranking: result.ranking?.status ?? null,
    })
  }

  return { tool: episodeChatTool.server(resolve), resolve }
}
