import { Link, useNavigate } from '@tanstack/react-router'
import { useReducer, useState } from 'react'

import { AppHeader } from '#/components/AppHeader'
import { AccountMenu } from '#/components/AccountMenu'
import { PageShell } from '#/components/PageShell'
import { PodcastLibrary } from '#/components/PodcastLibrary'
import type { PodcastLibraryFilter } from '#/components/PodcastLibrary'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

type SignOutState = { pending: boolean; error: string }

export function DiscoverPage({ email }: { email: string }) {
  const navigate = useNavigate()
  const [libraryFilter, setLibraryFilter] = useState<PodcastLibraryFilter>(null)
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
    <PageShell>
      <AppHeader variant="discover">
        <nav
          className="flex items-center self-stretch tablet:col-span-full tablet:row-start-2"
          aria-label={m.search_navigation()}
        >
          <Link
            className="border-b-3 border-primary px-1 py-4 text-sm font-semibold text-foreground no-underline"
            to="/"
            onClick={() => setLibraryFilter(null)}
            aria-current="page"
          >
            {m.search_discover_tab()}
          </Link>
        </nav>
        <AccountMenu email={email} pending={pending} onSignOut={signOut} />
      </AppHeader>
      <main className="mx-auto mt-10 max-w-7xl tablet:mt-9">
        {error && (
          <p
            className="mb-6 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        <PodcastLibrary email={email} filter={libraryFilter} onFilterChange={setLibraryFilter} />
      </main>
    </PageShell>
  )
}
