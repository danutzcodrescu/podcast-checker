// oxlint-disable-next-line import/no-unassigned-import -- Initialize before hydration.
import './instrument.client'

import { captureException } from '@sentry/tanstackstart-react'
import { StartClient } from '@tanstack/react-start/client'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    {
      onRecoverableError: (error) => {
        captureException(error)
      },
    },
  )
})
