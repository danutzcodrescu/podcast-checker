import { useState } from 'react'

import { PodcastPageShell } from '#/components/PodcastPageShell'
import { PodcastLibrary } from '#/components/PodcastLibrary'
import type { PodcastLibraryFilter } from '#/components/PodcastLibrary'

export function DiscoverPage({ email }: { email: string }) {
  const [libraryFilter, setLibraryFilter] = useState<PodcastLibraryFilter>(null)

  return (
    <PodcastPageShell email={email} activeTab="discover" onDiscover={() => setLibraryFilter(null)}>
      <PodcastLibrary email={email} filter={libraryFilter} onFilterChange={setLibraryFilter} />
    </PodcastPageShell>
  )
}
