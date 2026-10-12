import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentPropsWithoutRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscoverPage } from '#/components/DiscoverPage'
import * as localeRuntime from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), signOut: vi.fn(), setLocale: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentPropsWithoutRef<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useHydrated: () => true,
  useNavigate: () => mocks.navigate,
}))

vi.mock('#/lib/auth-client', () => ({ authClient: { signOut: mocks.signOut } }))
vi.mock('#/lib/podcast-search', () => ({ searchPodcasts: vi.fn() }))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DiscoverPage email="listener@example.com" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.navigate.mockResolvedValue(undefined)
  vi.spyOn(localeRuntime, 'setLocale').mockImplementation(mocks.setLocale)
})

afterEach(() => vi.restoreAllMocks())

async function openMenu(user: ReturnType<typeof userEvent.setup>, name = 'Account menu') {
  await user.click(screen.getByRole('button', { name }))
  return screen.findByRole('menu')
}

describe('discover page', () => {
  it('opens on podcast search with the Discover tab selected', () => {
    renderPage()

    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    const discover = within(navigation).getByRole('link', { name: 'Discover' })
    expect(discover).toHaveAttribute('href', '/')
    expect(discover).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Search podcasts' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search podcasts' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Categories' })).not.toBeInTheDocument()
    expect(within(navigation).queryByText('Latest episodes')).not.toBeInTheDocument()
  })

  it('shows the authenticated account and navigates to sign-in after signing out', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument()
    await openMenu(user)
    expect(screen.getByText('listener@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(mocks.signOut).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/signin', replace: true }),
    )
  })

  it('stays on the page and allows retry when signing out fails', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { message: 'Server error' } })
    const user = userEvent.setup()
    renderPage()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to sign out. Please try again.',
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    await openMenu(user)
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/signin', replace: true }),
    )
  })

  it.each([
    { locale: 'en' as const, menu: 'Account menu', target: 'fr', option: 'Français' },
    { locale: 'fr' as const, menu: 'Menu du compte', target: 'en', option: 'English' },
  ])(
    'shows the selected language and switches locale from the $locale account menu',
    async ({ locale, menu, target, option }) => {
      localeRuntime.overwriteGetLocale(() => locale)
      const user = userEvent.setup()
      renderPage()
      await openMenu(user, menu)
      expect(
        screen.getByRole('menuitemradio', { name: locale === 'en' ? 'English' : 'Français' }),
      ).toHaveAttribute('aria-checked', 'true')
      expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
      await user.click(screen.getByRole('menuitemradio', { name: option }))

      expect(mocks.setLocale).toHaveBeenCalledWith(target)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(mocks.signOut).not.toHaveBeenCalled()
    },
  )

  it('opens the account menu with the keyboard and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderPage()
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('disables the account menu while signing out and recovers from a failed request', async () => {
    let resolveSignOut!: (result: { error: { message: string } }) => void
    mocks.signOut.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignOut = resolve
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    const trigger = screen.getByRole('button', { name: 'Signing out…' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-busy', 'true')
    expect(mocks.signOut).toHaveBeenCalledOnce()
    await act(async () => resolveSignOut({ error: { message: 'Server error' } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign out.')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeEnabled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
