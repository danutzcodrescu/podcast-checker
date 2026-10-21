import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EpisodeSearchForm } from '#/components/EpisodeSearchForm'

function renderForm(overrides: Partial<ComponentProps<typeof EpisodeSearchForm>> = {}) {
  const onSearch = vi.fn()
  const onClear = vi.fn()
  const props: ComponentProps<typeof EpisodeSearchForm> = {
    searchTerm: '',
    searchMode: 'hybrid',
    active: false,
    pending: false,
    disabled: false,
    onSearch,
    onClear,
    ...overrides,
  }
  const view = render(<EpisodeSearchForm {...props} />)
  return {
    onSearch,
    onClear,
    rerender: (next: Partial<ComponentProps<typeof EpisodeSearchForm>>) =>
      view.rerender(<EpisodeSearchForm {...props} {...next} />),
  }
}

describe('episode search form', () => {
  it('keeps typing local until the search is submitted', async () => {
    const user = userEvent.setup()
    const { onSearch } = renderForm()
    const input = screen.getByRole('searchbox', { name: 'Search episodes' })

    await user.type(input, '  async code ')
    expect(onSearch).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith('async code', 'hybrid')
  })

  it('submits the selected search mode', async () => {
    const user = userEvent.setup()
    const { onSearch } = renderForm()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Episode search mode' }),
      'semantic',
    )
    expect(onSearch).not.toHaveBeenCalled()

    await user.type(screen.getByRole('searchbox', { name: 'Search episodes' }), 'patterns')
    await user.click(screen.getByRole('button', { name: /^Search$/ }))
    expect(onSearch).toHaveBeenCalledWith('patterns', 'semantic')
  })

  it('discards the draft when the submitted search changes', async () => {
    const user = userEvent.setup()
    const { rerender } = renderForm({ searchTerm: 'async' })
    const input = screen.getByRole('searchbox', { name: 'Search episodes' })

    await user.type(input, ' code')
    expect(input).toHaveValue('async code')

    // The URL changed underneath the form (a back/forward navigation or a shared link).
    rerender({ searchTerm: 'promises', active: true })
    expect(input).toHaveValue('promises')
  })

  it('does not resurrect a submitted draft when the URL returns to the earlier search', async () => {
    const user = userEvent.setup()
    const { rerender } = renderForm()
    const input = screen.getByRole('searchbox', { name: 'Search episodes' })

    await user.type(input, 'development episode')
    await user.keyboard('{Enter}')
    rerender({ searchTerm: 'development episode', active: true })
    expect(input).toHaveValue('development episode')

    // Back: the URL is exactly what it was before typing, but the draft must stay discarded.
    rerender({ searchTerm: '', active: false })
    expect(input).toHaveValue('')
  })

  it('clears through onClear and returns focus to the input', async () => {
    const user = userEvent.setup()
    const { onClear } = renderForm({ searchTerm: 'async', active: true })
    const input = screen.getByRole('searchbox', { name: 'Search episodes' })

    await user.click(screen.getByRole('button', { name: 'Clear episode search' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })
})
