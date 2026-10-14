import { z } from 'zod'

import { embeddingDimensions, embeddingModel } from './episode-text'

const embeddingResponse = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()).length(embeddingDimensions),
    }),
  ),
})

export async function embedEpisodes(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is required by the podcast worker')
  const timeout = AbortSignal.timeout(60_000)
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel, dimensions: embeddingDimensions, input: inputs }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  // Do not persist upstream error bodies, which may include request content.
  if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status})`)
  const { data } = embeddingResponse.parse(await response.json())
  const indexed = new Map(data.map((item) => [item.index, item.embedding]))
  if (
    data.length !== inputs.length ||
    indexed.size !== inputs.length ||
    inputs.some((_, index) => !indexed.has(index))
  ) {
    throw new Error('Embedding response did not match the requested episodes')
  }
  return inputs.map((_, index) => indexed.get(index)!)
}
