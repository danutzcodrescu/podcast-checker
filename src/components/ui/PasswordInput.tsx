import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { ComponentProps } from 'react'

import { Input } from '#/components/ui/Input'
import { cn } from '#/lib/utils'

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  showLabel: string
  hideLabel: string
}

export function PasswordInput({
  className,
  disabled,
  id,
  showLabel,
  hideLabel,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        className={cn('h-12 px-4 pr-14', className)}
        disabled={disabled}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-2 my-auto grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-black/5 disabled:pointer-events-none disabled:opacity-50"
        onClick={() => setVisible((previous) => !previous)}
        aria-label={visible ? hideLabel : showLabel}
        aria-controls={id}
        aria-pressed={visible}
        disabled={disabled}
      >
        {visible ? (
          <EyeOff className="size-5" aria-hidden="true" />
        ) : (
          <Eye className="size-5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
