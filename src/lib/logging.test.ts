// @vitest-environment node
import { redirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger, getLogger, logger, withLogContext } from './logger'
import { correlationId, withRequestLogging } from './request-logging'
import { withServerFunctionLogging } from './server-function-logging'

let lines: string[]
const entries = () => lines.map((line) => JSON.parse(line))

beforeEach(() => {
  lines = []
  vi.stubEnv('LOG_LEVEL', 'info')
  const captured = createLogger({
    write: (line) => {
      lines.push(line)
    },
  })
  vi.spyOn(logger, 'child').mockImplementation((bindings) => captured.child(bindings))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('structured server logging', () => {
  it('writes JSON with ISO timestamps, named levels, and configurable filtering', () => {
    vi.stubEnv('LOG_LEVEL', 'warn')
    const log = createLogger({
      write: (line) => {
        lines.push(line)
      },
    })
    log.info('not logged')
    log.error({ event: 'example.failed', count: 2 }, 'Something failed')
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'example.failed',
        count: 2,
        service: 'podcast-checker',
        msg: 'Something failed',
        time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      }),
    ])
  })

  it('redacts sensitive fields and does not serialize arbitrary error properties or causes', () => {
    const log = createLogger({
      write: (line) => {
        lines.push(line)
      },
    })
    const err = Object.assign(new Error('Upstream unavailable'), {
      code: 'ECONNRESET',
      headers: { authorization: 'private-credential' },
      body: 'private-body',
      cause: new Error('private-cause'),
    })
    log.error(
      {
        err,
        password: 'private-password',
        credentials: { accessToken: 'private-token' },
        headers: { cookie: 'private-cookie' },
        body: 'private-input',
        query: 'private-query',
      },
      'Failed',
    )
    expect(lines.join('')).not.toContain('private-')
    expect(entries()[0].err).toEqual({
      type: 'Error',
      message: 'Upstream unavailable',
      stack: expect.any(String),
      code: 'ECONNRESET',
    })
    expect(entries()[0].password).toBe('[REDACTED]')
  })

  it('omits SQL and validation input from error messages and multiline stacks', () => {
    const log = createLogger({
      write: (line) => {
        lines.push(line)
      },
    })
    const err = Object.assign(new Error('Failed query:\nparams: private-input'), {
      query: 'private-query',
      params: ['private-input'],
    })
    log.error({ err }, 'Query failed')
    const validation = new Error('Invalid input: private-value')
    validation.name = 'ZodError'
    log.warn({ err: validation }, 'Validation failed')
    log.error({ err: { body: 'private-body' } }, 'Non-error thrown')
    expect(lines.join('')).not.toContain('private-')
    expect(entries()[0].err.message).toBe('Database query failed')
    expect(entries()[1].err.message).toBe('Input validation failed')
    expect(entries()[2].err).toEqual({ type: 'UnknownError' })
  })

  it('isolates concurrent requests, inherits nested context, and exposes request IDs', async () => {
    const responses = await Promise.all(
      ['one', 'two'].map((name) =>
        withRequestLogging(
          new Request(`https://example.com/${name}`, {
            headers: { 'x-correlation-id': `trace-${name}` },
          }),
          async () => {
            await Promise.resolve()
            await withLogContext({ feedId: name }, async () => {
              await Promise.resolve()
              getLogger().info({ event: 'nested' }, 'Nested operation')
            })
            return new Response(name)
          },
        ),
      ),
    )
    const nested = entries().filter((entry) => entry.event === 'nested')
    expect(nested).toHaveLength(2)
    const bodies = await Promise.all(responses.map((response) => response.text()))
    for (const [index, name] of ['one', 'two'].entries()) {
      const entry = nested.find((item) => item.feedId === name)
      expect(entry).toMatchObject({ pathname: `/${name}`, correlationId: `trace-${name}` })
      expect(responses[index].headers.get('x-request-id')).toBe(entry.requestId)
      expect(bodies[index]).toBe(name)
    }
    expect(nested[0].requestId).not.toBe(nested[1].requestId)
    expect(
      entries()
        .filter((entry) => entry.event === 'request.completed')
        .every((entry) => entry.feedId === undefined),
    ).toBe(true)
    expect(getLogger()).toBe(logger)
  })

  it('logs safe HTTP metadata and classifies error statuses without logging inputs', async () => {
    await Promise.all(
      [200, 401, 503].map((status) =>
        withRequestLogging(
          new Request('https://example.com/api/test?token=private-query', {
            method: 'POST',
            headers: { Authorization: 'Bearer private-token' },
            body: 'private-body',
          }),
          () => new Response('private-response', { status }),
        ),
      ),
    )
    expect(lines.join('')).not.toContain('private-')
    expect(entries().map((entry) => entry.level)).toEqual(['info', 'warn', 'error'])
    expect(entries()[0]).toMatchObject({
      pathname: '/api/test',
      method: 'POST',
      status: 200,
      durationMs: expect.any(Number),
    })
  })

  it('preserves redirect responses with immutable headers', async () => {
    const response = await withRequestLogging(new Request('https://example.com'), () =>
      Response.redirect('https://example.com/signin'),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/signin')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('logs thrown failures and rethrows the same error', async () => {
    const err = new Error('Handler failed')
    await expect(
      withRequestLogging(new Request('https://example.com'), () => {
        throw err
      }),
    ).rejects.toBe(err)
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'request.failed',
        err: expect.objectContaining({ message: 'Handler failed' }),
      }),
    ])
  })

  it('supports background handlers with no response and includes invocation metadata', async () => {
    await withRequestLogging(new Request('https://example.com'), async () => {}, {
      functionName: 'background',
      invocationId: 'invocation-1',
    })
    expect(entries()[0]).toMatchObject({
      functionName: 'background',
      invocationId: 'invocation-1',
      event: 'request.completed',
    })
    expect(entries()[0].status).toBeUndefined()
  })

  it('accepts only bounded correlation IDs and generates a fallback', async () => {
    await Promise.all(
      ['a'.repeat(129), 'private data', 'bad"id'].map(async (value) => {
        const request = new Request('https://example.com', {
          headers: { 'x-correlation-id': value },
        })
        expect(correlationId(request)).toBeUndefined()
        await withRequestLogging(request, () => new Response())
      }),
    )
    expect(entries().every((entry) => entry.correlationId === entry.requestId)).toBe(true)
  })
})

describe('server-function logging', () => {
  const meta = { id: 'function-id', name: 'searchPodcasts' }

  it('inherits request context and preserves results', async () => {
    await withRequestLogging(new Request('https://example.com/rpc'), async () => {
      expect(await withServerFunctionLogging(meta, async () => ({ count: 3 }))).toEqual({
        count: 3,
      })
      return new Response()
    })
    expect(entries()[0]).toMatchObject({
      event: 'server_function.completed',
      serverFunction: meta.name,
      serverFunctionId: meta.id,
      requestId: entries()[1].requestId,
    })
  })

  it('logs RPC failures independently of HTTP status and preserves thrown errors', async () => {
    const err = new Error('Provider unavailable')
    await expect(
      withServerFunctionLogging(meta, async () => {
        throw err
      }),
    ).rejects.toBe(err)
    expect(entries()[0]).toMatchObject({
      event: 'server_function.failed',
      level: 'error',
      err: { message: 'Provider unavailable' },
    })
  })

  it('treats redirects as normal control flow and validation errors as warnings', async () => {
    const navigation = redirect({ to: '/signin' })
    await expect(
      withServerFunctionLogging(meta, async () => {
        throw navigation
      }),
    ).rejects.toBe(navigation)
    const validation = new Error('private-input')
    validation.name = 'ZodError'
    await expect(
      withServerFunctionLogging(meta, async () => {
        throw validation
      }),
    ).rejects.toBe(validation)
    expect(entries()[0]).toMatchObject({ level: 'info', event: 'server_function.short_circuited' })
    expect(entries()[0].err).toBeUndefined()
    expect(entries()[1]).toMatchObject({ level: 'warn', event: 'server_function.failed' })
    expect(lines.join('')).not.toContain('private-input')
  })
})
