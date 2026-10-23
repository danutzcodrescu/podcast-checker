import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Brand } from '#/components/Brand'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export function AppHeader({
  children,
  variant = 'auth',
}: {
  children?: ReactNode
  variant?: 'auth' | 'discover' | 'chat'
}) {
  return (
    <header
      className={cn(
        'mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-5',
        variant !== 'auth' &&
          'justify-start gap-10 border-b border-border tablet:grid tablet:grid-cols-[minmax(0,1fr)_auto] tablet:gap-x-5 tablet:gap-y-0',
        variant === 'chat' && 'min-h-16 w-full shrink-0 gap-8',
      )}
    >
      <Link to="/" className="inline-flex no-underline" aria-label={m.brand_home()}>
        <Brand />
      </Link>
      {children}
    </header>
  )
}
