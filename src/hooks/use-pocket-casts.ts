import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { addEpisodeToPocketCasts, getPocketCastsConnection } from '#/lib/pocket-casts'
import type { PocketCastsResult } from '#/lib/pocket-casts'
import { PocketCastsError } from '#/lib/pocket-casts-api'

export function unwrapPocketCasts<T>(result: PocketCastsResult<T>): T {
  if (!result.ok) throw new PocketCastsError(result.error)
  return result.data
}

export function usePocketCasts(email: string) {
  const client = useQueryClient()
  const queryKey = ['pocket-casts', email]
  const connection = useQuery({
    queryKey,
    queryFn: async () => unwrapPocketCasts(await getPocketCastsConnection()),
    retry: false,
  })
  const queue = useMutation({
    mutationFn: async (episodeId: string) =>
      unwrapPocketCasts(await addEpisodeToPocketCasts({ data: { episodeId } })),
    retry: false,
    onError: (error) => {
      if (error instanceof PocketCastsError && ['auth', 'not_connected'].includes(error.code)) {
        client.setQueryData(queryKey, null)
      }
    },
  })
  return { connection, queue, queryKey }
}

export type PocketCastsIntegration = ReturnType<typeof usePocketCasts>
