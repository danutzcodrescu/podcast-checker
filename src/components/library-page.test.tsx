import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LibraryPage } from '#/components/library-page'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), signOut: vi.fn() }))

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

beforeEach(() => {
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.navigate.mockResolvedValue(undefined)
})

describe('library page', () => {
  it('shows the authenticated account and navigates to sign-in after signing out', async () => {
    const user = userEvent.setup()
    render(<LibraryPage email="listener@example.com" />)
    expect(screen.getByText('You’re signed in as listener@example.com.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(mocks.signOut).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/signin', replace: true }),
    )
  })

  it('stays on the page and allows retry when signing out fails', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { message: 'Server error' } })
    const user = userEvent.setup()
    render(<LibraryPage email="listener@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to sign out. Please try again.',
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/signin', replace: true }),
    )
  })
})
