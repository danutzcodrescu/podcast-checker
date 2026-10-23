import { Link } from '@tanstack/react-router'
import { Check, LoaderCircle, MoreVertical } from 'lucide-react'

import { CategoryBadge, PodcastArtwork } from '#/components/PodcastCard'
import { pocketCastsErrorMessage } from '#/components/PocketCastsConnection'
import { Button } from '#/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/DropdownMenu'
import type { PocketCastsIntegration } from '#/hooks/use-pocket-casts'
import type { LatestEpisode } from '#/lib/latest-episodes'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

export function episodeDayLabel(publishedAt: string | null, locale: string, now: number) {
  if (!publishedAt) return m.episodes_unknown_date()
  const date = new Date(publishedAt)
  const today = new Date(now)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return m.episodes_today()
  if (date.toDateString() === yesterday.toDateString()) return m.episodes_yesterday()
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
}

export function EpisodeCard({
  episode,
  categories,
  now,
  pocketCasts,
  compact = false,
}: {
  episode: LatestEpisode
  categories: string[]
  now: number
  pocketCasts: PocketCastsIntegration
  compact?: boolean
}) {
  const locale = getLocale()
  const date = episode.publishedAt ? new Date(episode.publishedAt) : null
  const hoursAgo = date ? Math.floor((now - date.getTime()) / 3_600_000) : null
  const recent = hoursAgo !== null && hoursAgo >= 0 && hoursAgo < 24
  const published =
    hoursAgo !== null && hoursAgo >= 0 && (recent || compact)
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
          recent ? -hoursAgo : -Math.floor(hoursAgo / 24),
          recent ? 'hour' : 'day',
        )
      : episodeDayLabel(episode.publishedAt, locale, now)
  const { connection, queue } = pocketCasts
  const currentAction = queue.variables === episode.id
  const queued = currentAction && queue.isSuccess
  const duration =
    episode.durationSeconds !== null && episode.durationSeconds > 0
      ? m.episodes_minutes({ count: Math.max(1, Math.round(episode.durationSeconds / 60)) })
      : null
  const action = (
    <Button
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      className={cn(
        'shrink-0 mobile:size-10 mobile:p-0',
        compact && 'rounded-full border-card-border bg-background text-primary',
      )}
      disabled={!connection.data || queue.isPending}
      title={!connection.data ? m.pocket_casts_connect_hint() : m.pocket_casts_play_next()}
      aria-label={m.pocket_casts_play_next_label({ title: episode.title })}
      onClick={() => queue.mutate(episode.id)}
    >
      {currentAction && queue.isPending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : queued ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <img src="/pocket-casts.svg" alt="" width={20} height={20} className="size-5 shrink-0" />
      )}
      {!compact && (
        <span className="mobile:sr-only">
          {currentAction && queue.isPending ? m.pocket_casts_adding() : m.pocket_casts_play_next()}
        </span>
      )}
    </Button>
  )

  return (
    <li
      className={cn(
        'flex items-start gap-5 rounded-xl border border-card-border bg-surface p-4 shadow-card mobile:gap-3 mobile:p-3',
        compact &&
          'items-center gap-4 p-2.5 mobile:grid mobile:grid-cols-[auto_minmax(0,1fr)] mobile:items-start mobile:gap-x-3 mobile:gap-y-2',
      )}
    >
      <div className="relative shrink-0 self-start">
        <PodcastArtwork
          compact={compact}
          key={episode.artworkUrl ?? episode.podcast.artworkUrl}
          podcast={{
            ...episode.podcast,
            artworkUrl: episode.artworkUrl ?? episode.podcast.artworkUrl,
          }}
        />
        {compact && duration && (
          <span className="absolute right-1 bottom-1 rounded bg-heading/85 px-1.5 py-0.5 text-xs text-white">
            {duration}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 wrap-anywhere">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={cn('text-sm text-muted-foreground', compact && 'text-xs')}>
            {episode.podcast.title}
          </p>
          {compact && (
            <span className="text-xs text-muted-foreground">
              {date ? (
                <time dateTime={episode.publishedAt ?? undefined}>{published}</time>
              ) : (
                published
              )}
            </span>
          )}
          {recent && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-900">
              {m.episodes_new()}
            </span>
          )}
          {episode.matchType === 'semantic' && (
            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs text-purple-900">
              {m.episodes_semantic_match()}
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-3">
          <h3
            className={cn(
              'min-w-0 flex-1 text-lg leading-snug font-bold tracking-tight mobile:text-base',
              compact && 'text-base',
            )}
          >
            {episode.title}
          </h3>
          {!compact && action}
        </div>
        {!compact && (
          <p className="mt-1 text-sm text-muted-foreground">
            {date ? (
              <time dateTime={episode.publishedAt ?? undefined}>{published}</time>
            ) : (
              published
            )}
            {duration && <> · {duration}</>}
          </p>
        )}
        {episode.description && (
          <p
            className={cn(
              'mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground',
              compact && 'mt-1 leading-snug',
            )}
          >
            {episode.description}
          </p>
        )}
        {categories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.map((name) => (
              <CategoryBadge key={name} name={name} />
            ))}
          </div>
        )}
        {queued && (
          <output className="mt-2 block text-sm text-muted-foreground">
            {m.pocket_casts_added()}
          </output>
        )}
        {currentAction && queue.isError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {pocketCastsErrorMessage(queue.error)}
          </p>
        )}
      </div>
      {compact && (
        <div className="flex shrink-0 items-center gap-1 mobile:col-start-2 mobile:justify-end">
          {action}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="text-muted-foreground" />}
              aria-label={m.chat_episode_actions({ title: episode.title })}
            >
              <MoreVertical className="size-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <Link
                    to="/latest-episodes"
                    search={{ podcast: episode.podcast.id, days: 'all' }}
                  />
                }
              >
                {m.chat_browse_podcast()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  )
}
