import { Link, useHydrated, useNavigate } from '@tanstack/react-router'
import { Check, LoaderCircle } from 'lucide-react'
import { useReducer } from 'react'
import type { FormEvent } from 'react'

import { AppHeader } from '#/components/app-header'
import ParaglideLocaleSwitcher from '#/components/LocaleSwitcher'
import { PodcastShowcase } from '#/components/podcast-showcase'
import { Input } from '#/components/ui/input'
import { PasswordInput } from '#/components/ui/password-input'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

type AuthMode = 'sign-in' | 'sign-up'
type FormState = {
  rememberMe: boolean
  pending: boolean
  error: string
  confirmationError: string
}

function formReducer(state: FormState, update: Partial<FormState>): FormState {
  return { ...state, ...update }
}

function authErrorMessage(code?: string) {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return m.auth_error_credentials()
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return m.auth_error_account_exists()
    case 'PASSWORD_TOO_SHORT':
      return m.auth_error_password_short()
    case 'PASSWORD_TOO_LONG':
      return m.auth_error_password_long()
    case 'INVALID_EMAIL':
      return m.auth_error_email()
    default:
      return m.auth_error_generic()
  }
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  return (
    <div className="auth-page">
      <AppHeader />
      <main className="auth-layout">
        <PodcastShowcase />
        <div className="auth-column">
          <section className="auth-panel" aria-labelledby="auth-heading">
            <AuthForm key={mode} mode={mode} />
          </section>
          <ParaglideLocaleSwitcher />
        </div>
      </main>
    </div>
  )
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const isSignUp = mode === 'sign-up'
  const hydrated = useHydrated()
  const navigate = useNavigate()
  const [{ rememberMe, pending, error, confirmationError }, updateState] = useReducer(formReducer, {
    rememberMe: true,
    pending: false,
    error: '',
    confirmationError: '',
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const data = new FormData(event.currentTarget)
    const email = String(data.get('email')).trim()
    const password = String(data.get('password'))
    if (isSignUp && password !== String(data.get('confirmPassword'))) {
      updateState({ error: '', confirmationError: m.auth_error_password_mismatch() })
      return
    }
    updateState({ error: '', confirmationError: '', pending: true })

    try {
      const result = isSignUp
        ? // Better Auth requires a name internally; no separate name field is needed.
          await authClient.signUp.email({ name: email.split('@')[0], email, password })
        : await authClient.signIn.email({ email, password, rememberMe })

      if (result.error) {
        updateState({ error: authErrorMessage(result.error.code), pending: false })
        return
      }

      await navigate({ to: '/' })
    } catch {
      updateState({ error: m.auth_error_connection(), pending: false })
    }
  }

  return (
    <>
      <h2 id="auth-heading">
        {isSignUp ? m.auth_create_account_heading() : m.auth_welcome_back()}
      </h2>
      <p className="auth-subtitle">
        {isSignUp ? m.auth_sign_up_subtitle() : m.auth_sign_in_subtitle()}
      </p>

      <form className="auth-form" onSubmit={handleSubmit} aria-busy={pending}>
        <div className="form-field">
          <label htmlFor="email">{m.auth_email_label()}</label>
          <Input
            className="h-14 px-5 md:text-base"
            id="email"
            name="email"
            type="email"
            placeholder={m.auth_email_placeholder()}
            autoComplete="email"
            required
            disabled={!hydrated || pending}
          />
        </div>

        <div className="form-field">
          <label htmlFor="password">{m.auth_password_label()}</label>
          <PasswordInput
            id="password"
            name="password"
            showLabel={m.auth_show_password()}
            hideLabel={m.auth_hide_password()}
            placeholder={
              isSignUp ? m.auth_new_password_placeholder() : m.auth_password_placeholder()
            }
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={isSignUp ? 8 : undefined}
            maxLength={isSignUp ? 128 : undefined}
            aria-describedby={isSignUp ? 'password-hint' : undefined}
            required
            disabled={!hydrated || pending}
          />
          {isSignUp && (
            <p id="password-hint" className="field-hint">
              {m.auth_password_hint()}
            </p>
          )}
        </div>

        {isSignUp && (
          <div className="form-field">
            <label htmlFor="confirm-password">{m.auth_confirm_password_label()}</label>
            <PasswordInput
              id="confirm-password"
              name="confirmPassword"
              showLabel={m.auth_show_password_confirmation()}
              hideLabel={m.auth_hide_password_confirmation()}
              placeholder={m.auth_confirm_password_placeholder()}
              autoComplete="new-password"
              maxLength={128}
              aria-invalid={Boolean(confirmationError)}
              aria-describedby={confirmationError ? 'confirmation-error' : undefined}
              onChange={() => {
                if (confirmationError) updateState({ confirmationError: '' })
              }}
              required
              disabled={!hydrated || pending}
            />
            {confirmationError && (
              <p id="confirmation-error" className="field-error" role="alert">
                {confirmationError}
              </p>
            )}
          </div>
        )}

        {!isSignUp && (
          <label className="remember-me">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => updateState({ rememberMe: event.target.checked })}
              disabled={!hydrated || pending}
            />
            <span className="checkbox-icon" aria-hidden="true">
              <Check strokeWidth={3} />
            </span>
            <span>{m.auth_remember_me()}</span>
          </label>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="auth-submit" type="submit" disabled={!hydrated || pending}>
          {pending && <LoaderCircle className="loading-icon" aria-hidden="true" />}
          {pending
            ? isSignUp
              ? m.auth_creating_account()
              : m.auth_signing_in()
            : isSignUp
              ? m.auth_create_account()
              : m.auth_sign_in()}
        </button>
      </form>

      <div className="auth-switch">
        <span>{isSignUp ? m.auth_existing_account() : m.auth_new_here()}</span>
        <Link to={isSignUp ? '/signin' : '/signup'}>
          {isSignUp ? m.auth_sign_in() : m.auth_create_account_heading()}
        </Link>
      </div>
    </>
  )
}
