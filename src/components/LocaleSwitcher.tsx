import { useHydrated } from '@tanstack/react-router'
import { Globe } from 'lucide-react'

import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { m } from '#/paraglide/messages'
import { assertIsLocale, getLocale, locales, setLocale } from '#/paraglide/runtime'

export default function ParaglideLocaleSwitcher() {
  const currentLocale = getLocale()
  const hydrated = useHydrated()

  return (
    <footer className="mt-7 flex items-center justify-center gap-2 pb-2 text-muted-foreground">
      <Globe className="size-6" strokeWidth={1.75} aria-hidden="true" />
      <NativeSelect
        aria-label={m.language_label()}
        value={currentLocale}
        onChange={(event) => setLocale(assertIsLocale(event.target.value))}
        disabled={!hydrated}
        className="h-11 cursor-pointer border-0 pl-0 pr-8 text-base shadow-none hover:text-foreground"
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
