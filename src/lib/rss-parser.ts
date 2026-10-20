import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { SyntaxValidator } from 'fast-xml-validator'

import { embeddingContent, plainText } from './episode-text'

type Node = Record<string, any>
const array = (value: any): any[] => (value == null ? [] : Array.isArray(value) ? value : [value])
const text = (value: any): string =>
  value == null ? '' : typeof value === 'object' ? text(value['#text']) : String(value)
const nullable = (value: any) => text(value).trim() || null

function itunesCategories(value: any): string[] {
  return array(value)
    .flatMap((category) =>
      [text(category['@_text']).trim()].concat(itunesCategories(category['itunes:category'])),
    )
    .filter(Boolean)
}

function duration(value: any) {
  const raw = text(value).trim()
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(raw)) return null
  const seconds = raw.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
  return seconds <= 2_147_483_647 ? seconds : null
}

function episode(item: Node) {
  const title = plainText(text(item.title) || text(item['itunes:title']))
  if (!title) return null
  const embeddingTitle = plainText(text(item['itunes:title'])) || title
  const descriptionHtml = nullable(item['content:encoded'])
  const description =
    text(item.description) || text(item['itunes:summary']) || descriptionHtml || ''
  const semanticDescription =
    descriptionHtml && plainText(descriptionHtml).length >= plainText(description).length * 0.8
      ? descriptionHtml
      : description
  const content = embeddingContent(
    embeddingTitle,
    semanticDescription,
    text(item['itunes:subtitle']),
  )
  const guid = nullable(item.guid)
  const audioUrl = nullable(array(item.enclosure)[0]?.['@_url'])
  const link = nullable(item.link)
  const published = new Date(text(item.pubDate))
  const publishedAt = Number.isNaN(published.getTime()) ? null : published
  // Never deduplicate by title alone: unrelated episodes frequently share titles.
  const identity = guid
    ? `guid:${guid}`
    : audioUrl
      ? `audio:${audioUrl}`
      : link
        ? `link:${link}`
        : publishedAt
          ? `fallback:${publishedAt.toISOString()}:${title}`
          : null
  if (!identity) return null
  return {
    key: createHash('sha256').update(identity).digest('hex'),
    guid,
    title,
    embeddingTitle,
    description,
    descriptionHtml,
    cleanedDescription: content.cleanedDescription,
    publishedAt,
    durationSeconds: duration(item['itunes:duration']),
    episodeNumber: nullable(item['itunes:episode']),
    seasonNumber: nullable(item['itunes:season']),
    episodeType: nullable(item['itunes:episodeType']),
    explicit: /^(yes|true|explicit)$/i.test(text(item['itunes:explicit']))
      ? true
      : /^(no|false|clean)$/i.test(text(item['itunes:explicit']))
        ? false
        : null,
    audioUrl,
    artworkUrl: nullable(item['itunes:image']?.['@_href']),
    link,
    metadata: {
      subtitle: nullable(item['itunes:subtitle']),
      author: nullable(item['itunes:author']),
      summary: nullable(item['itunes:summary']),
    },
    input: content.input,
    contentHash: content.hash,
  }
}

export function parseRss(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('RSS document declarations are not supported')
  try {
    SyntaxValidator.validate(xml)
  } catch (error) {
    throw new Error('Invalid RSS XML', { cause: error })
  }
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml)
  const channel: Node | undefined = parsed.rss?.channel
  if (!channel || !text(channel.title)) throw new Error('RSS channel with a title is required')
  const items = array(channel.item)
  const episodes = new Map<string, NonNullable<ReturnType<typeof episode>>>()
  let skipped = 0
  for (const item of items) {
    const result = episode(item)
    if (result) episodes.set(result.key, result)
    else skipped++
  }
  // Do not turn an unprocessable nonempty feed into a successful empty import.
  if (items.length && !episodes.size)
    throw new Error('No RSS items have a usable title and episode identity')
  return {
    title: plainText(text(channel.title)),
    description: plainText(text(channel.description)),
    language: nullable(channel.language),
    publisher: nullable(channel['itunes:author']),
    metadata: {
      categories: [
        ...new Set([
          ...itunesCategories(channel['itunes:category']),
          ...array(channel.category)
            .map((category) => text(category).trim())
            .filter(Boolean),
        ]),
      ],
      link: nullable(channel.link),
    },
    nextUrl: nullable(
      array(channel['atom:link']).find((value) => value['@_rel'] === 'next')?.['@_href'],
    ),
    episodes: [...episodes.values()],
    skipped,
  }
}
