import { Button } from '#/components/ui/Button'
import type { PodcastSync } from '#/lib/podcast-sync'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

export function PodcastSyncStatus({
  sync,
  hasFeed,
  onRetry,
  disabled,
}: {
  sync?: PodcastSync | null
  hasFeed: boolean
  onRetry: () => void
  disabled: boolean
}) {
  if (!hasFeed) return <p className="mt-3 text-sm text-muted-foreground">{m.sync_no_feed()}</p>
  const failed = sync?.status === 'failed' || !!sync?.failed
  const label = failed
    ? m.sync_failed()
    : sync?.status === 'syncing'
      ? m.sync_importing()
      : !sync || sync.status === 'queued'
        ? m.sync_queued()
        : sync.embedded < sync.episodes
          ? m.sync_embedding()
          : m.sync_ready()
  return (
    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
      <p>
        {label}
        {sync && ` · ${m.sync_progress({ imported: sync.episodes, embedded: sync.embedded })}`}
      </p>
      {sync?.lastSyncedAt && (
        <p>
          {m.sync_last_refresh({ date: new Date(sync.lastSyncedAt).toLocaleString(getLocale()) })}
        </p>
      )}
      {failed && (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRetry}>
          {m.sync_retry()}
        </Button>
      )}
    </div>
  )
}
