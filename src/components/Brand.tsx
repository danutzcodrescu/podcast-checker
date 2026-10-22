import { cn } from '#/lib/utils'

export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-3 text-xl font-bold tracking-tight text-heading mobile:gap-2 mobile:text-lg',
        className,
      )}
    >
      <img
        className="size-8 shrink-0 object-contain"
        src="/logo-mark.png"
        alt=""
        width={32}
        height={32}
      />
      <span>Podcast Finder</span>
    </span>
  )
}
