import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '#/lib/utils'

function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={(state) =>
        cn(
          'peer flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-white shadow-xs transition-shadow outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
          'data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-items-center"
      >
        <Check className="size-3.5" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
