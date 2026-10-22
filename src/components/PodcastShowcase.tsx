import { AudioLines } from 'lucide-react'

import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const artworkStyles = {
  development: 'text-artwork-development-foreground bg-[linear-gradient(140deg,#dae4ff,#d4d7f6)]',
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
      <div className="tablet:row-start-1">
        <p className="mb-4 text-xs font-semibold tracking-eyebrow-wide text-primary uppercase">
          {m.discovery_eyebrow()}
        </p>
        <h1
          id="discovery-heading"
          className="m-0 text-hero leading-hero font-bold tracking-tighter text-heading tablet:text-hero-compact [&:lang(fr)]:text-hero-localized"
        >
          {m.discovery_heading_start()}
          <br />
          <span className="text-primary">{m.discovery_heading_end()}</span>
        </h1>
      </div>
      <p className="mt-5 mb-8 text-intro leading-snug tracking-tight text-subtle tablet:row-start-2 tablet:-mt-3 tablet:mb-0">
        {m.discovery_subtitle()}
      </p>

      <ul
        className="m-0 grid list-none gap-4 p-0 tablet:row-start-4"
        aria-label={m.podcast_list_label()}
      >
        {podcasts.map((podcast) => (
          <li
            key={podcast.name}
            className="flex min-h-36 items-center gap-5 rounded-2xl border border-card-border bg-white/70 p-3.5 shadow-card laptop:gap-4 mobile:gap-3"
          >
            <div
              className={cn(
                'flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl mobile:size-20',
                artworkStyles[podcast.artwork],
              )}
              aria-hidden="true"
            >
              <AudioLines
                className="size-14 opacity-60 mobile:size-10"
                aria-hidden="true"
                strokeWidth={1.25}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="mt-0 mb-1 text-base leading-tight font-bold tracking-tight text-heading">
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
          </li>
        ))}
      </ul>
    </section>
  )
}
