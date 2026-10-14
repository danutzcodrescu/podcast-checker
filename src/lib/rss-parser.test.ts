// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { embeddingContent } from './episode-text'
import { parseRss } from './rss-parser'
import { isPublicAddress, validateFeedUrl } from './rss-fetch'

const wrap = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>History</title><language>en</language><itunes:author>Publisher</itunes:author><atom:link rel="next" href="https://example.com/archive.xml"/>${items}</channel></rss>`
const item = `<item><title>713. King Arthur &amp; Britain</title><itunes:title>King Arthur &amp; Britain</itunes:title><description>Arthur's story.</description><content:encoded><![CDATA[<p>Arthur's story.</p><p>Join The Rest Is History Club: subscribe now.</p><p>This episode is sponsored by Acme.</p><p>Twitter:<br>@host</p><p>Producers: Example</p>]]></content:encoded><guid isPermaLink="false">episode-1</guid><itunes:duration>1:02:03</itunes:duration><itunes:episode>713</itunes:episode><itunes:explicit>yes</itunes:explicit><enclosure url="https://example.com/audio.mp3"/><pubDate>Sun, 11 Oct 2026 23:05:00 GMT</pubDate></item>`

describe('RSS normalization', () => {
  it('extracts namespaced metadata and embeds useful text without duplicated descriptions or promotions', () => {
    const feed = parseRss(wrap(item))
    expect(feed).toMatchObject({
      title: 'History',
      language: 'en',
      publisher: 'Publisher',
      nextUrl: 'https://example.com/archive.xml',
    })
    expect(feed.episodes[0]).toMatchObject({
      guid: 'episode-1',
      title: '713. King Arthur & Britain',
      embeddingTitle: 'King Arthur & Britain',
      durationSeconds: 3723,
      episodeNumber: '713',
      explicit: true,
      cleanedDescription: "Arthur's story.",
      input: "Title: King Arthur & Britain\n\nDescription: Arthur's story.",
    })
    expect(feed.episodes[0].descriptionHtml).toContain('sponsored')
  })

  it('keeps identity stable when audio URLs and titles change, and deduplicates repeated GUIDs', () => {
    const original = parseRss(wrap(item)).episodes[0]
    const changed = parseRss(
      wrap(item.replace('audio.mp3', 'new.mp3').replaceAll('King Arthur', 'Arthur')),
    ).episodes[0]
    expect(changed.key).toBe(original.key)
    expect(changed.contentHash).not.toBe(original.contentHash)
    expect(parseRss(wrap(item + item)).episodes).toHaveLength(1)
  })

  it('uses enclosure identity when GUID is missing and does not collapse episodes sharing a title', () => {
    const missingGuid = item.replace(/<guid[^>]*>.*?<\/guid>/, '')
    expect(
      parseRss(wrap(missingGuid + missingGuid.replace('audio.mp3', 'other.mp3'))).episodes,
    ).toHaveLength(2)
  })

  it('skips malformed items but rejects broken or entity-expanding documents', () => {
    expect(parseRss(wrap('<item><title>Unidentifiable</title></item>' + item)).skipped).toBe(1)
    expect(() => parseRss(wrap('<item><title>Unidentifiable</title></item>'))).toThrow(
      'No RSS items',
    )
    expect(() =>
      parseRss('<!DOCTYPE rss [<!ENTITY bad SYSTEM "file:///etc/passwd">]>' + wrap(item)),
    ).toThrow('declarations')
  })

  it.each(['<rss>', '<rss><channel></rss>', '<rss><channel></channel>'])(
    'rejects invalid XML through the standalone validator: %s',
    (xml) => {
      expect(() => parseRss(xml)).toThrow('Invalid RSS XML')
    },
  )

  it('bounds embedding input for long multilingual descriptions and ignores promotional-only edits', () => {
    const content = embeddingContent('History', '歷史'.repeat(5000))
    expect(Buffer.byteLength(content.input)).toBeLessThanOrEqual(7500)
    expect(content.cleanedDescription.length).toBeGreaterThan(content.input.length)
    expect(
      embeddingContent('History', 'Useful text.\n\nThis episode is sponsored by One.').hash,
    ).toBe(embeddingContent('History', 'Useful text.\n\nThis episode is sponsored by Two.').hash)
  })
})

describe('public feed destinations', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
  it('rejects unsupported protocols, credentials and ports', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://127.0.0.1/feed',
      'http://[::1]/feed',
      'https://user:pass@example.com/feed',
      'http://example.com:8080/rss',
    ]) {
      expect(() => validateFeedUrl(url)).toThrow()
    }
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(validateFeedUrl('https://example.com/rss#fragment').href).toBe('https://example.com/rss')
  })
})
