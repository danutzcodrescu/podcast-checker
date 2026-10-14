import { describe, expect, it } from 'vitest'

import { categoryId, categoryNameInput, savePodcastInput } from '#/lib/podcast-library-input'

const podcast = {
  id: 123,
  title: 'Syntax',
  publisher: '',
  appleUrl: 'https://podcasts.apple.com/podcast/id123',
  feedUrl: null,
  artworkUrl: null,
}

describe('podcast library input', () => {
  it('trims category names and gives duplicate names the same case-insensitive identity', () => {
    const data = savePodcastInput.parse({ podcast, categories: [' Development ', 'development'] })
    expect(data.categories).toEqual(['Development', 'development'])
    expect(categoryId(data.categories[0])).toBe(categoryId(data.categories[1]))
  })

  it.each(['', '   ', 'a'.repeat(61)])('rejects an invalid category name', (name) => {
    expect(categoryNameInput.safeParse(name).success).toBe(false)
  })

  it('rejects unsafe podcast links, invalid IDs, and oversized category selections', () => {
    expect(
      savePodcastInput.safeParse({
        podcast: { ...podcast, appleUrl: 'javascript:alert(1)' },
        categories: [],
      }).success,
    ).toBe(false)
    expect(
      savePodcastInput.safeParse({ podcast: { ...podcast, id: -1 }, categories: [] }).success,
    ).toBe(false)
    expect(
      savePodcastInput.safeParse({ podcast, categories: Array(51).fill('Development') }).success,
    ).toBe(false)
  })
})
