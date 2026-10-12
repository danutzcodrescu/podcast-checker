import { useHydrated } from '@tanstack/react-router'
import { Globe } from 'lucide-react'

import { NativeSelect, NativeSelectOption } from '#/components/ui/NativeSelect'
import { m } from '#/paraglide/messages'
import { assertIsLocale, getLocale, locales, setLocale } from '#/paraglide/runtime'

export default function ParaglideLocaleSwitcher() {
  const currentLocale = getLocale()
  const hydrated = useHydrated()

  return (
    <footer className="mt-8 flex items-center justify-center gap-1 pb-2 text-muted-foreground">
      <Globe className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <NativeSelect
        aria-label={m.language_label()}
        value={currentLocale}
        onChange={(event) => setLocale(assertIsLocale(event.target.value))}
        disabled={!hydrated}
        className="h-11 min-w-30 cursor-pointer border-0 bg-transparent pr-10 pl-3 text-base shadow-none hover:text-foreground md:text-sm dark:bg-transparent dark:hover:bg-transparent"
      >
        {locales.map((locale) => (
          <NativeSelectOption key={locale} value={locale} lang={locale}>
            {locale === 'en' ? m.language_english() : m.language_french()}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </footer>
  )
}
