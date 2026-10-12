import { Link } from '@tanstack/react-router'

import { m } from '#/paraglide/messages'

export function AppHeader() {
  return (
    <header className="auth-header">
      <Link to="/" className="brand" aria-label={m.brand_home()}>
        <img src="/logo-mark.png" alt="" width={40} height={40} />
        <span>Podcast Finder</span>
      </Link>
    </header>
  )
}
