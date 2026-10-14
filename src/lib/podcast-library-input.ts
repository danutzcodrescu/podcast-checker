import { z } from 'zod'

const webUrl = z.url({ protocol: /^https?$/ }).max(4000)
export const categoryNameInput = z.string().trim().min(1).max(60)
export const podcastIdInput = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const savePodcastInput = z.object({
  podcast: z.object({
    id: podcastIdInput,
    title: z.string().trim().min(1).max(1000),
    publisher: z.string().max(1000),
    appleUrl: webUrl,
    feedUrl: webUrl.nullable(),
    artworkUrl: webUrl.nullable(),
  }),
  categories: z.array(categoryNameInput).max(50),
})

export function categoryId(name: string) {
  return name.trim().toLowerCase()
}
