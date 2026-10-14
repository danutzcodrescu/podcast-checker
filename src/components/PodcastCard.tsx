import { ArrowUpRight, Headphones } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Podcast } from '#/lib/apple-podcasts'
import { getPodcastArtworkSrcSet } from '#/lib/podcast-artwork'
import { m } from '#/paraglide/messages'

const categoryColors = [
  'bg-blue-100 text-blue-900',
  'bg-amber-100 text-amber-900',
  'bg-green-100 text-green-900',
  'bg-purple-100 text-purple-900',
  'bg-rose-100 text-rose-900',
]
const emptyCategories: string[] = []

export function CategoryBadge({ name }: { name: string }) {
  const color =
    [...name.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    categoryColors.length
  return (
    <span
      className={`inline-block max-w-full rounded-full px-2.5 py-1 text-xs wrap-anywhere ${categoryColors[color]}`}
    >
      {name}
    </span>
  )
}

export function PodcastArtwork({ podcast, small = false }: { podcast: Podcast; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-muted text-surface-muted-foreground ${small ? 'size-16' : 'size-artwork basis-artwork tablet:row-span-2 mobile:row-span-1 mobile:size-artwork-mobile'}`}
    >
      {podcast.artworkUrl && !failed ? (
        <img
          className="size-full object-cover"
          src={podcast.artworkUrl}
          srcSet={getPodcastArtworkSrcSet(podcast.artworkUrl)}
          sizes={small ? '64px' : '(max-width: 480px) 80px, 112px'}
          alt=""
          width={small ? 64 : 112}
          height={small ? 64 : 112}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <Headphones className={small ? 'size-6' : 'size-10'} aria-hidden="true" />
      )}
    </div>
  )
}

export function PodcastCard({
  podcast,
  categories = emptyCategories,
  actions,
}: {
  podcast: Podcast
  categories?: string[]
  actions?: ReactNode
}) {
  return (
    <li className="flex items-center gap-6 rounded-xl border border-card-border bg-surface p-4 pr-5 tablet:grid tablet:grid-cols-[auto_minmax(0,1fr)] tablet:gap-x-4 tablet:gap-y-2 mobile:gap-x-3 mobile:p-3">
      <PodcastArtwork podcast={podcast} />
      <div className="min-w-0 flex-1 wrap-anywhere">
        <h2 className="m-0 text-lg leading-snug font-bold tracking-tight mobile:text-base">
          {podcast.title}
        </h2>
        {podcast.publisher && (
          <p className="mt-2 text-sm leading-snug text-muted-foreground">{podcast.publisher}</p>
        )}
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map((name) => (
              <CategoryBadge key={name} name={name} />
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 tablet:col-start-2 tablet:items-start mobile:col-span-2 mobile:col-start-1">
        {actions}
        <a
          className="inline-flex items-center gap-1.5 text-sm leading-snug text-link no-underline hover:underline hover:underline-offset-4"
          href={podcast.appleUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {m.search_view_podcast()} <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
      </div>
    </li>
  )
}
