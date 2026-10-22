import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PodcastLibrary } from '#/components/PodcastLibrary'
import type { PodcastLibraryFilter } from '#/components/PodcastLibrary'
import type { Podcast } from '#/lib/apple-podcasts'
import type { PodcastLibrary as Library } from '#/lib/podcast-library'
import { overwriteGetLocale } from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  search: vi.fn(),
  save: vi.fn(),
  unfollow: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useHydrated: () => true }))
vi.mock('#/lib/podcast-search', () => ({ searchPodcasts: mocks.search }))
vi.mock('#/lib/podcast-library', () => ({
  getPodcastLibrary: mocks.load,
  saveFollowedPodcast: mocks.save,
  unfollowPodcast: mocks.unfollow,
  createPodcastCategory: mocks.create,
  retryPodcastIngestion: mocks.retry,
}))

const podcast: Podcast = {
  id: 123,
  title: 'Syntax',
  publisher: 'Wes & Scott',
  appleUrl: 'https://podcasts.apple.com/podcast/id123',
  feedUrl: null,
  artworkUrl: null,
}
const otherPodcast: Podcast = {
  ...podcast,
  id: 456,
  title: 'History show',
  publisher: 'History host',
}
const empty: Library = { podcasts: [], categories: [] }
const categorized: Library = {
  podcasts: [{ podcast, categories: ['development'] }],
  categories: [{ id: 'development', name: 'Development' }],
}

function LibraryTestPage() {
  const [filter, setFilter] = useState<PodcastLibraryFilter>(null)
  return <PodcastLibrary email="listener@example.com" filter={filter} onFilterChange={setFilter} />
}

function renderLibrary() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return {
    ...render(
      <QueryClientProvider client={client}>
        <LibraryTestPage />
      </QueryClientProvider>,
    ),
    client,
  }
}

async function search(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('searchbox', { name: 'Search podcasts' }), 'syntax{Enter}')
  return screen.findByRole('list', { name: 'Podcast search results' })
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.load.mockResolvedValue(empty)
  mocks.search.mockResolvedValue([podcast])
})

describe('podcast library', () => {
  it('exposes an accessible library disclosure and preserves the selected filter when collapsed', async () => {
    mocks.load.mockResolvedValue(categorized)
    const user = userEvent.setup()
    renderLibrary()
    const toggle = screen.getByRole('button', { name: 'Your library' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(content).toHaveClass('tablet:hidden')

    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(content).not.toHaveClass('tablet:hidden')
    await user.click(await screen.findByRole('button', { name: 'Development 1' }))
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(toggle).getByText('Development')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Development' })).toBeInTheDocument()
  })

  it('shows ingestion progress and retries failed imports', async () => {
    const withFeed = { ...podcast, feedUrl: 'https://example.com/rss' }
    const failed: Library = {
      ...empty,
      podcasts: [
        {
          podcast: withFeed,
          categories: [],
          sync: {
            status: 'ready',
            episodes: 20,
            embedded: 12,
            failed: 8,
            lastSyncedAt: null,
          },
        },
      ],
    }
    mocks.load.mockResolvedValue(failed)
    mocks.retry.mockResolvedValue({
      ...failed,
      podcasts: [
        {
          ...failed.podcasts[0],
          sync: {
            ...failed.podcasts[0].sync,
            status: 'queued',
            failed: 0,
          },
        },
      ],
    })
    const user = userEvent.setup()
    renderLibrary()
    await user.click(await screen.findByRole('button', { name: 'Followed podcasts 1' }))
    expect(screen.getByText(/20 imported · 12 embedded/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry episode import' }))
    expect(mocks.retry).toHaveBeenCalledWith({ data: podcast.id })
    expect(await screen.findByText(/Episode import queued/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry episode import' })).not.toBeInTheDocument()
  })

  it('follows a search result without tags and restores saved following state on remount', async () => {
    const saved: Library = { ...empty, podcasts: [{ podcast, categories: [] }] }
    mocks.save.mockResolvedValue(saved)
    const user = userEvent.setup()
    const page = renderLibrary()
    const results = await search(user)
    await user.click(within(results).getByRole('button', { name: 'Follow Syntax' }))

    expect(mocks.save).toHaveBeenCalledWith({ data: { podcast, categories: [] } })
    expect(
      await within(results).findByRole('button', { name: 'Unfollow Syntax' }),
    ).toHaveTextContent('Following')
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByRole('button', { name: 'Followed podcasts 1' })).toBeInTheDocument()
    page.unmount()
    mocks.load.mockResolvedValue(saved)
    renderLibrary()
    const reloadedResults = await search(user)
    expect(
      await within(reloadedResults).findByRole('button', { name: 'Unfollow Syntax' }),
    ).toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledOnce()
  })

  it('creates and selects tags while following, then filters the library by category and text', async () => {
    mocks.save.mockResolvedValue(categorized)
    const user = userEvent.setup()
    renderLibrary()
    const results = await search(user)
    await user.click(within(results).getByRole('button', { name: 'Add tags to Syntax' }))
    const editor = screen.getByRole('dialog', { name: 'Add to categories' })
    await user.type(within(editor).getByRole('searchbox'), 'Development{Enter}')
    expect(within(editor).getByRole('checkbox', { name: 'Development' })).toBeChecked()
    expect(within(editor).getByRole('searchbox')).toHaveValue('')
    expect(within(editor).getByRole('searchbox')).toHaveFocus()
    expect(mocks.save).not.toHaveBeenCalled()
    await user.click(within(editor).getByRole('button', { name: 'Follow & save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.save).toHaveBeenCalledWith({ data: { podcast, categories: ['Development'] } })
    const sidebar = screen.getByRole('complementary')
    await user.click(within(sidebar).getByRole('button', { name: 'Development 1' }))
    expect(screen.getByRole('heading', { name: 'Development' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Followed podcast results' })).getByRole('heading', {
        name: 'Syntax',
      }),
    ).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Filter your podcasts' }), 'unknown')
    expect(screen.queryByRole('list', { name: 'Followed podcast results' })).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Filter your podcasts' }))
    await user.type(screen.getByRole('searchbox', { name: 'Filter your podcasts' }), 'scott')
    expect(screen.getByRole('heading', { name: 'Syntax' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to Discover' }))
    expect(screen.getByRole('heading', { name: 'Search podcasts' })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search podcasts' })).toHaveValue('syntax')
  })

  it.each(['web', 'Web'])(
    'keeps a locally created tag unique and selected when a refresh includes "%s"',
    async (savedName) => {
      mocks.save.mockResolvedValue(empty)
      const user = userEvent.setup()
      const { client } = renderLibrary()
      const results = await search(user)
      await user.click(within(results).getByRole('button', { name: 'Add tags to Syntax' }))
      const editor = screen.getByRole('dialog', { name: 'Add to categories' })
      await user.type(within(editor).getByRole('searchbox'), 'web{Enter}')

      act(() => {
        client.setQueryData(['podcast-library', 'listener@example.com'], {
          ...empty,
          categories: [{ id: 'web', name: savedName }],
        })
      })

      await waitFor(() => {
        expect(within(editor).getAllByRole('checkbox')).toHaveLength(1)
        expect(within(editor).getByRole('checkbox', { name: 'web' })).toBeChecked()
      })
      await user.click(within(editor).getByRole('checkbox', { name: 'web' }))
      expect(within(editor).getByRole('checkbox', { name: 'web' })).not.toBeChecked()
      await user.type(within(editor).getByRole('searchbox'), 'WEB{Enter}')
      expect(within(editor).getByRole('checkbox', { name: 'web' })).toBeChecked()
      await user.click(within(editor).getByRole('button', { name: 'Follow & save' }))
      expect(mocks.save).toHaveBeenCalledWith({ data: { podcast, categories: ['web'] } })
    },
  )

  it('filters by category names and publishers while keeping full-library category counts', async () => {
    const webPodcast: Podcast = { ...podcast, id: 789, title: 'Web platform' }
    mocks.load.mockResolvedValue({
      podcasts: [
        { podcast, categories: ['development', 'javascript'] },
        { podcast: webPodcast, categories: ['development'] },
        { podcast: otherPodcast, categories: ['history'] },
      ],
      categories: [
        ...categorized.categories,
        { id: 'javascript', name: 'JavaScript' },
        { id: 'history', name: 'History' },
      ],
    })
    const user = userEvent.setup()
    renderLibrary()
    const sidebar = screen.getByRole('complementary')
    const development = await within(sidebar).findByRole('button', { name: 'Development 2' })
    const input = screen.getByRole('searchbox', { name: 'Filter your podcasts' })
    await user.type(input, '  JAVASCRIPT  ')
    expect(within(sidebar).getByText('Syntax')).toBeInTheDocument()
    expect(within(sidebar).queryByText('Web platform')).not.toBeInTheDocument()
    expect(development).toHaveTextContent('2')
    await user.click(development)
    const results = screen.getByRole('list', { name: 'Followed podcast results' })
    expect(within(results).getAllByRole('heading')).toHaveLength(1)
    await user.clear(input)
    expect(within(results).getAllByRole('heading')).toHaveLength(2)
    expect(within(results).queryByRole('heading', { name: 'History show' })).not.toBeInTheDocument()
    await user.click(within(sidebar).getByRole('button', { name: 'History 1' }))
    await user.type(input, 'HISTORY HOST')
    expect(
      within(screen.getByRole('list', { name: 'Followed podcast results' })).getByRole('heading', {
        name: 'History show',
      }),
    ).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Development 2' })).toBeInTheDocument()
  })

  it.each([
    { query: '  development  ', selected: 'Development' },
    { query: 'develo', selected: 'Development tools' },
  ])(
    'selects "$selected" on Enter for "$query" without duplicating or toggling it off',
    async ({ query, selected }) => {
      mocks.load.mockResolvedValue({
        ...empty,
        categories: [
          { id: 'development tools', name: 'Development tools' },
          ...categorized.categories,
        ],
      })
      mocks.save.mockResolvedValue(categorized)
      const user = userEvent.setup()
      renderLibrary()
      const results = await search(user)
      await user.click(within(results).getByRole('button', { name: 'Add tags to Syntax' }))
      const editor = screen.getByRole('dialog', { name: 'Add to categories' })
      const input = within(editor).getByRole('searchbox')
      await user.type(input, '{Enter}   {Enter}')
      expect(within(editor).queryAllByRole('checkbox', { checked: true })).toHaveLength(0)
      await user.clear(input)
      await user.type(input, `${query}{Enter}`)
      expect(within(editor).getByRole('checkbox', { name: selected })).toBeChecked()
      expect(within(editor).getAllByRole('checkbox')).toHaveLength(2)
      await user.type(input, `${selected}{Enter}`)
      expect(within(editor).getByRole('checkbox', { name: selected })).toBeChecked()
      expect(input).toHaveValue('')
      expect(mocks.save).not.toHaveBeenCalled()
      await user.click(within(editor).getByRole('button', { name: 'Follow & save' }))
      expect(mocks.save).toHaveBeenCalledWith({ data: { podcast, categories: [selected] } })
    },
  )

  it('edits categories and unfollows without removing the category or other podcasts', async () => {
    const loaded: Library = {
      ...categorized,
      podcasts: [...categorized.podcasts, { podcast: otherPodcast, categories: [] }],
    }
    mocks.load.mockResolvedValue(loaded)
    mocks.save.mockResolvedValue({
      ...loaded,
      podcasts: [{ podcast, categories: [] }, loaded.podcasts[1]],
    })
    mocks.unfollow.mockResolvedValue({ ...loaded, podcasts: [loaded.podcasts[1]] })
    const user = userEvent.setup()
    renderLibrary()
    const results = await search(user)
    await user.click(within(results).getByRole('button', { name: 'Edit tags for Syntax' }))
    screen.getByRole('checkbox', { name: 'Development' }).focus()
    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: 'Save categories' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.save).toHaveBeenCalledWith({ data: { podcast, categories: [] } })
    await user.click(within(results).getByRole('button', { name: 'Unfollow Syntax' }))
    expect(await within(results).findByRole('button', { name: 'Follow Syntax' })).toBeEnabled()
    expect(mocks.unfollow).toHaveBeenCalledWith({ data: podcast.id })
    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).queryByText('Syntax')).not.toBeInTheDocument()
    expect(within(sidebar).getByText('History show')).toBeInTheDocument()
    expect(within(sidebar).getByRole('button', { name: 'Development 0' })).toBeInTheDocument()
  })

  it('keeps draft categories after a failed save, prevents duplicate requests, and allows retry', async () => {
    let reject!: (reason: Error) => void
    mocks.load.mockResolvedValue({ ...empty, categories: categorized.categories })
    mocks.save
      .mockReturnValueOnce(
        new Promise((_, rejectPromise) => {
          reject = rejectPromise
        }),
      )
      .mockResolvedValueOnce(categorized)
    const user = userEvent.setup()
    renderLibrary()
    const results = await search(user)
    await user.click(within(results).getByRole('button', { name: 'Add tags to Syntax' }))
    await user.click(screen.getByRole('checkbox', { name: 'Development' }))
    await user.click(screen.getByRole('button', { name: 'Follow & save' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(within(results).getByRole('button', { name: 'Follow Syntax' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('heading', { name: 'Search podcasts' }))
    expect(screen.getByRole('dialog', { name: 'Add to categories' })).toBeInTheDocument()
    await act(async () => reject(new Error('Unavailable')))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update your library.')
    expect(screen.getByRole('checkbox', { name: 'Development' })).toBeChecked()
    expect(
      within(screen.getByRole('complementary')).getByRole('button', {
        name: 'Followed podcasts 0',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Follow & save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })

  it('cancels tag edits with Escape and returns focus without saving', async () => {
    const user = userEvent.setup()
    renderLibrary()
    const results = await search(user)
    const trigger = within(results).getByRole('button', { name: 'Add tags to Syntax' })
    await user.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Find or create a category' })).toHaveFocus(),
    )
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('dismisses on an outside click and restores saved selections when reopened', async () => {
    mocks.load.mockResolvedValue(categorized)
    const user = userEvent.setup()
    renderLibrary()
    const results = await search(user)
    const trigger = within(results).getByRole('button', { name: 'Edit tags for Syntax' })
    await user.click(trigger)
    await user.click(screen.getByRole('checkbox', { name: 'Development' }))
    expect(screen.getByRole('checkbox', { name: 'Development' })).not.toBeChecked()

    await user.click(screen.getByRole('searchbox', { name: 'Search podcasts' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(screen.getByRole('checkbox', { name: 'Development' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Close category editor' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('retries library loading and creates an empty category from the sidebar', async () => {
    mocks.load.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(empty)
    mocks.create.mockResolvedValue({ ...empty, categories: categorized.categories })
    const user = userEvent.setup()
    renderLibrary()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load your library.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    await user.type(screen.getByRole('textbox', { name: 'Category name' }), ' Development ')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.create).toHaveBeenCalledWith({ data: 'Development' })
    expect(await screen.findByRole('button', { name: 'Development 0' })).toBeInTheDocument()
  })

  it('localizes following and category controls in French', async () => {
    overwriteGetLocale(() => 'fr')
    const user = userEvent.setup()
    renderLibrary()
    await user.type(
      screen.getByRole('searchbox', { name: 'Rechercher des podcasts' }),
      'syntax{Enter}',
    )
    await user.click(await screen.findByRole('button', { name: 'Ajouter des tags à Syntax' }))
    expect(screen.getByRole('dialog', { name: 'Ajouter aux catégories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suivre et enregistrer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Catégories' })).toBeInTheDocument()
  })
})
