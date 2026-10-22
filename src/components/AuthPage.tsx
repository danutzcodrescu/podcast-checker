import { Link, useHydrated, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, LoaderCircle, Mail } from 'lucide-react'
import { useReducer } from 'react'
import type { SubmitEvent } from 'react'

import { AppHeader } from '#/components/AppHeader'
import { Brand } from '#/components/Brand'
import ParaglideLocaleSwitcher from '#/components/LocaleSwitcher'
import { PageShell } from '#/components/PageShell'
import { PodcastShowcase } from '#/components/PodcastShowcase'
import { Button } from '#/components/ui/Button'
import { Input } from '#/components/ui/Input'
import { PasswordInput } from '#/components/ui/PasswordInput'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

type AuthMode = 'sign-in' | 'sign-up'
type AuthPageProps = { mode: AuthMode; signupEnabled?: boolean }
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

export function AuthPage({ mode, signupEnabled = false }: AuthPageProps) {
  return (
    <PageShell>
      <AppHeader />
      <main className="relative isolate mx-auto mt-16 grid max-w-7xl grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-20 laptop:gap-9 tablet:mt-10 tablet:max-w-2xl tablet:grid-cols-1 tablet:gap-7 mobile:mt-8 mobile:gap-6">
        <img
          src="/illustrations/microphone.svg"
          alt=""
          aria-hidden="true"
          width={400}
          height={320}
          className="pointer-events-none absolute top-40 -right-64 -z-10 w-[28rem] max-w-none -rotate-12 opacity-80 laptop:hidden"
        />
        <PodcastShowcase />
        <div className="min-w-0 tablet:row-start-3">
          <section
            className="rounded-3xl border border-white bg-surface px-10 pt-10 pb-9 shadow-elevated ring-1 ring-border/60 laptop:px-8 tablet:p-9 mobile:rounded-2xl mobile:px-6 mobile:py-7"
            aria-labelledby="auth-heading"
          >
            <div className="mb-9 flex justify-center mobile:mb-7">
              <Brand />
            </div>
            <AuthForm key={mode} mode={mode} signupEnabled={signupEnabled} />
          </section>
          <ParaglideLocaleSwitcher />
        </div>
      </main>
    </PageShell>
  )
}

function AuthForm({ mode, signupEnabled }: AuthPageProps) {
  const isSignUp = mode === 'sign-up'
  const hydrated = useHydrated()
  const navigate = useNavigate()
  const [{ rememberMe, pending, error, confirmationError }, updateState] = useReducer(formReducer, {
    rememberMe: true,
    pending: false,
    error: '',
    confirmationError: '',
  })

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
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
        if (isSignUp && result.error.status === 404) {
          // Recheck the route on the server so an already-open form also gets the 404 page.
          await navigate({ to: '/signup', reloadDocument: true })
          return
        }
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
      <h2 id="auth-heading" className="m-0 text-page-title leading-tight font-bold tracking-tight">
        {isSignUp ? m.auth_create_account_heading() : m.auth_welcome_back()}
      </h2>
      <p className="mt-3 text-base leading-normal text-subtle">
        {isSignUp ? m.auth_sign_up_subtitle() : m.auth_sign_in_subtitle()}
      </p>

      <form
        className="mt-8 flex flex-col gap-6 mobile:mt-7"
        onSubmit={handleSubmit}
        aria-busy={pending}
      >
        <div className="flex flex-col gap-2.5">
          <label className="text-sm font-semibold text-foreground" htmlFor="email">
            {m.auth_email_label()}
          </label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute top-4 left-4 size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="h-13 pr-4 pl-12"
              id="email"
              name="email"
              type="email"
              placeholder={m.auth_email_placeholder()}
              autoComplete="email"
              required
              disabled={!hydrated || pending}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="text-sm font-semibold text-foreground" htmlFor="password">
            {m.auth_password_label()}
          </label>
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
            <p id="password-hint" className="m-0 text-sm text-subtle">
              {m.auth_password_hint()}
            </p>
          )}
        </div>

        {isSignUp && (
          <div className="flex flex-col gap-2.5">
            <label className="text-sm font-semibold text-foreground" htmlFor="confirm-password">
              {m.auth_confirm_password_label()}
            </label>
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
              <p id="confirmation-error" className="m-0 text-sm text-destructive" role="alert">
                {confirmationError}
              </p>
            )}
          </div>
        )}

        {!isSignUp && (
          <label className="relative inline-flex w-fit cursor-pointer items-center gap-4 text-sm text-foreground">
            <input
              className="peer absolute left-0 m-0 size-7 cursor-pointer opacity-0"
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => updateState({ rememberMe: event.target.checked })}
              disabled={!hydrated || pending}
            />
            <span
              className="grid size-7 place-items-center rounded-md border border-input bg-white text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
              aria-hidden="true"
            >
              <Check className="size-5" strokeWidth={3} />
            </span>
            <span>{m.auth_remember_me()}</span>
          </label>
        )}

        {error && (
          <p
            className="-my-2 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="min-h-13 text-base" disabled={!hydrated || pending}>
          {pending && <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
          {pending
            ? isSignUp
              ? m.auth_creating_account()
              : m.auth_signing_in()
            : isSignUp
              ? m.auth_create_account()
              : m.auth_sign_in()}
          {!pending && <ArrowRight className="size-5" aria-hidden="true" />}
        </Button>
      </form>

      {(isSignUp || signupEnabled) && (
        <div className="mt-9 flex flex-wrap justify-center gap-2 border-t border-border pt-9 text-sm text-foreground mobile:mt-7 mobile:pt-6">
          <span>{isSignUp ? m.auth_existing_account() : m.auth_new_here()}</span>
          <Link
            className="font-semibold text-link hover:underline hover:underline-offset-4"
            to={isSignUp ? '/signin' : '/signup'}
          >
            {isSignUp ? m.auth_sign_in() : m.auth_create_account_heading()}
          </Link>
        </div>
      )}
    </>
  )
}
