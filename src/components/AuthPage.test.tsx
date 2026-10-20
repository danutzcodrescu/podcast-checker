import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthPage } from '#/components/AuthPage'
import { m } from '#/paraglide/messages'
import { overwriteGetLocale } from '#/paraglide/runtime'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentPropsWithoutRef<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useHydrated: () => true,
  useNavigate: () => mocks.navigate,
}))

vi.mock('#/lib/auth-client', () => ({
  authClient: { signIn: { email: mocks.signIn }, signUp: { email: mocks.signUp } },
}))

beforeEach(() => {
  mocks.signIn.mockResolvedValue({ data: {}, error: null })
  mocks.signUp.mockResolvedValue({ data: {}, error: null })
  mocks.navigate.mockResolvedValue(undefined)
})

async function fillCredentials(user: ReturnType<typeof userEvent.setup>, confirmPassword = false) {
  await user.type(screen.getByLabelText('Email address'), 'listener@example.com')
  await user.type(screen.getByLabelText('Password', { exact: true }), 'password123')
  if (confirmPassword) {
    await user.type(screen.getByLabelText('Confirm password'), 'password123')
  }
}

describe('authentication forms', () => {
  it('hides the sign-up link by default while keeping sign-in available', () => {
    render(<AuthPage mode="sign-in" />)

    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
    expect(screen.queryByText('New here?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('shows the sign-up link when registration is enabled', () => {
    render(<AuthPage mode="sign-in" signupEnabled />)

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    )
  })

  it('keeps a link back to sign-in on the sign-up page', () => {
    render(<AuthPage mode="sign-up" />)

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
  })

  it.each([
    ['en', 'Create account'],
    ['fr', 'Créer un compte'],
  ] as const)(
    'handles registration being disabled after loading the form (%s)',
    async (locale, submit) => {
      overwriteGetLocale(() => locale)
      mocks.signUp.mockResolvedValueOnce({ error: { status: 404, code: 'NOT_FOUND' } })
      const user = userEvent.setup()
      render(<AuthPage mode="sign-up" />)
      await user.type(screen.getByRole('textbox'), 'listener@example.com')
      await user.type(
        screen.getByLabelText(m.auth_password_label(), { exact: true }),
        'password123',
      )
      await user.type(screen.getByLabelText(m.auth_confirm_password_label()), 'password123')
      await user.click(screen.getByRole('button', { name: submit }))

      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith({ to: '/signup', reloadDocument: true }),
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('signs up without a full name and navigates home after password confirmation', async () => {
    const user = userEvent.setup()
    render(<AuthPage mode="sign-up" />)

    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await fillCredentials(user, true)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(mocks.signUp).toHaveBeenCalledWith({
      name: 'listener',
      email: 'listener@example.com',
      password: 'password123',
    })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('toggles sign-up passwords independently without losing their values', async () => {
    const user = userEvent.setup()
    render(<AuthPage mode="sign-up" />)
    await fillCredentials(user, true)

    const password = screen.getByLabelText('Password', { exact: true })
    const confirmation = screen.getByLabelText('Confirm password')
    expect(password).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('password123')
    expect(confirmation).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveValue('password123')
    await user.click(screen.getByRole('button', { name: 'Show password confirmation' }))
    expect(confirmation).toHaveAttribute('type', 'text')
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password confirmation' }))
    expect(confirmation).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveValue('password123')
  })

  it('signs in without password confirmation and sends remember-me preference', async () => {
    const user = userEvent.setup()
    render(<AuthPage mode="sign-in" />)
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Show password confirmation' }),
    ).not.toBeInTheDocument()
    await fillCredentials(user)
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('password123')

    const rememberMe = screen.getByRole('checkbox', { name: 'Remember me' })
    expect(rememberMe).toBeChecked()
    await user.click(rememberMe)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'listener@example.com',
      password: 'password123',
      rememberMe: false,
    })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('blocks mismatched passwords on sign-up and allows correction', async () => {
    const user = userEvent.setup()
    render(<AuthPage mode="sign-up" />)
    await fillCredentials(user, true)
    const confirmation = screen.getByLabelText('Confirm password')
    await user.clear(confirmation)
    await user.type(confirmation, 'different-password')
    const submit = screen.getByRole('button', {
      name: 'Create account',
    })
    await user.click(submit)

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(confirmation).toBeInvalid()
    expect(confirmation).toHaveAccessibleDescription('Passwords do not match.')
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.signUp).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()

    await user.clear(confirmation)
    await user.type(confirmation, 'password123')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(confirmation).not.toBeInvalid()
    await user.click(submit)
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('disables submission while pending and allows retry after a localized API error', async () => {
    type AuthResult = { error: { code: string; message: string } }
    let resolveRequest!: (result: AuthResult) => void
    mocks.signIn.mockImplementationOnce(
      () =>
        new Promise<AuthResult>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const user = userEvent.setup()
    render(<AuthPage mode="sign-in" />)
    await fillCredentials(user)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('Email address')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Show password confirmation' }),
    ).not.toBeInTheDocument()
    await act(async () =>
      resolveRequest({
        error: {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Raw server message',
        },
      }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The email address or password is incorrect.',
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a connection error and keeps the form usable when the request fails', async () => {
    mocks.signUp.mockRejectedValueOnce(new Error('Network unavailable'))
    const user = userEvent.setup()
    render(<AuthPage mode="sign-up" />)
    await fillCredentials(user, true)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect.')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('renders French labels, podcast copy, and API errors with no German locale', async () => {
    overwriteGetLocale(() => 'fr')
    mocks.signIn.mockResolvedValueOnce({
      error: {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      },
    })
    const user = userEvent.setup()
    render(<AuthPage mode="sign-in" />)

    expect(screen.getByRole('heading', { name: 'Bon retour' })).toBeInTheDocument()
    expect(screen.getByText('Développement')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Langue' })).toHaveValue('fr')
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    await user.type(screen.getByLabelText('Adresse e-mail'), 'listener@example.com')
    await user.type(screen.getByLabelText('Mot de passe', { exact: true }), 'password123')
    expect(screen.queryByLabelText('Confirmer le mot de passe')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'L’adresse e-mail ou le mot de passe est incorrect.',
    )
  })
})
