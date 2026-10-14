import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LatestEpisodesPage } from '#/components/LatestEpisodesPage'
import * as localeRuntime from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({ library: vi.fn(), episodes: vi.fn() }))

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
  mocks.library.mockResolvedValue({
    podcasts: [{ podcast, categories: ['development'] }],
    categories: [{ id: 'development', name: 'Development' }],
  })
  mocks.episodes.mockResolvedValue({ episodes: [episode], total: 1, nextOffset: null })
})

describe('latest episodes page', () => {
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
        offset: 25,
      },
    })
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
