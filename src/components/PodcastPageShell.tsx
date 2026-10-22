import { Link, useNavigate } from '@tanstack/react-router'
import { useReducer } from 'react'
import type { ReactNode } from 'react'

import { AccountMenu } from '#/components/AccountMenu'
import { AppHeader } from '#/components/AppHeader'
import { PageShell } from '#/components/PageShell'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

type SignOutState = { pending: boolean; error: string }

export function PodcastPageShell({
  email,
  activeTab,
  onDiscover,
  children,
}: {
  email: string
  activeTab: 'discover' | 'latest-episodes'
  onDiscover?: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
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
          className="flex items-center gap-8 self-stretch tablet:col-span-full tablet:row-start-2 mobile:gap-5"
          aria-label={m.search_navigation()}
        >
          {(['discover', 'latest-episodes'] as const).map((tab) => (
            <Link
              key={tab}
              className={cn(
                'border-b-3 border-transparent px-1 py-4 text-sm font-semibold no-underline',
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              to={tab === 'discover' ? '/discover' : '/latest-episodes'}
              onClick={tab === 'discover' ? onDiscover : undefined}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {tab === 'discover' ? m.search_discover_tab() : m.episodes_heading()}
            </Link>
          ))}
        </nav>
        <AccountMenu email={email} pending={pending} onSignOut={signOut} />
      </AppHeader>
      <main className="mx-auto mt-6 max-w-7xl tablet:mt-5">
        {error && (
          <p
            className="mb-6 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {children}
      </main>
    </PageShell>
  )
}
