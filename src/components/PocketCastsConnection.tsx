import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/Button'
import { Input } from '#/components/ui/Input'
import { unwrapPocketCasts } from '#/hooks/use-pocket-casts'
import type { PocketCastsIntegration } from '#/hooks/use-pocket-casts'
import { connectPocketCasts, disconnectPocketCasts } from '#/lib/pocket-casts'
import { PocketCastsError } from '#/lib/pocket-casts-api'
import { m } from '#/paraglide/messages'

export function pocketCastsErrorMessage(error: unknown) {
  if (error instanceof PocketCastsError) {
    switch (error.code) {
      case 'auth':
        return m.pocket_casts_auth_error()
      case 'not_connected':
        return m.pocket_casts_connect_hint()
      case 'not_found':
        return m.pocket_casts_not_found()
      case 'configuration':
        return m.pocket_casts_configuration_error()
    }
  }
  return m.pocket_casts_error()
}

export function PocketCastsConnection({ integration }: { integration: PocketCastsIntegration }) {
  const client = useQueryClient()
  const { connection, queryKey, queue } = integration
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  return (
    <div className="mb-5 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 wrap-anywhere">
          <h2 className="font-bold">Pocket Casts</h2>
          <p
            className={`mt-1 text-xs text-muted-foreground ${connection.data ? 'truncate' : 'leading-relaxed'}`}
            title={
              connection.data
                ? m.pocket_casts_connected({ email: connection.data.email })
                : undefined
            }
          >
            {connection.isPending
              ? m.pocket_casts_loading()
              : connection.data
                ? m.pocket_casts_connected({ email: connection.data.email })
                : m.pocket_casts_connect_hint()}
          </p>
        </div>
        {connection.data ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending || queue.isPending}
            onClick={async () => {
              setPending(true)
              setError(null)
              try {
                unwrapPocketCasts(await disconnectPocketCasts())
                client.setQueryData(queryKey, null)
                queue.reset()
              } catch (cause) {
                setError(cause)
              } finally {
                setPending(false)
              }
            }}
          >
            {m.pocket_casts_disconnect()}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={connection.isPending || pending}
            aria-expanded={open}
            aria-controls="pocket-casts-connect-form"
            onClick={() => {
              setOpen(!open)
              setError(null)
              setPassword('')
            }}
          >
            {m.pocket_casts_connect()}
          </Button>
        )}
      </div>
      {connection.isError && (
        <div className="mt-3" role="alert">
          <p className="text-sm text-destructive">{m.pocket_casts_error()}</p>
          <Button variant="ghost" size="sm" onClick={() => void connection.refetch()}>
            {m.search_retry()}
          </Button>
        </div>
      )}
      {!connection.data && open && (
        <form
          id="pocket-casts-connect-form"
          className="mt-4 grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (pending) return
            setPending(true)
            setError(null)
            try {
              // Credentials are exchanged directly, never retained in Query's
              // mutation cache or browser storage.
              const connected = unwrapPocketCasts(
                await connectPocketCasts({ data: { email: email.trim(), password } }),
              )
              client.setQueryData(queryKey, connected)
              queue.reset()
              setOpen(false)
            } catch (cause) {
              setError(cause)
            } finally {
              setPassword('')
              setPending(false)
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{m.pocket_casts_credentials_hint()}</p>
          <div className="grid grid-cols-2 gap-3 mobile:grid-cols-1">
            <label className="grid gap-1 text-sm">
              {m.pocket_casts_email()}
              <Input
                type="email"
                autoComplete="username"
                required
                maxLength={320}
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {m.pocket_casts_password()}
              <Input
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </div>
          <Button type="submit" size="sm" className="justify-self-start" disabled={pending}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? m.pocket_casts_connecting() : m.pocket_casts_connect()}
          </Button>
        </form>
      )}
      {error !== null && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {pocketCastsErrorMessage(error)}
        </p>
      )}
    </div>
  )
}
