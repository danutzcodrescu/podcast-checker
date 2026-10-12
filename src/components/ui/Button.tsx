import type { ComponentProps } from 'react'

import { cn } from '#/lib/utils'

function Button({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors duration-150 enabled:hover:bg-primary-hover disabled:cursor-default disabled:opacity-65',
        className,
      )}
      {...props}
    />
  )
}

export { Button }
