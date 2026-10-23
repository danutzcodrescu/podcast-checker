import { useHydrated } from '@tanstack/react-router'
import { Globe, LoaderCircle, LogOut, Menu } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/DropdownMenu'
import { m } from '#/paraglide/messages'
import { cn } from '#/lib/utils'
import { assertIsLocale, getLocale, locales, setLocale } from '#/paraglide/runtime'

type AccountMenuProps = {
  email: string
  pending: boolean
  onSignOut: () => Promise<void>
  avatar?: boolean
}

export function AccountMenu({ email, pending, onSignOut, avatar = false }: AccountMenuProps) {
  const hydrated = useHydrated()
  const currentLocale = getLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={pending ? m.auth_signing_out() : m.account_menu_label()}
        aria-busy={pending}
        disabled={!hydrated || pending}
        className={cn(
          'col-start-2 row-start-1 ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-popover text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
          avatar &&
            'size-10 rounded-full border-heading bg-heading text-xs font-semibold text-white hover:bg-heading/90',
        )}
      >
        {pending ? (
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        ) : avatar ? (
          <span aria-hidden="true">
            {email
              .split(/[.@_-]/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()}
          </span>
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
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {m.account_menu_heading()}
            <p className="mt-1 truncate text-xs font-normal text-muted-foreground" title={email}>
              {email}
            </p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
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
                closeOnClick
                lang={locale}
                disabled={pending}
                className="min-h-11 cursor-pointer rounded-md"
              >
                {locale === 'en' ? m.language_english() : m.language_french()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onClick={() => void onSignOut()}
          className="min-h-11 cursor-pointer rounded-md"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {pending ? m.auth_signing_out() : m.auth_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
