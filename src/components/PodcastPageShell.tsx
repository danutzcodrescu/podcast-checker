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
  headerSearch,
  children,
}: {
  email: string
  activeTab: 'discover' | 'latest-episodes' | 'chat'
  onDiscover?: () => void
  children: ReactNode
  headerSearch?: ReactNode
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
    <PageShell
      className={
        activeTab === 'chat'
          ? 'flex h-dvh min-h-0 flex-col pt-0 pb-0 tablet:pt-0 tablet:pb-0'
          : undefined
      }
    >
      <AppHeader variant={activeTab === 'chat' ? 'chat' : 'discover'}>
        <nav
          className="flex max-w-full min-w-0 items-center gap-8 self-stretch overflow-x-auto tablet:col-span-full tablet:row-start-2 mobile:gap-3"
          aria-label={m.search_navigation()}
        >
          {(['discover', 'latest-episodes', 'chat'] as const).map((tab) => (
            <Link
              key={tab}
              className={cn(
                'shrink-0 border-b-3 border-transparent px-1 py-4 text-sm font-semibold no-underline mobile:text-xs',
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              to={tab === 'discover' ? '/discover' : tab === 'chat' ? '/chat' : '/latest-episodes'}
              onClick={tab === 'discover' ? onDiscover : undefined}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {tab === 'discover'
                ? m.search_discover_tab()
                : tab === 'chat'
                  ? m.chat_tab()
                  : m.episodes_heading()}
            </Link>
          ))}
        </nav>
        {headerSearch}
        <AccountMenu
          email={email}
          pending={pending}
          onSignOut={signOut}
          avatar={activeTab === 'chat'}
        />
      </AppHeader>
      <main
        className={cn(
          'mx-auto mt-6 max-w-7xl tablet:mt-5',
          activeTab === 'chat' && 'mt-0 flex min-h-0 w-full flex-1 flex-col tablet:mt-0',
        )}
      >
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
