import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

export function PodcastHero({
  headingId,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  headingId: string
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative isolate mb-6 overflow-hidden rounded-2xl border border-white/80 bg-[linear-gradient(115deg,#f0ecff_0%,#eeedff_48%,#d4e1ff_100%)] p-7 mobile:p-5',
        className,
      )}
    >
      <img
        src="/illustrations/microphone.svg"
        alt=""
        aria-hidden="true"
        width={400}
        height={320}
        className="pointer-events-none absolute -top-8 -right-10 -z-10 h-64 w-80 max-w-none mobile:-top-4 mobile:-right-12 mobile:h-36 mobile:w-44 mobile:opacity-45"
      />
      <div className="pr-44 mobile:pr-12">
        <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-accent-foreground uppercase mobile:text-[0.625rem]">
          {eyebrow}
        </p>
        <h1
          id={headingId}
          className="max-w-xl text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.12] font-bold tracking-tight text-heading"
        >
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-subtle mobile:text-sm">
          {description}
        </p>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
