import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LatestEpisodesPage } from '#/components/LatestEpisodesPage'
import * as localeRuntime from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({
  library: vi.fn(),
  episodes: vi.fn(),
  connection: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  queue: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentPropsWithoutRef<'a'> & { to: string }) => (
    <a href={to} {...props}>
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
vi.mock('#/lib/latest-episodes', () => ({ getLatestEpisodes: mocks.episodes }))
vi.mock('#/lib/pocket-casts', () => ({
  getPocketCastsConnection: mocks.connection,
  connectPocketCasts: mocks.connect,
  disconnectPocketCasts: mocks.disconnect,
  addEpisodeToPocketCasts: mocks.queue,
}))

const podcast = {
  id: 123,
  title: 'Syntax',
  publisher: 'Wes & Scott',
  appleUrl: 'https://podcasts.apple.com/podcast/id123',
  feedUrl: null,
  artworkUrl: null,
}
const episode = {
  id: 'first',
  title: 'JavaScript patterns',
  description: 'Practical patterns for cleaner JavaScript.',
  publishedAt: new Date().toISOString(),
  durationSeconds: 3240,
  artworkUrl: null,
  podcast,
  categories: ['development'],
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LatestEpisodesPage email="listener@example.com" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.connection.mockResolvedValue({ ok: true, data: null })
  mocks.connect.mockResolvedValue({ ok: true, data: { email: 'pocket@example.com' } })
  mocks.disconnect.mockResolvedValue({ ok: true, data: null })
  mocks.queue.mockResolvedValue({ ok: true, data: null })
  mocks.library.mockResolvedValue({
    podcasts: [{ podcast, categories: ['development'] }],
    categories: [{ id: 'development', name: 'Development' }],
  })
  mocks.episodes.mockResolvedValue({ episodes: [episode], total: 1, nextOffset: null })
})

describe('latest episodes page', () => {
  it('connects Pocket Casts, queues the selected episode as next, and disconnects', async () => {
    const user = userEvent.setup()
    renderPage()
    const action = await screen.findByRole('button', {
      name: 'Play next in Pocket Casts: JavaScript patterns',
    })
    expect(action).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Connect Pocket Casts' }))
    await user.type(screen.getByLabelText('Pocket Casts email'), 'pocket@example.com')
    await user.type(screen.getByLabelText('Pocket Casts password'), 'private-password')
    await user.click(
      within(document.getElementById('pocket-casts-connect-form')!).getByRole('button', {
        name: 'Connect Pocket Casts',
      }),
    )
    await screen.findByText('Connected as pocket@example.com')
    expect(mocks.connect).toHaveBeenCalledWith({
      data: { email: 'pocket@example.com', password: 'private-password' },
    })
    expect(screen.queryByLabelText('Pocket Casts password')).not.toBeInTheDocument()
    await user.click(action)
    expect(mocks.queue).toHaveBeenCalledWith({ data: { episodeId: episode.id } })
    expect(await within(action.closest('li')!).findByRole('status')).toHaveTextContent(
      'Added as Play Next',
    )
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(action).toBeDisabled())
    expect(screen.queryByText('Added as Play Next', { exact: false })).not.toBeInTheDocument()
  })

  it('clears rejected passwords and explains expired queue sessions without reporting success', async () => {
    const user = userEvent.setup()
    mocks.connect.mockResolvedValueOnce({ ok: false, error: 'auth' })
    renderPage()
    await screen.findByRole('heading', { name: 'JavaScript patterns' })
    await user.click(screen.getByRole('button', { name: 'Connect Pocket Casts' }))
    await user.type(screen.getByLabelText('Pocket Casts email'), 'pocket@example.com')
    const password = screen.getByLabelText('Pocket Casts password')
    await user.type(password, 'wrong-password')
    const submit = within(document.getElementById('pocket-casts-connect-form')!).getByRole(
      'button',
      { name: 'Connect Pocket Casts' },
    )
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pocket Casts sign-in failed or expired',
    )
    expect(password).toHaveValue('')
    await user.type(password, 'correct-password')
    await user.click(submit)
    await screen.findByText('Connected as pocket@example.com')
    mocks.queue.mockResolvedValueOnce({ ok: false, error: 'auth' })
    const action = screen.getByRole('button', {
      name: 'Play next in Pocket Casts: JavaScript patterns',
    })
    await user.click(action)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect again')
    expect(action).toBeDisabled()
    expect(within(action.closest('li')!).queryByRole('status')).not.toBeInTheDocument()
  })

  it('allows a retry after an unmatched episode and localizes the action in French', async () => {
    localeRuntime.overwriteGetLocale(() => 'fr')
    mocks.connection.mockResolvedValue({ ok: true, data: { email: 'pocket@example.com' } })
    mocks.queue.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    const user = userEvent.setup()
    renderPage()
    const action = await screen.findByRole('button', {
      name: 'Lire ensuite dans Pocket Casts : JavaScript patterns',
    })
    await waitFor(() => expect(action).toBeEnabled())
    await user.click(action)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cet épisode n’a pas pu être identifié',
    )
    await user.click(action)
    expect(await within(action.closest('li')!).findByRole('status')).toHaveTextContent(
      'Ajouté en prochaine lecture',
    )
  })

  it('supports retries for the initial request and pagination without losing loaded episodes', async () => {
    mocks.episodes
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ episodes: [episode], total: 2, nextOffset: 25 })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({
        episodes: [{ ...episode, id: 'second', title: 'Another episode' }],
        total: 2,
        nextOffset: null,
      })
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('Loading episodes…')).toBeInTheDocument()
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load episodes.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'JavaScript patterns' })
    await user.click(screen.getByRole('button', { name: 'Load more episodes' }))
    alert = await screen.findByRole('alert')
    expect(screen.getByRole('heading', { name: 'JavaScript patterns' })).toBeInTheDocument()
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Another episode' })
    expect(screen.getByRole('heading', { name: 'JavaScript patterns' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more episodes' })).not.toBeInTheDocument()
    expect(mocks.episodes).toHaveBeenLastCalledWith({
      data: {
        podcastId: null,
        categoryId: null,
        days: 7,
        sort: 'newest',
        term: '',
        searchMode: 'hybrid',
        offset: 25,
      },
    })
  })

  it('searches on submission, preserves relevance across dates, and clears back to browsing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'JavaScript patterns' })
    const input = screen.getByRole('searchbox', { name: 'Search episodes' })
    await user.type(input, 'async code')
    expect(mocks.episodes).toHaveBeenCalledOnce()
    mocks.episodes.mockResolvedValue({
      episodes: [
        {
          ...episode,
          id: 'older',
          title: 'Promises explained',
          publishedAt: '2020-01-01T12:00:00Z',
          matchType: 'semantic',
        },
        { ...episode, id: 'newer', title: 'Async code examples', matchType: 'text' },
      ],
      total: 2,
      nextOffset: null,
      semanticUnavailable: false,
    })
    await user.keyboard('{Enter}')
    const results = await screen.findByRole('region', { name: 'Search results' })
    expect(
      within(results)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Promises explained', 'Async code examples'])
    expect(within(results).getByText('Semantic match')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort episodes' })).toHaveValue('relevance')
    expect(mocks.episodes).toHaveBeenLastCalledWith({
      data: {
        podcastId: null,
        categoryId: null,
        days: 7,
        sort: 'relevance',
        term: 'async code',
        searchMode: 'hybrid',
        offset: 0,
      },
    })
    const calls = mocks.episodes.mock.calls.length
    await user.selectOptions(screen.getByRole('combobox', { name: 'Episode search mode' }), 'text')
    expect(mocks.episodes).toHaveBeenCalledTimes(calls)
    mocks.episodes.mockResolvedValue({ episodes: [episode], total: 1, nextOffset: null })
    await user.click(screen.getByRole('button', { name: 'Clear episode search' }))
    await screen.findByRole('heading', { name: 'JavaScript patterns' })
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('combobox', { name: 'Sort episodes' })).toHaveValue('newest')
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('explains hybrid fallback and supports retrying a failed semantic search', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'JavaScript patterns' })
    mocks.episodes.mockResolvedValue({
      episodes: [episode],
      total: 1,
      nextOffset: null,
      semanticUnavailable: true,
    })
    await user.type(screen.getByRole('searchbox', { name: 'Search episodes' }), 'patterns{Enter}')
    expect(
      await screen.findByText(
        'Semantic search is temporarily unavailable. Showing title and description matches.',
      ),
    ).toBeInTheDocument()
    mocks.episodes.mockRejectedValueOnce(new Error('Provider unavailable'))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Episode search mode' }),
      'semantic',
    )
    await user.click(screen.getByRole('button', { name: /^Search$/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to run semantic search.')
    mocks.episodes.mockResolvedValue({
      episodes: [{ ...episode, matchType: 'semantic' }],
      total: 1,
      nextOffset: null,
      semanticUnavailable: false,
    })
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByText('Semantic match')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('provides a Discover link when the account follows no podcasts', async () => {
    mocks.library.mockResolvedValue({ podcasts: [], categories: [] })
    mocks.episodes.mockResolvedValue({ episodes: [], total: 0, nextOffset: null })
    renderPage()
    await screen.findByRole('heading', { name: 'No episodes yet' })
    const section = screen.getByRole('region', { name: 'Latest episodes' })
    expect(within(section).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'href',
      '/discover',
    )
    expect(
      within(section).getByText('Follow a podcast from search results to add it to your library.'),
    ).toBeInTheDocument()
  })

  it('localizes episode metadata, controls, and navigation in French', async () => {
    localeRuntime.overwriteGetLocale(() => 'fr')
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'JavaScript patterns' })
    const card = heading.closest('li')!
    expect(within(card).getByText(/54 min/)).toBeInTheDocument()
    expect(within(card).getByText('Development')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Aujourd’hui' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Derniers épisodes' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('combobox', { name: 'Filtrer les épisodes par date' })).toHaveValue('7')
    expect(screen.getByRole('button', { name: 'Actualiser les épisodes' })).toBeEnabled()
  })
})
