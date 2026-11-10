import * as Sentry from '@sentry/tanstackstart-react'
import { config } from 'dotenv'

import { sentryOptions } from './lib/sentry-options'

config({ path: ['.env.local', '.env'], quiet: true })

if (process.env.SENTRY_DSN) {
  Sentry.init({
    ...sentryOptions,
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.CONTEXT || process.env.NODE_ENV,
  })
}
