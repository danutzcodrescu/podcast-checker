import { createHash, timingSafeEqual } from 'node:crypto'
import { getLogger } from './logger'

export function localIngestionContext() {
  // The Vite emulator sets CONTEXT=dev but leaves context.deploy.context empty.
  return process.env.CONTEXT === 'dev'
}

function ingestionSecret() {
  const secret = process.env.INGESTION_SECRET
  if (!secret || secret.length < 32)
    throw new Error('INGESTION_SECRET must be at least 32 characters')
  return secret
}

export function authorizedIngestionRequest(request: Request) {
  const expected = createHash('sha256').update(`Bearer ${ingestionSecret()}`).digest()
  const received = createHash('sha256')
    .update(request.headers.get('authorization') ?? '')
    .digest()
  return timingSafeEqual(expected, received)
}

export async function dispatchNetlifyIngestion(local = false) {
  // Never derive the destination from an incoming Host header or user input.
  const origin = local ? process.env.BETTER_AUTH_URL : process.env.URL
  if (!origin) throw new Error(local ? 'BETTER_AUTH_URL must be set' : 'Netlify URL must be set')
  const destination = new URL('/.netlify/functions/podcast-ingest-background', origin)
  if (local) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname))
      throw new Error('Local ingestion URL must use a loopback host')
  }
  if (destination.protocol !== 'https:' && !(local && destination.protocol === 'http:'))
    throw new Error('Netlify URL must use HTTPS')
  const response = await fetch(destination, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ingestionSecret()}`,
      ...(getLogger().bindings().correlationId
        ? { 'x-correlation-id': getLogger().bindings().correlationId }
        : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== 202)
    throw new Error(`Ingestion dispatch failed (HTTP ${response.status})`)
}
