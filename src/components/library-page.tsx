import { useHydrated, useNavigate } from '@tanstack/react-router'
import { Headphones, LoaderCircle } from 'lucide-react'
import { useReducer } from 'react'

import { AppHeader } from '#/components/app-header'
import ParaglideLocaleSwitcher from '#/components/LocaleSwitcher'
import { PodcastShowcase } from '#/components/podcast-showcase'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

type SignOutState = { pending: boolean; error: string }

export function LibraryPage({ email }: { email: string }) {
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const [{ pending, error }, updateState] = useReducer(
    (state: SignOutState, update: Partial<SignOutState>) => ({ ...state, ...update }),
    { pending: false, error: '' },
  )

  async function signOut() {
    if (pending) return
    updateState({ pending: true, error: '' })
    try {
      const result = await authClient.signOut()
      if (result.error) {
        updateState({ pending: false, error: m.auth_error_sign_out() })
        return
      }
      await navigate({ to: '/signin', replace: true })
    } catch {
      updateState({ pending: false, error: m.auth_error_connection() })
    }
  }

  return (
    <div className="auth-page">
      <AppHeader />
      <main className="auth-layout">
        <PodcastShowcase />
        <div className="auth-column">
          <section className="auth-panel auth-success" aria-labelledby="library-heading">
            <span className="success-icon">
              <Headphones aria-hidden="true" />
            </span>
            <h2 id="library-heading">{m.library_heading()}</h2>
            <p className="auth-subtitle">{m.library_subtitle({ email })}</p>
            <p className="library-empty">{m.library_empty()}</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="auth-submit"
              disabled={!hydrated || pending}
              onClick={() => void signOut()}
            >
              {pending && <LoaderCircle className="loading-icon" aria-hidden="true" />}
              {pending ? m.auth_signing_out() : m.auth_sign_out()}
            </button>
          </section>
          <ParaglideLocaleSwitcher />
        </div>
      </main>
    </div>
  )
}
