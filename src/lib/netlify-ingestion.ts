import { createHash, timingSafeEqual } from 'node:crypto'

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

export async function dispatchNetlifyIngestion() {
  // Never derive the destination from an incoming Host header or user input.
  if (!process.env.URL) throw new Error('Netlify URL must be set')
  const destination = new URL('/.netlify/functions/podcast-ingest-background', process.env.URL)
  if (destination.protocol !== 'https:') throw new Error('Netlify URL must use HTTPS')
  const response = await fetch(destination, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ingestionSecret()}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status !== 202)
    throw new Error(`Ingestion dispatch failed (HTTP ${response.status})`)
}
