import type { ReactNode } from 'react'

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-[radial-gradient(ellipse_at_75%_45%,#fff_0%,transparent_65%)] px-16 pt-9 pb-8 laptop:px-8 tablet:px-6 tablet:pt-6 tablet:pb-10 mobile:px-5">
      {children}
    </div>
  )
}
