/* eslint-disable no-await-in-loop -- Redirects must be validated and fetched sequentially. */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent, fetch } from 'undici'

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

export function validateFeedUrl(value: string) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new Error('Feed URL must use a public HTTP(S) address on port 80 or 443')
  }
  url.hash = ''
  return url
}

export type FeedResponse = {
  xml: string | null
  url: string
  etag: string | null
  lastModified: string | null
}

export async function fetchRss(
  value: string,
  validators: { etag?: string | null; lastModified?: string | null } = {},
  signal?: AbortSignal,
): Promise<FeedResponse> {
  // Validate and pin DNS resolution at connection time, including every redirect.
  // A separate preflight DNS check alone is vulnerable to DNS rebinding.
  const dispatcher = new Agent({
    connect: {
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true, order: 'verbatim' })
          .then((addresses) => {
            if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
              callback(new Error('Feed hostname resolves to a non-public address'), '', 4)
              return
            }
            if (options.all) callback(null, addresses)
            else callback(null, addresses[0].address, addresses[0].family)
          })
          .catch((error: Error) => callback(error, '', 4))
      },
    },
  })
  try {
    let url = validateFeedUrl(value)
    const headers: Record<string, string> = {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': 'PodcastChecker/1.0',
    }
    if (validators.etag) headers['If-None-Match'] = validators.etag
    if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified
    const timeout = AbortSignal.timeout(30_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetch(url, {
        headers,
        dispatcher,
        redirect: 'manual',
        signal: combined,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location) throw new Error('RSS redirect has no destination')
        const next = validateFeedUrl(new URL(location, url).href)
        if (next.origin !== url.origin) {
          delete headers['If-None-Match']
          delete headers['If-Modified-Since']
        }
        url = next
        continue
      }
      const result = {
        url: url.href,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      }
      if (response.status === 304) return { ...result, xml: null }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`RSS request failed (HTTP ${response.status})`)
      }
      const chunks: Uint8Array[] = []
      let size = 0
      if (!response.body) throw new Error('RSS response is empty')
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > 10 * 1024 * 1024) throw new Error('RSS response exceeds 10 MiB')
        chunks.push(chunk)
      }
      return { ...result, xml: Buffer.concat(chunks).toString('utf8') }
    }
    throw new Error('Too many RSS redirects')
  } finally {
    await dispatcher.close()
  }
}
