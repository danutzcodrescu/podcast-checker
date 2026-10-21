import { rerank } from '@tanstack/ai'
import { createOpenRouterRerank } from '@tanstack/ai-openrouter'

export const defaultRerankingModel = 'nvidia/llama-nemotron-rerank-vl-1b-v2:free'
export const rerankingVersion = 'nvidia-tanstack-v1'

export async function scoreEpisodeDocuments(
  query: string,
  documents: string[],
  model: string,
  apiKey: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const result = await rerank({
    adapter: createOpenRouterRerank(model, apiKey, {
      // Reuse the adapter's SDK retry/backoff and typed provider errors, not a second retry loop.
      retryConfig: {
        strategy: 'backoff',
        retryConnectionErrors: true,
        backoff: { initialInterval: 200, maxInterval: 500, exponent: 1.5, maxElapsedTime: 1_500 },
      },
    }),
    query,
    documents,
    topN: documents.length,
    abortSignal: signal,
    // SDK error messages may contain upstream bodies. Only our sanitized status logs are enabled.
    debug: false,
  })
  signal.throwIfAborted()
  if (
    result.ranking.length !== documents.length ||
    new Set(result.ranking.map(({ index }) => index)).size !== documents.length ||
    result.ranking.some(
      ({ index, score }) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= documents.length ||
        !Number.isFinite(score),
    )
  ) {
    throw new Error('Incomplete episode reranking response')
  }
  const scores = Array.from({ length: documents.length }, () => 0)
  for (const { index, score } of result.ranking) scores[index] = score
  return { scores, cost: result.usage.cost }
}
