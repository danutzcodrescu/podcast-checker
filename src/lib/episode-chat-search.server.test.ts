import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEpisodeChatSearch } from './episode-chat-search.server'
import { chatDecision, chatLibrary, chatResults } from '#/test/episode-chat-fixtures'

const mocks = vi.hoisted(() => ({ library: vi.fn(), episodes: vi.fn() }))
vi.mock('#/lib/podcast-library-query.server', () => ({ readPodcastLibrary: mocks.library }))
vi.mock('#/lib/episode-query', () => ({ readLatestEpisodes: mocks.episodes }))

beforeEach(() => {
  mocks.library.mockResolvedValue(chatLibrary)
  mocks.episodes.mockResolvedValue({
    ...chatResults(25),
    ranking: { status: 'baseline', model: 'test' },
  })
})

describe('read-only episode search tool', () => {
  it('uses the session listener, preserves ranking, and enforces ten distinct cards', async () => {
    const { resolve } = createEpisodeChatSearch('listener-a', new AbortController().signal, 'en')
    const result = await resolve(chatDecision)
    expect(mocks.episodes).toHaveBeenCalledWith(
      'listener-a',
      {
        ...chatDecision.filters,
        offset: 0,
      },
      expect.any(AbortSignal),
    )
    expect(result.kind).toBe('results')
    if (result.kind !== 'results') throw new Error('Expected results')
    expect(result.episodes.map(({ id }) => id)).toEqual(
      chatResults(10).episodes.map(({ id }) => id),
    )
    expect(result.total).toBe(25)
  })

  it('does not search a supported subset when any unsupported constraint is identified', async () => {
    const { resolve } = createEpisodeChatSearch('listener-a', new AbortController().signal, 'en')
    expect(
      await resolve({
        ...chatDecision,
        unsupportedConstraints: ['under 30 minutes'],
        clarification: 'Please remove the duration constraint.',
      }),
    ).toEqual({ kind: 'clarification', message: 'Please remove the duration constraint.' })
    expect(mocks.library).not.toHaveBeenCalled()
    expect(mocks.episodes).not.toHaveBeenCalled()
  })

  it('fails closed when the model asks a correction question but mistakenly labels its action as search', async () => {
    const { resolve } = createEpisodeChatSearch('listener-a', new AbortController().signal, 'en')
    expect(
      await resolve({ ...chatDecision, clarification: 'Did you mean the last 30 days?' }),
    ).toEqual({ kind: 'clarification', message: 'Did you mean the last 30 days?' })
    expect(mocks.episodes).not.toHaveBeenCalled()
  })

  it.each([
    { ...chatDecision.filters, podcastId: 999 },
    { ...chatDecision.filters, categoryId: 'someone-elses-category' },
  ])('rejects a foreign or unfollowed filter instead of broadening', async (filters) => {
    const { resolve } = createEpisodeChatSearch('listener-a', new AbortController().signal, 'en')
    expect((await resolve({ ...chatDecision, filters })).kind).toBe('clarification')
    expect(mocks.episodes).not.toHaveBeenCalled()
  })

  it('bounds parallel tool calls to one search', async () => {
    const { resolve } = createEpisodeChatSearch('listener-a', new AbortController().signal, 'en')
    const results = await Promise.all([
      resolve(chatDecision),
      resolve(chatDecision),
      resolve(chatDecision),
    ])
    expect(mocks.episodes).toHaveBeenCalledTimes(1)
    expect(results.map(({ kind }) => kind)).toEqual(['results', 'ignored', 'ignored'])
  })

  it('honors cancellation before querying', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      createEpisodeChatSearch('listener-a', controller.signal, 'fr').resolve(chatDecision),
    ).rejects.toThrow()
    expect(mocks.episodes).not.toHaveBeenCalled()
  })
})
