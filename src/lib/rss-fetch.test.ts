// @vitest-environment node
import type { Agent } from 'undici'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRss } from './rss-fetch'

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  agent: vi.fn(),
  fetch: vi.fn(),
  response: vi.fn(),
}))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return {
    ...actual,
    fetch: mocks.fetch,
    Agent: class extends actual.Agent {
      constructor(options: Agent.Options) {
        super(options)
        mocks.agent(this, options)
      }
    },
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
  mocks.response.mockImplementation(() => new Response('<rss/>'))
  mocks.fetch.mockImplementation(async (url: URL, options: { dispatcher: unknown }) => {
    // Exercise the DNS callback attached to the actual request's dispatcher, without opening sockets.
    const [, agentOptions] = mocks.agent.mock.calls.find(([agent]) => agent === options.dispatcher)!
    await new Promise<void>((resolve, reject) => {
      agentOptions.connect.lookup(url.hostname, { all: true }, (error: Error | null) => {
        if (error) reject(error)
        else resolve()
      })
    })
    return mocks.response()
  })
})

describe('RSS fetch network boundary', () => {
  it('pins public DNS validation to the request dispatcher', async () => {
    expect(await fetchRss('https://feeds.example/rss')).toMatchObject({ xml: '<rss/>' })
    expect(mocks.lookup).toHaveBeenCalledWith('feeds.example', { all: true, order: 'verbatim' })
    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL('https://feeds.example/rss'),
      expect.objectContaining({ redirect: 'manual', dispatcher: expect.anything() }),
    )
  })

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1'])(
    'rejects a public hostname resolving to %s before reading a response',
    async (address) => {
      mocks.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
      await expect(fetchRss('https://feeds.example/rss')).rejects.toThrow('non-public address')
      expect(mocks.response).not.toHaveBeenCalled()
    },
  )

  it('rejects mixed public/private DNS answers', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(fetchRss('https://feeds.example/rss')).rejects.toThrow('non-public address')
    expect(mocks.response).not.toHaveBeenCalled()
  })

  it.each(['http://127.0.0.1/rss', 'http://[::1]/rss'])(
    'rejects a redirect to %s before making another request',
    async (location) => {
      mocks.response.mockReturnValueOnce(new Response(null, { status: 302, headers: { location } }))
      await expect(fetchRss('https://feeds.example/rss')).rejects.toThrow('public HTTP(S) address')
      expect(mocks.fetch).toHaveBeenCalledOnce()
    },
  )

  it('rechecks DNS on redirects and rejects a private destination', async () => {
    mocks.response.mockReturnValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://internal.example/rss' } }),
    )
    mocks.lookup.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
    mocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    await expect(fetchRss('https://feeds.example/rss')).rejects.toThrow('non-public address')
    expect(mocks.lookup).toHaveBeenLastCalledWith('internal.example', {
      all: true,
      order: 'verbatim',
    })
    expect(mocks.response).toHaveBeenCalledOnce()
  })
})
