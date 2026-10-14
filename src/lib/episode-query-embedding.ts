import { createHash } from 'node:crypto'

import { embedEpisodes } from '#/lib/episode-embeddings'
import { embeddingModel } from '#/lib/episode-text'

const cache = new Map<string, { expiresAt: number; embedding: Promise<number[]> }>()
const cacheDuration = 5 * 60_000
const maxEntries = 100

export async function embedEpisodeQuery(term: string) {
  // Reuse query vectors across pagination, filters, and concurrent requests.
  // Cache only a hash and the vector, rather than the user's search text.
  const key = createHash('sha256').update(`${embeddingModel}:${term}`).digest('hex')
  const now = Date.now()
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id)
  }
  const existing = cache.get(key)
  if (existing) return existing.embedding
  if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!)
  const embedding = embedEpisodes([term], AbortSignal.timeout(10_000), 'query').then(
    ([vector]) => vector,
  )
  const entry = { expiresAt: now + cacheDuration, embedding }
  cache.set(key, entry)
  try {
    return await embedding
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key)
    throw error
  }
}
