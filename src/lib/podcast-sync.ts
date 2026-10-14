export type PodcastSync = {
  status: 'queued' | 'syncing' | 'ready' | 'failed'
  episodes: number
  embedded: number
  failed: number
  lastSyncedAt: string | null
}
