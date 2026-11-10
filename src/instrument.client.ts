import * as Sentry from '@sentry/tanstackstart-react'

import { sentryOptions } from './lib/sentry-options'

const dsn = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    ...sentryOptions,
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
  })
}
