// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEpisodeChatDiagnostics } from './episode-chat-diagnostics.server'
import { createEpisodeChatRun, episodeChatTimeoutMs } from './episode-chat-stream.server'
import { createLogger, logger } from './logger'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const captured = createLogger({ write() {} })
  vi.spyOn(logger, 'child').mockImplementation((bindings) => captured.child(bindings))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('chat transport cancellation', () => {
  it.each(['deadline', 'disconnect', 'provider'] as const)(
    'aborts the transport on %s even with an independent provider signal',
    async (cause) => {
      const browser = new AbortController()
      const provider = new AbortController()
      const run = createEpisodeChatRun(browser.signal, 'en', createEpisodeChatDiagnostics('test'))
      let transportSignal: AbortSignal | null | undefined
      const transport = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            transportSignal = init?.signal
            transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
              once: true,
            })
          }),
      )
      try {
        const outcome = run
          .wrapFetch(transport)('https://example.com/chat', { signal: provider.signal })
          .catch((error: unknown) => error)
        expect(transportSignal?.aborted).toBe(false)
        if (cause === 'deadline') await vi.advanceTimersByTimeAsync(episodeChatTimeoutMs)
        else if (cause === 'disconnect') browser.abort()
        else provider.abort()
        expect(transportSignal?.aborted).toBe(true)
        expect(await outcome).toBe(transportSignal?.reason)
        expect(provider.signal.aborted).toBe(cause === 'provider')
      } finally {
        run.dispose()
      }
    },
  )

  it('does not start a late provider request after the run has already timed out', async () => {
    const run = createEpisodeChatRun(
      new AbortController().signal,
      'en',
      createEpisodeChatDiagnostics('test'),
    )
    const transport = vi.fn<typeof fetch>()
    try {
      await vi.advanceTimersByTimeAsync(episodeChatTimeoutMs)
      await expect(run.wrapFetch(transport)('https://example.com/chat')).rejects.toMatchObject({
        name: 'TimeoutError',
      })
      expect(transport).not.toHaveBeenCalled()
    } finally {
      run.dispose()
    }
  })

  it('preserves the provider request and response while adding run cancellation', async () => {
    const run = createEpisodeChatRun(
      new AbortController().signal,
      'en',
      createEpisodeChatDiagnostics('test'),
    )
    const response = new Response('data: test\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response)
    const request = new Request('https://example.com/chat', {
      method: 'POST',
      headers: { 'x-test-trace': 'trace' },
      body: 'request body',
    })
    try {
      expect(await run.wrapFetch(transport)(request)).toBe(response)
      const forwarded = new Request(...transport.mock.calls[0])
      expect(forwarded.method).toBe('POST')
      expect(forwarded.headers.get('x-test-trace')).toBe('trace')
      expect(await forwarded.text()).toBe('request body')
    } finally {
      run.dispose()
    }
  })
})
