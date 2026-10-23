import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative isolate min-h-svh overflow-clip bg-[radial-gradient(ellipse_at_95%_0%,#e8e6ff_0%,transparent_38%),radial-gradient(ellipse_at_0%_80%,#eeebff_0%,transparent_32%),linear-gradient(120deg,#fafbff,#fff_50%,#f8f8ff)] px-12 pt-5 pb-10 laptop:px-8 tablet:px-6 tablet:pt-4 tablet:pb-10 mobile:px-4',
        className,
      )}
    >
      {children}
    </div>
  )
}
