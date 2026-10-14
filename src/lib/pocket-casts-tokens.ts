import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

import { PocketCastsError } from './pocket-casts-api'
import type { PocketCastsTokens } from './pocket-casts-api'

function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new PocketCastsError('configuration')
  return createHash('sha256').update(`pocket-casts-tokens:${secret}`).digest()
}

export function encryptPocketCastsTokens(userId: string, tokens: PocketCastsTokens) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(userId))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptPocketCastsTokens(userId: string, encrypted: string): PocketCastsTokens {
  const key = encryptionKey()
  try {
    const bytes = Buffer.from(encrypted, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    decipher.setAAD(Buffer.from(userId))
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
    return z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        expiresAt: z.number(),
      })
      .parse(JSON.parse(plaintext.toString('utf8')))
  } catch {
    throw new PocketCastsError('auth')
  }
}
