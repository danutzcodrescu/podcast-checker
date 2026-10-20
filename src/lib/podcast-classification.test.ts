// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyPodcast } from './podcast-classification'

const fetchMock = vi.fn()
const podcast = { title: 'Syntax', description: 'JavaScript and CSS for developers' }
const decision = (choice: string) => ({
  model: 'typesafe/jev-1.14',
  provider: 'TypeSafe',
  answers: {
    category: {
      type: 'choice',
      choice,
      confidence: 0.99,
      probabilities: { sport: 0, story: 0, history: 0, web: 0.99, none: 0.01 },
    },
  },
  usage: { input_tokens: 600, output_tokens: 20, cost: 0.0000252 },
})

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  vi.stubEnv('PODCAST_CLASSIFICATION_MODEL', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(Response.json(decision('web')))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('podcast classification', () => {
  it('makes one direct Jev Decisions request with metadata and five Choice options', async () => {
    expect(
      await classifyPodcast({
        ...podcast,
        publisher: 'Syntax',
        language: 'en',
        categories: ['Technology', 'Education'],
      }),
    ).toBe('web')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://openrouter.ai/api/alpha/decisions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      }),
    )
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.model).toBe('~typesafe/jev-latest')
    expect(request.state).toEqual({
      ...podcast,
      publisher: 'Syntax',
      language: 'en',
      categories: ['Technology', 'Education'],
    })
    expect(Object.keys(request.questions)).toEqual(['category'])
    expect(request.questions.category.type).toBe('choice')
    expect(Object.keys(request.questions.category.criteria)).toEqual([
      'sport',
      'story',
      'history',
      'web',
      'none',
    ])
    expect(request.questions.category.criteria.story.examples).toContain('Sherlock & Co.')
    expect(request.questions.category.criteria.history.examples).toContain('Conflicted')
    expect(request.questions.category.instructions).toContain('Choose `none`')
    expect(request).not.toHaveProperty('messages')
    expect(request).not.toHaveProperty('response_format')
  })

  it.each(['sport', 'story', 'history', 'web'])('accepts the %s category', async (category) => {
    fetchMock.mockResolvedValue(Response.json(decision(category)))
    expect(await classifyPodcast(podcast)).toBe(category)
  })

  it('maps the explicit none option to no category', async () => {
    fetchMock.mockResolvedValue(Response.json(decision('none')))
    expect(await classifyPodcast({ title: 'Unknown', description: '' })).toBeNull()
  })

  it.each([
    decision('politics'),
    { answers: { category: { type: 'score', choice: 'web' } } },
    { choices: [{ message: { content: '{"category":"web"}' } }] },
    { answers: {} },
    { answers: { category: { type: 'choice', choice: 'web', confidence: 2 } } },
  ])('rejects malformed or non-Decision answers', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    await expect(classifyPodcast(podcast)).rejects.toThrow('invalid podcast decision')
  })

  it('rejects invalid JSON without exposing the response body', async () => {
    fetchMock.mockResolvedValue(new Response('private upstream data'))
    await expect(classifyPodcast(podcast)).rejects.toThrow('invalid podcast decision')
  })

  it.each([401, 429, 502])(
    'reports HTTP %s without exposing provider errors or retrying',
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ error: 'private upstream data' }, { status }))
      await expect(classifyPodcast(podcast)).rejects.toThrow(
        `OpenRouter decision request failed (HTTP ${status})`,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('supports pinning a Decisions model', async () => {
    vi.stubEnv('PODCAST_CLASSIFICATION_MODEL', 'typesafe/jev-1.14')
    await classifyPodcast(podcast)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('typesafe/jev-1.14')
  })

  it('defaults optional metadata and bounds every metadata field', async () => {
    await classifyPodcast(podcast)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).state).toMatchObject({
      publisher: null,
      language: null,
      categories: [],
    })
    fetchMock.mockResolvedValue(Response.json(decision('web')))
    await classifyPodcast({
      title: 'x'.repeat(1000),
      description: 'x'.repeat(20_000),
      publisher: 'x'.repeat(1000),
      language: 'x'.repeat(200),
      categories: Array.from({ length: 30 }, () => 'x'.repeat(300)),
    })
    const { state } = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(state.title).toHaveLength(500)
    expect(state.description).toHaveLength(12_000)
    expect(state.publisher).toHaveLength(500)
    expect(state.language).toHaveLength(100)
    expect(state.categories).toHaveLength(20)
    expect(state.categories.every((category: string) => category.length === 200)).toBe(true)
  })

  it('skips provider calls without credentials or when already aborted', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(await classifyPodcast({ title: 'Syntax', description: 'Web' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    await expect(
      classifyPodcast({ title: 'Syntax', description: 'Web' }, AbortSignal.abort()),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates caller cancellation to the Decisions request', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url, request) => {
      controller.abort()
      request.signal.throwIfAborted()
    })
    await expect(classifyPodcast(podcast, controller.signal)).rejects.toThrow()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('applies its own 15-second timeout even without a caller signal', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    fetchMock.mockImplementation(async (_url, request) => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'))
      request.signal.throwIfAborted()
    })
    await expect(classifyPodcast(podcast)).rejects.toThrow('Timed out')
    expect(timeout).toHaveBeenCalledWith(15_000)
  })
})
