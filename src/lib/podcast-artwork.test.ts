import { describe, expect, it } from 'vitest'

import { getPodcastArtworkSrcSet } from '#/lib/podcast-artwork'

describe('podcast artwork sources', () => {
  it('offers correctly sized Apple CDN images for mobile, desktop, and high-density screens', () => {
    const srcSet = getPodcastArtworkSrcSet(
      'https://is1-ssl.mzstatic.com/image/thumb/Podcasts/show.jpeg/600x600bb.jpg?quality=90',
    )

    expect(srcSet?.split(', ')).toEqual(
      [80, 112, 160, 224, 336, 600].map(
        (width) =>
          `https://is1-ssl.mzstatic.com/image/thumb/Podcasts/show.jpeg/${width}x${width}bb.jpg?quality=90 ${width}w`,
      ),
    )
  })

  it('leaves third-party and unrecognized artwork URLs untouched', () => {
    expect(getPodcastArtworkSrcSet('https://images.example.com/600x600bb.jpg')).toBeUndefined()
    expect(
      getPodcastArtworkSrcSet('https://mzstatic.com.example.com/600x600bb.jpg'),
    ).toBeUndefined()
    expect(
      getPodcastArtworkSrcSet('https://is1-ssl.mzstatic.com/image/artwork.jpg'),
    ).toBeUndefined()
  })
})
