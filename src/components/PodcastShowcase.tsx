import { AudioLines, Play } from 'lucide-react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const artworkStyles = {
  development: 'text-surface-muted-foreground bg-[linear-gradient(140deg,#e4edf1,#cbdce3)]',
  history: 'text-[#98746a] bg-[linear-gradient(140deg,#f5e7e0,#e8cfc5)]',
  world: 'text-[#59776d] bg-[linear-gradient(140deg,#e5eee8,#ccdfd4)]',
}

const categoryStyles = {
  blue: 'text-link bg-[#d9efff]',
  coral: 'text-destructive bg-[#ffe0db]',
  green: 'text-[#1b7860] bg-[#daf7e9]',
}

const podcasts = [
  {
    name: 'Syntax',
    hosts: 'Wes Bos & Scott Tolinski',
    categories: [{ label: m.category_development, color: 'blue' }],
    description: m.podcast_syntax_description,
    artwork: 'development',
  },
  {
    name: 'The Rest Is History',
    hosts: 'Tom Holland & Dominic Sandbrook',
    categories: [{ label: m.category_history, color: 'coral' }],
    description: m.podcast_history_description,
    artwork: 'history',
  },
  {
    name: 'CONFLICTED',
    hosts: 'Aimen Dean & Thomas Small',
    categories: [
      { label: m.category_world_affairs, color: 'green' },
      { label: m.category_history, color: 'coral' },
    ],
    description: m.podcast_conflicted_description,
    artwork: 'world',
  },
] as const

export function PodcastShowcase() {
  return (
    <section className="tablet:contents" aria-labelledby="discovery-heading">
      <h1
        id="discovery-heading"
        className="m-0 text-hero leading-none font-extrabold tracking-tighter tablet:row-start-1 tablet:text-hero-compact [&:lang(fr)]:text-hero-localized"
      >
        {m.discovery_heading_start()}
        <br />
        {m.discovery_heading_end()}
      </h1>
      <p className="mt-5 mb-10 text-intro leading-snug tracking-tight text-subtle tablet:row-start-2 tablet:-mt-5 tablet:mb-0">
        {m.discovery_subtitle()}
      </p>

      <ul
        className="m-0 grid list-none gap-4 p-0 tablet:row-start-4"
        aria-label={m.podcast_list_label()}
      >
        {podcasts.map((podcast) => (
          <li
            key={podcast.name}
            className="relative flex min-h-48 items-center gap-6 rounded-2xl border border-card-border bg-white/50 p-4 laptop:gap-4 tablet:min-h-40 mobile:gap-3"
          >
            <div
              className={cn(
                'flex h-40 shrink-0 basis-40 flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-black/2 laptop:h-36 laptop:basis-32 tablet:h-32 mobile:h-28 mobile:basis-20 mobile:gap-2',
                artworkStyles[podcast.artwork],
              )}
              aria-hidden="true"
            >
              <AudioLines
                className="size-14 opacity-60 mobile:size-10"
                aria-hidden="true"
                strokeWidth={1.25}
              />
              <span className="text-caption tracking-wide opacity-75 mobile:max-w-16 mobile:text-center mobile:leading-snug">
                {m.artwork_placeholder()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="mt-0 mr-9 mb-1 text-lg leading-tight font-bold tracking-tight text-heading laptop:mr-8 mobile:mr-0 mobile:text-base">
                {podcast.name}
              </h2>
              <p className="m-0 text-sm leading-snug text-subtle mobile:text-xs">{podcast.hosts}</p>
              <div className="my-2 flex flex-wrap gap-2 mobile:gap-1">
                {podcast.categories.map((category) => (
                  <span
                    key={category.color}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm leading-snug laptop:px-2.5 laptop:text-xs mobile:px-2',
                      categoryStyles[category.color],
                    )}
                  >
                    {category.label()}
                  </span>
                ))}
              </div>
              <p className="m-0 text-sm leading-snug text-subtle mobile:text-xs">
                {podcast.description()}
              </p>
            </div>
            <span
              className="absolute top-6 right-6 grid size-12 place-items-center rounded-full bg-accent laptop:top-4 laptop:right-4 laptop:size-8 mobile:hidden"
              aria-hidden="true"
            >
              <Play className="ml-1 size-6 laptop:size-4" fill="currentColor" strokeWidth={0} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
