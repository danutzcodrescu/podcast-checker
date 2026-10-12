import { useHydrated } from '@tanstack/react-router'
import { Globe, LoaderCircle, LogOut, Menu } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/DropdownMenu'
import { m } from '#/paraglide/messages'
import { assertIsLocale, getLocale, locales, setLocale } from '#/paraglide/runtime'

type AccountMenuProps = {
  email: string
  pending: boolean
  onSignOut: () => Promise<void>
}

export function AccountMenu({ email, pending, onSignOut }: AccountMenuProps) {
  const hydrated = useHydrated()
  const currentLocale = getLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={pending ? m.auth_signing_out() : m.account_menu_label()}
        aria-busy={pending}
        disabled={!hydrated || pending}
        className="col-start-2 row-start-1 ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-popover text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="w-64 max-w-[calc(100vw-2rem)] rounded-xl p-2"
      >
        <DropdownMenuLabel>
          {m.account_menu_heading()}
          <p className="mt-1 truncate text-xs font-normal text-muted-foreground" title={email}>
            {email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
          <Globe className="size-4" aria-hidden="true" />
          {m.language_label()}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentLocale}
          onValueChange={(value) => setLocale(assertIsLocale(value))}
          aria-label={m.language_label()}
        >
          {locales.map((locale) => (
            <DropdownMenuRadioItem
              key={locale}
              value={locale}
              lang={locale}
              disabled={pending}
              className="min-h-11 cursor-pointer rounded-md"
            >
              {locale === 'en' ? m.language_english() : m.language_french()}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => void onSignOut()}
          className="min-h-11 cursor-pointer rounded-md"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {pending ? m.auth_signing_out() : m.auth_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
