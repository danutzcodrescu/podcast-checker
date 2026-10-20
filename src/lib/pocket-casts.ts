import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAuth } from '#/lib/auth-middleware'
import { PocketCastsError } from './pocket-casts-api'
import type { PocketCastsErrorCode } from './pocket-casts-api'
import {
  connectPocketCastsAccount,
  disconnectPocketCastsAccount,
  queuePocketCastsEpisode,
  readPocketCastsConnection,
} from './pocket-casts-service'

export type PocketCastsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PocketCastsErrorCode }

async function result<T>(action: () => Promise<T>): Promise<PocketCastsResult<T>> {
  try {
    return { ok: true, data: await action() }
  } catch (cause) {
    const { getLogger } = await import('./logger')
    getLogger().warn(
      {
        event: 'pocket_casts.failed',
        errorCode: cause instanceof PocketCastsError ? cause.code : 'unavailable',
      },
      'Pocket Casts operation failed',
    )
    // Never serialize upstream response bodies, credentials, or database errors.
    return { ok: false, error: cause instanceof PocketCastsError ? cause.code : 'unavailable' }
  }
}

export const getPocketCastsConnection = createServerFn({ method: 'GET' })
  .middleware([requireAuth])
  .handler(({ context }) => result(() => readPocketCastsConnection(context.session.user.id)))

export const connectPocketCasts = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(z.object({ email: z.email().max(320), password: z.string().min(1).max(1024) }))
  .handler(({ context, data }) =>
    result(() => connectPocketCastsAccount(context.session.user.id, data.email, data.password)),
  )

export const disconnectPocketCasts = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .handler(({ context }) => result(() => disconnectPocketCastsAccount(context.session.user.id)))

export const addEpisodeToPocketCasts = createServerFn({ method: 'POST' })
  .middleware([requireAuth])
  .validator(z.object({ episodeId: z.uuid() }))
  .handler(({ context, data }) =>
    result(() => queuePocketCastsEpisode(context.session.user.id, data.episodeId)),
  )
