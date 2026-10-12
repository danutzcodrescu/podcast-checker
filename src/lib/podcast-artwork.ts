const artworkWidths = [80, 112, 160, 224, 336, 600]
const artworkSizeSegment = /\/\d+x\d+bb(?=\.[a-z]+$|$)/i

export function getPodcastArtworkSrcSet(artworkUrl: string): string | undefined {
  const url = new URL(artworkUrl)
  // Apple's artwork CDN supports resizing via the final size segment.
  // Preserve other image providers' URLs without assuming they can be resized.
  if (!url.hostname.endsWith('.mzstatic.com') || !artworkSizeSegment.test(url.pathname)) {
    return undefined
  }

  return artworkWidths
    .map((width) => {
      const source = new URL(url)
      source.pathname = source.pathname.replace(artworkSizeSegment, `/${width}x${width}bb`)
      return `${source.href} ${width}w`
    })
    .join(', ')
}
