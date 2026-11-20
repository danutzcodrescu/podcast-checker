import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PodcastSyncStatus } from './PodcastSyncStatus'
import { overwriteGetLocale } from '#/paraglide/runtime'

describe('disabled embedding progress', () => {
  it.each([
    ['en', 'Episodes imported · Embeddings disabled'],
    ['fr', 'Épisodes importés · Vectorisation désactivée'],
  ] as const)(
    'shows completed RSS imports in %s without claiming embeddings are running',
    (locale, label) => {
      overwriteGetLocale(() => locale)
      render(
        <PodcastSyncStatus
          sync={{
            status: 'ready',
            embeddingsEnabled: false,
            episodes: 20,
            embedded: 0,
            failed: 3,
            lastSyncedAt: null,
          }}
          hasFeed
          disabled={false}
          onRetry={() => undefined}
        />,
      )
      expect(screen.getByText(label, { exact: false })).toBeVisible()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    },
  )
})
