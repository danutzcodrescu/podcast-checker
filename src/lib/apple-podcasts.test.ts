import { afterEach, describe, expect, it, vi } from 'vitest'

import { searchApplePodcasts } from '#/lib/apple-podcasts'

const podcast = {
  kind: 'podcast',
  collectionId: 123,
  collectionName: 'Syntax',
  artistName: 'Wes Bos & Scott Tolinski',
  collectionViewUrl: 'https://podcasts.apple.com/us/podcast/syntax/id123',
  feedUrl: 'https://feeds.example.com/syntax',
  artworkUrl600: 'https://images.example.com/syntax600.jpg',
  artworkUrl100: 'https://images.example.com/syntax100.jpg',
}

afterEach(() => vi.unstubAllGlobals())

describe('Apple podcast search', () => {
  it('requests only podcasts and retains stable IDs and feed URLs for following', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          podcast,
          podcast,
          { ...podcast, kind: 'podcast-episode', collectionId: 456 },
          { ...podcast, collectionId: 789, collectionViewUrl: 'javascript:alert(1)' },
          { ...podcast, collectionId: 234, artworkUrl600: undefined, feedUrl: undefined },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchApplePodcasts('  syntax & web  ')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: 'syntax & web',
      media: 'podcast',
      entity: 'podcast',
      country: 'US',
      limit: '50',
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(results).toEqual([
      {
        id: 123,
        title: 'Syntax',
        publisher: 'Wes Bos & Scott Tolinski',
        appleUrl: podcast.collectionViewUrl,
        feedUrl: podcast.feedUrl,
        artworkUrl: podcast.artworkUrl600,
      },
      {
        id: 234,
        title: 'Syntax',
        publisher: 'Wes Bos & Scott Tolinski',
        appleUrl: podcast.collectionViewUrl,
        feedUrl: null,
        artworkUrl: podcast.artworkUrl100,
      },
    ])
  })

  it('rejects blank and excessively long searches before calling Apple', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchApplePodcasts('   ')).rejects.toThrow()
    await expect(searchApplePodcasts('x'.repeat(201))).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty list for no matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }),
    )
    await expect(searchApplePodcasts('no matches')).resolves.toEqual([])
  })

  it('rejects upstream errors and invalid responses instead of reporting no matches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: [] }) })
      .mockRejectedValueOnce(new Error('Timeout'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchApplePodcasts('syntax')).rejects.toThrow('unavailable')
    await expect(searchApplePodcasts('syntax')).rejects.toThrow()
    await expect(searchApplePodcasts('syntax')).rejects.toThrow('Timeout')
  })
})
