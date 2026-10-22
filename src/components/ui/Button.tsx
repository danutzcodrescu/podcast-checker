import { Button as ButtonPrimitive } from '@base-ui/react/button'
import type { ComponentProps } from 'react'

import { cn } from '#/lib/utils'

const variants = {
  default:
    'border-transparent bg-primary bg-linear-to-br from-white/10 to-transparent text-primary-foreground shadow-sm shadow-primary/15 enabled:hover:bg-primary-hover disabled:bg-primary-disabled disabled:bg-none disabled:opacity-100 disabled:shadow-none',
  outline: 'border-border bg-white text-foreground enabled:hover:bg-accent',
  ghost: 'border-transparent bg-transparent text-foreground enabled:hover:bg-accent',
}

const sizes = {
  default: 'min-h-12 w-full px-5 py-3',
  sm: 'min-h-10 w-auto px-3 py-2',
  icon: 'size-11 shrink-0 p-0',
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<typeof ButtonPrimitive> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={(state) =>
        cn(
          'inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors duration-150 disabled:cursor-default disabled:opacity-65',
          variants[variant],
          sizes[size],
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    />
  )
}

export { Button }
