import { embed } from '@tanstack/ai'
import { createCloudflareEmbedding } from '@tanstack/ai-cloudflare'
import { z } from 'zod'

import { embeddingDimensions, embeddingModel } from './episode-text'

const embeddingResponse = z.object({
  success: z.literal(true),
  result: z.object({
    shape: z.tuple([z.number().int().nonnegative(), z.literal(embeddingDimensions)]),
    data: z.array(z.array(z.number()).length(embeddingDimensions)),
  }),
})

export function cloudflareEmbeddingsConfigured() {
  return (
    /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '') &&
    Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim())
  )
}

const providerError = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ code: z.number().int() })).optional(),
})

export async function embedEpisodes(
  inputs: string[],
  signal?: AbortSignal,
  purpose: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (!inputs.length) return []
  z.array(z.string().min(1)).max(32).parse(inputs)
  if (!cloudflareEmbeddingsConfigured()) {
    throw new Error(
      'A valid CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for embeddings',
    )
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!.trim()
  const token = process.env.CLOUDFLARE_API_TOKEN!.trim()
  const timeout = AbortSignal.timeout(60_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  requestSignal.throwIfAborted()
  const result = await embed({
    adapter: createCloudflareEmbedding(embeddingModel, {
      accountId,
      apiKey: token,
      // The generic adapter sends `text` and does not forward abort signals yet.
      // Preserve Qwen's native inputs, cancellation and our safe diagnostic boundary.
      fetch: async (url, init) => {
        const response = await fetch(url, {
          ...init,
          signal: requestSignal,
          body: JSON.stringify(
            purpose === 'query'
              ? {
                  queries: inputs,
                  instruction:
                    'Given a podcast search query, retrieve relevant podcast episodes based on their titles and descriptions.',
                }
              : { documents: inputs },
          ),
        })
        const body: unknown = await response.json().catch(() => null)
        const failure = providerError.safeParse(body)
        if (!response.ok || (failure.success && failure.data.success === false)) {
          const code = failure.success ? failure.data.errors?.[0]?.code : undefined
          const reason =
            code === 3036
              ? 'daily free neuron allowance exhausted; resets at 00:00 UTC'
              : code === 3040
                ? 'model temporarily out of capacity'
                : response.status === 401 || response.status === 403
                  ? 'check Cloudflare account and Workers AI token permissions'
                  : response.status === 429
                    ? 'rate limit or allowance reached'
                    : null
          throw new Error(
            `Cloudflare embedding request failed (HTTP ${response.status}${code !== undefined ? `; code ${code}` : ''})${reason ? `: ${reason}` : ''}`,
          )
        }
        const parsed = embeddingResponse.safeParse(body)
        if (!parsed.success) throw new Error('Cloudflare returned an invalid embedding response')
        if (
          parsed.data.result.data.length !== inputs.length ||
          parsed.data.result.shape[0] !== inputs.length
        ) {
          throw new Error('Cloudflare embedding response did not match the requested inputs')
        }
        // Only a validated successful envelope reaches the adapter's normal response mapping.
        return Response.json(parsed.data)
      },
    }),
    input: inputs,
    debug: false,
  })
  requestSignal.throwIfAborted()
  return result.embeddings.map(({ vector }) => vector)
}
