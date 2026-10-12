import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PodcastSearch } from '#/components/PodcastSearch'
import type { Podcast } from '#/lib/apple-podcasts'
import { overwriteGetLocale } from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useHydrated: () => true }))
vi.mock('#/lib/podcast-search', () => ({ searchPodcasts: mocks.search }))

const podcast: Podcast = {
  id: 123,
  title: 'Syntax',
  publisher: 'Wes Bos & Scott Tolinski',
  appleUrl: 'https://podcasts.apple.com/us/podcast/syntax/id123',
  feedUrl: 'https://feeds.example.com/syntax',
  artworkUrl: 'https://images.example.com/syntax.jpg',
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  render(
    <QueryClientProvider client={client}>
      <PodcastSearch />
    </QueryClientProvider>,
  )
}

beforeEach(() => mocks.search.mockReset())

describe('podcast search', () => {
  it('waits for submission, trims the search, and displays podcast results', async () => {
    mocks.search.mockResolvedValue([podcast])
    const user = userEvent.setup()
    renderSearch()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    expect(screen.getByText('Your next great listen starts here')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), '  syntax  ')
    expect(mocks.search).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    expect(mocks.search).toHaveBeenCalledWith({
      data: { term: 'syntax' },
      signal: expect.any(AbortSignal),
    })
    expect(screen.getByText('Wes Bos & Scott Tolinski')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 podcast found for “syntax”')
    expect(screen.getByRole('link', { name: 'View on Apple Podcasts' })).toHaveAttribute(
      'href',
      podcast.appleUrl,
    )
  })

  it('does not send whitespace-only searches to Apple', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), '   {Enter}')

    expect(mocks.search).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    expect(screen.getByText('Your next great listen starts here')).toBeInTheDocument()
  })

  it('keeps a podcast usable when artwork and publisher information are missing', async () => {
    mocks.search.mockResolvedValue([{ ...podcast, artworkUrl: null, publisher: '' }])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')

    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View on Apple Podcasts' })).toHaveAttribute(
      'href',
      podcast.appleUrl,
    )
    expect(screen.getByRole('listitem').querySelector('img')).toBeNull()
    expect(screen.queryByText(podcast.publisher)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('supplies lazy, responsive artwork to result cards without changing the fallback URL', async () => {
    const artworkUrl = 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts/show.jpeg/600x600bb.jpg'
    mocks.search.mockResolvedValue([{ ...podcast, artworkUrl }])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    await screen.findByRole('heading', { name: 'Syntax' })

    const artwork = screen.getByRole('listitem').querySelector('img')!
    expect(artwork).toHaveAttribute('src', artworkUrl)
    expect(artwork).toHaveAttribute('loading', 'lazy')
    expect(artwork).toHaveAttribute('decoding', 'async')
    expect(artwork.getAttribute('srcset')).toContain('/112x112bb.jpg 112w')
    expect(artwork.getAttribute('srcset')).toContain('/224x224bb.jpg 224w')
    expect(artwork).toHaveAttribute('sizes', '(max-width: 480px) 80px, 112px')
  })

  it('shows a loading state and ignores results from a search cleared while pending', async () => {
    let resolveSearch!: (results: Podcast[]) => void
    mocks.search.mockReturnValue(
      new Promise<Podcast[]>((resolve) => {
        resolveSearch = resolve
      }),
    )
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    expect(await screen.findByText('Searching Apple Podcasts…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('searchbox')).toHaveFocus()
    await act(async () => resolveSearch([podcast]))
    expect(screen.queryByRole('heading', { name: 'Syntax' })).not.toBeInTheDocument()
    expect(screen.getByText('Your next great listen starts here')).toBeInTheDocument()
  })

  it('shows no matches and replaces them with results from a new search', async () => {
    mocks.search.mockResolvedValueOnce([]).mockResolvedValueOnce([podcast])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'unknown{Enter}')
    expect(await screen.findByText('No podcasts found for “unknown”')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    expect(screen.queryByText('No podcasts found for “unknown”')).not.toBeInTheDocument()
  })

  it('offers an explicit retry after an upstream failure', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([podcast])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to search Apple Podcasts right now.',
    )
    expect(mocks.search).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    expect(mocks.search).toHaveBeenCalledTimes(2)
  })

  it('retries a failed search when the same query is submitted with Enter', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([podcast])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    await screen.findByRole('alert')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    expect(mocks.search).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reuses cached results and falls back gracefully when artwork fails', async () => {
    mocks.search.mockResolvedValue([podcast])
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    await screen.findByRole('heading', { name: 'Syntax' })
    const artwork = screen.getByRole('listitem').querySelector('img')!
    fireEvent.error(artwork)
    expect(screen.getByRole('listitem').querySelector('img')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await user.type(screen.getByRole('searchbox'), 'syntax{Enter}')
    expect(await screen.findByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce())
  })

  it('localizes the search and no-results state in French', async () => {
    overwriteGetLocale(() => 'fr')
    mocks.search.mockResolvedValue([])
    const user = userEvent.setup()
    renderSearch()
    expect(screen.getByRole('heading', { name: 'Rechercher des podcasts' })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'histoire{Enter}')
    expect(await screen.findByText('Aucun podcast trouvé pour « histoire »')).toBeInTheDocument()
  })
})
