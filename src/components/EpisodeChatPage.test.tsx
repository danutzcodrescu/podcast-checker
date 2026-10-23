import { EventType, toServerSentEventsResponse } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EpisodeChatPage } from './EpisodeChatPage'
import { parseEpisodeChatRequest } from '#/lib/episode-chat-request'
import { chatLibrary, chatResultChunks, chatResults } from '#/test/episode-chat-fixtures'
import * as localeRuntime from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({ library: vi.fn(), connection: vi.fn(), queue: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
    to: string
    search?: Record<string, string | number>
  }) => (
    <a
      href={
        to +
        (search
          ? `?${new URLSearchParams(Object.entries(search).map(([key, value]) => [key, String(value)]))}`
          : '')
      }
      {...props}
    >
      {children}
    </a>
  ),
  useHydrated: () => true,
  useNavigate: () => vi.fn(),
}))
vi.mock('#/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('#/lib/podcast-library', () => ({
  getPodcastLibrary: mocks.library,
  saveFollowedPodcast: vi.fn(),
  unfollowPodcast: vi.fn(),
  createPodcastCategory: vi.fn(),
  retryPodcastIngestion: vi.fn(),
}))
vi.mock('#/lib/pocket-casts', () => ({
  getPocketCastsConnection: mocks.connection,
  addEpisodeToPocketCasts: mocks.queue,
  connectPocketCasts: vi.fn(),
  disconnectPocketCasts: vi.fn(),
}))

async function* timeoutChunks(): AsyncGenerator<StreamChunk> {
  yield { type: EventType.RUN_STARTED, runId: 'timeout', threadId: 'thread' }
  yield { type: EventType.RUN_ERROR, code: 'CHAT_TIMEOUT', message: 'SECRET upstream timeout' }
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EpisodeChatPage email="jane.doe@example.com" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.library.mockResolvedValue(chatLibrary)
  mocks.connection.mockResolvedValue({ ok: true, data: { email: 'pocket@example.com' } })
  mocks.queue.mockResolvedValue({ ok: true, data: null })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(toServerSentEventsResponse(chatResultChunks(chatResults()))),
      ),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('episode chat page', () => {
  it('starts empty without suggestions or a footer disclaimer, and sends only when submitted', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Roman history 1' })).not.toBeInTheDocument()
    expect(screen.queryByText('Try:')).not.toBeInTheDocument()
    expect(screen.queryByText('Roman history, from any time')).not.toBeInTheDocument()
    expect(screen.queryByText(/Only your followed podcasts ·/)).not.toBeInTheDocument()
    await user.type(input, 'Roman history, from any time')
    expect(input).toHaveValue('Roman history, from any time')
    expect(fetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('heading', { name: 'Roman history 1' })).toBeVisible()
    expect(input).toHaveValue('')
    expect(screen.getByRole('log')).toHaveTextContent('Here are 6 of 25 matching episodes')
  })

  it.each([7, 30, 90, null] as const)(
    'renders authoritative cards and preserves timeframe %s in See more',
    async (days) => {
      const result = chatResults(10)
      result.filters = {
        ...result.filters,
        days,
        podcastId: 123,
        categoryId: 'history',
        searchMode: 'text',
      }
      vi.mocked(fetch).mockImplementation(() =>
        Promise.resolve(toServerSentEventsResponse(chatResultChunks(result))),
      )
      const user = userEvent.setup()
      renderPage()
      const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'Roman history{enter}')
      const results = await screen.findByRole('list', { name: 'Search results' })
      expect(within(results).getAllByRole('listitem')).toHaveLength(10)
      const link = screen.getByRole('link', { name: /Show more episodes/ })
      const target = new URL(link.getAttribute('href')!, 'https://podcasts.example')
      expect(target.pathname).toBe('/latest-episodes')
      expect(Object.fromEntries(target.searchParams)).toEqual({
        q: 'Roman history',
        sort: 'relevance',
        mode: 'text',
        podcast: '123',
        category: 'history',
        days: String(days ?? 'all'),
      })
      await user.click(
        within(results).getAllByRole('button', { name: /Play next in Pocket Casts:/ })[0],
      )
      expect(mocks.queue).toHaveBeenCalledWith({ data: { episodeId: 'episode-0' } })
    },
  )

  it('displays a clarification without fabricated results', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        toServerSentEventsResponse(
          chatResultChunks({
            kind: 'clarification',
            message: 'Choose 7, 30 or 90 days, or all time.',
          }),
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'History in the last 14 days{enter}')
    expect(await screen.findByText('Choose 7, 30 or 90 days, or all time.')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Show more episodes/ })).not.toBeInTheDocument()
  })

  it('keeps follow-up context on the wire and clears it with New conversation', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Roman history{enter}')
    await screen.findByRole('link', { name: /Show more episodes/ })
    await user.type(input, 'Same topic, last 30 days{enter}')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const secondRequest = vi.mocked(fetch).mock.calls[1][1]
    expect(String(secondRequest?.body)).toContain('Roman history')
    expect(String(secondRequest?.body)).toContain('Same topic, last 30 days')
    const normalized = parseEpisodeChatRequest(JSON.parse(String(secondRequest?.body)))
    expect(
      normalized.messages.some(
        (message) =>
          typeof message.content === 'string' && message.content.includes('previousSearchCriteria'),
      ),
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.getByRole('log')).not.toHaveTextContent('Roman history')
    expect(screen.getByText('What would you like to listen to?')).toBeVisible()
  })

  it('does not contact a model for an empty library', async () => {
    mocks.library.mockResolvedValue({ podcasts: [], categories: [] })
    renderPage()
    await screen.findByText('Follow a podcast from search results to add it to your library.')
    expect(screen.getByRole('textbox', { name: 'Ask about your episodes' })).toBeDisabled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows safe retry/browse feedback for provider failures, never raw upstream errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('SECRET provider details', { status: 503 }))
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'History{enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Chat search is unavailable right now',
    )
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it.each(['stream', 'http'])(
    'offers retry and browsing after a %s timeout, and retry can recover',
    async (transport) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        transport === 'stream'
          ? toServerSentEventsResponse(timeoutChunks())
          : new Response(null, { status: 504 }),
      )
      const user = userEvent.setup()
      renderPage()
      const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
      await waitFor(() => expect(input).toBeEnabled())
      await user.type(input, 'History{enter}')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Chat search took too long. Try again or browse your episodes.',
      )
      expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
      expect(within(alert).getByRole('link', { name: 'Latest episodes' })).toHaveAttribute(
        'href',
        '/latest-episodes',
      )
      await user.click(within(alert).getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('heading', { name: 'Roman history 1' })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )

  it('localizes chat controls in French', async () => {
    localeRuntime.overwriteGetLocale(() => 'fr')
    renderPage()
    expect(screen.getByRole('heading', { name: 'Que souhaitez-vous écouter ?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Envoyer le message' })).toBeInTheDocument()
  })

  it('explains an empty model response instead of leaving an unanswered user bubble', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        [
          { type: EventType.RUN_STARTED, runId: 'empty', threadId: 'thread' },
          { type: EventType.RUN_FINISHED, runId: 'empty', threadId: 'thread' },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'History{enter}')
    expect(await screen.findByText(/I couldn’t safely interpret/)).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('cancels an in-flight request without inventing results', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ask about your episodes' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'History{enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop searching' }))
    expect(
      await screen.findByText('Search stopped. Send another message to continue.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })
})
