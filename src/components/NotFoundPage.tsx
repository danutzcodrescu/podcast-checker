import { Link } from '@tanstack/react-router'

import { AppHeader } from '#/components/AppHeader'
import { PageShell } from '#/components/PageShell'
import { m } from '#/paraglide/messages'

export function NotFoundPage() {
  return (
    <PageShell>
      <AppHeader />
      <main className="mx-auto mt-20 max-w-2xl text-center tablet:mt-12">
        <p className="text-sm font-semibold text-muted-foreground">404</p>
        <h1 className="mt-3 text-page-title font-bold tracking-tight">{m.not_found_heading()}</h1>
        <p className="mt-4 text-muted-foreground">{m.not_found_description()}</p>
        <Link className="mt-6 inline-block text-link underline underline-offset-4" to="/">
          {m.home_page()}
        </Link>
      </main>
    </PageShell>
  )
}
