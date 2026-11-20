export type PodcastSync = {
  status: 'queued' | 'syncing' | 'ready' | 'failed'
  embeddingsEnabled: boolean
  episodes: number
  embedded: number
  failed: number
  lastSyncedAt: string | null
}
