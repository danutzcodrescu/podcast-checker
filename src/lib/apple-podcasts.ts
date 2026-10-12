import { z } from 'zod'

export const podcastSearchInput = z.object({ term: z.string().trim().min(1).max(200) })

const webUrl = z.url({ protocol: /^https?$/ })
const applePodcast = z.object({
  kind: z.literal('podcast'),
  collectionId: z.number().int().positive(),
  collectionName: z.string().min(1),
  artistName: z.string().optional(),
  collectionViewUrl: webUrl,
  feedUrl: webUrl.optional(),
  artworkUrl600: webUrl.optional(),
  artworkUrl100: webUrl.optional(),
})
const appleSearchResponse = z.object({ results: z.array(z.unknown()) })

export type Podcast = {
  id: number
  title: string
  publisher: string
  appleUrl: string
  feedUrl: string | null
  artworkUrl: string | null
}

export async function searchApplePodcasts(term: string): Promise<Podcast[]> {
  const input = podcastSearchInput.parse({ term })
  const url = new URL('https://itunes.apple.com/search')
  url.search = new URLSearchParams({
    term: input.term,
    media: 'podcast',
    entity: 'podcast',
    country: 'US',
    limit: '50',
  }).toString()

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Apple podcast search is unavailable')

  const { results } = appleSearchResponse.parse(await response.json())
  const podcasts = new Map<number, Podcast>()
  for (const result of results) {
    const parsed = applePodcast.safeParse(result)
    if (!parsed.success) continue
    const podcast = parsed.data
    if (podcasts.has(podcast.collectionId)) continue
    podcasts.set(podcast.collectionId, {
      id: podcast.collectionId,
      title: podcast.collectionName,
      publisher: podcast.artistName ?? '',
      appleUrl: podcast.collectionViewUrl,
      feedUrl: podcast.feedUrl ?? null,
      artworkUrl: podcast.artworkUrl600 ?? podcast.artworkUrl100 ?? null,
    })
  }
  return [...podcasts.values()]
}
