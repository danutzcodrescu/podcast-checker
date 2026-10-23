import { createHash } from 'node:crypto'

import { embedEpisodes } from '#/lib/episode-embeddings'
import { embeddingModel } from '#/lib/episode-text'
import { runWithAbort } from '#/lib/abort'

type CachedQuery = {
  expiresAt: number
  embedding: Promise<number[]>
  controller: AbortController
  consumers: number
  settled: boolean
}
const cache = new Map<string, CachedQuery>()
const cacheDuration = 5 * 60_000
const maxEntries = 100

export async function embedEpisodeQuery(term: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  // Reuse query vectors across pagination, filters, and concurrent requests.
  // Cache only a hash and the vector, rather than the user's search text.
  const key = createHash('sha256').update(`${embeddingModel}:${term}`).digest('hex')
  const now = Date.now()
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id)
  }
  let entry = cache.get(key)
  if (!entry) {
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!)
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    const embedding = embedEpisodes([term], requestSignal, 'query').then(([vector]) => vector)
    const created: CachedQuery = {
      expiresAt: now + cacheDuration,
      embedding,
      controller,
      consumers: 0,
      settled: false,
    }
    created.embedding = embedding.then(
      (vector) => {
        created.settled = true
        return vector
      },
      (error: unknown) => {
        created.settled = true
        if (cache.get(key) === created) cache.delete(key)
        throw error
      },
    )
    cache.set(key, created)
    entry = created
  }
  entry.consumers += 1
  try {
    return await runWithAbort(signal, () => entry.embedding)
  } finally {
    entry.consumers -= 1
    // One chat's Stop must not cancel another listener's shared embedding request.
    if (!entry.settled && entry.consumers === 0) {
      if (cache.get(key) === entry) cache.delete(key)
      entry.controller.abort()
    }
  }
}
