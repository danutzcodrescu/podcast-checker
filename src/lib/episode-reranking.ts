import { toRunErrorPayload } from '@tanstack/ai/adapter-internals'

import {
  defaultRerankingModel,
  rerankingVersion,
  scoreEpisodeDocuments,
} from '#/lib/episode-reranking-provider'
import { getLogger } from '#/lib/logger'

export const rerankingCandidateLimit = 50
export const rerankingTimeoutMs = 8_000

export type RankingStatus = {
  status: 'applied' | 'fallback' | 'disabled' | 'skipped'
  model: string
  durationMs: number
}

export type RerankingCandidate = {
  id: string
  title: string
  description: string
  podcastTitle: string
}

export function rerankingConfiguration() {
  return {
    model: process.env.EPISODE_RERANKING_MODEL || defaultRerankingModel,
    enabled:
      process.env.EPISODE_RERANKING_ENABLED !== 'false' && Boolean(process.env.OPENROUTER_API_KEY),
    version: rerankingVersion,
  }
}

// Bound by bytes, not tokens, so both comparison variants see identical metadata.
export function episodeRankingDocument(episode: RerankingCandidate) {
  const text = `Episode: ${episode.title.slice(0, 500)}\nPodcast: ${episode.podcastTitle.slice(0, 300)}\nDescription: ${episode.description.slice(0, 12_000)}`
  return new TextDecoder().decode(Buffer.from(text).subarray(0, 6_000), { stream: true })
}

export async function rerankEpisodes(query: string, candidates: RerankingCandidate[]) {
  const config = rerankingConfiguration()
  const startedAt = Date.now()
  const baseline = candidates.map(({ id }) => id)
  const result = (status: RankingStatus['status'], ids = baseline) => ({
    ids,
    ranking: { status, model: config.model, durationMs: Date.now() - startedAt },
  })
  if (!config.enabled) return result('disabled')
  if (candidates.length < 2) return result('skipped')
  try {
    const { scores, cost } = await scoreEpisodeDocuments(
      query,
      candidates.map(episodeRankingDocument),
      config.model,
      process.env.OPENROUTER_API_KEY!,
      AbortSignal.timeout(rerankingTimeoutMs),
    )
    if (scores.length !== candidates.length || scores.some((score) => !Number.isFinite(score))) {
      throw new Error('Invalid episode relevance scores')
    }
    const scored = candidates.map(({ id }, index) => ({ id, index, score: scores[index] }))
    scored.sort((a, b) => b.score - a.score || a.index - b.index)
    const ids = scored.map(({ id }) => id)
    const ranked = result('applied', ids)
    getLogger().info(
      { event: 'search.reranked', ...ranked.ranking, candidateCount: candidates.length, cost },
      'Episode candidates reranked',
    )
    return ranked
  } catch (error) {
    // Never log upstream bodies, query text, descriptions, or fetch errors containing payloads.
    const fallback = result('fallback')
    getLogger().warn(
      {
        event: 'search.reranking_unavailable',
        errorCode: toRunErrorPayload(error).code,
        ...fallback.ranking,
        candidateCount: candidates.length,
      },
      'Using original episode ranking',
    )
    return fallback
  }
}
