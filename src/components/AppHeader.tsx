import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export function AppHeader({
  children,
  variant = 'auth',
}: {
  children?: ReactNode
  variant?: 'auth' | 'discover'
}) {
  return (
    <header
      className={cn(
        'mx-auto flex max-w-page flex-wrap items-center justify-between gap-5',
        variant === 'discover' &&
          'gap-8 border-b border-border pb-6 tablet:grid tablet:grid-cols-[minmax(0,1fr)_auto] tablet:gap-5',
      )}
    >
      <Link
        to="/"
        className="inline-flex items-center gap-3 text-xl font-bold tracking-tight text-heading no-underline mobile:gap-2 mobile:text-lg"
        aria-label={m.brand_home()}
      >
        <img
          className="size-8 shrink-0 object-contain"
          src="/logo-mark.png"
          alt=""
          width={32}
          height={32}
        />
        <span>Podcast Finder</span>
      </Link>
      {children}
    </header>
  )
}
