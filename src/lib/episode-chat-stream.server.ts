import { EventType, toServerSentEventsResponse } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'

import { runWithAbort } from '#/lib/abort'
import { episodeChatTimeoutCode } from '#/lib/episode-chat'
import type { EpisodeChatDiagnostics } from '#/lib/episode-chat-diagnostics.server'
import { m } from '#/paraglide/messages'

export const episodeChatTimeoutMs = 45_000

/** Work deadlines must not abort the encoder before it can deliver the timeout error. */
export function createEpisodeChatRun(
  requestSignal: AbortSignal,
  locale: 'en' | 'fr',
  diagnostics: EpisodeChatDiagnostics,
) {
  const controller = new AbortController()
  const delivery = new AbortController()
  const timeout = setTimeout(() => {
    diagnostics.fail('deadline_exceeded')
    controller.abort(new DOMException('Chat deadline exceeded', 'TimeoutError'))
  }, episodeChatTimeoutMs)
  const onDisconnect = () => delivery.abort()
  const onDeliveryCancelled = () => {
    diagnostics.cancel()
    controller.abort()
  }
  delivery.signal.addEventListener('abort', onDeliveryCancelled, { once: true })
  requestSignal.addEventListener('abort', onDisconnect, { once: true })
  if (requestSignal.aborted) onDisconnect()

  function dispose() {
    clearTimeout(timeout)
    requestSignal.removeEventListener('abort', onDisconnect)
    delivery.signal.removeEventListener('abort', onDeliveryCancelled)
    controller.abort()
  }

  function timedOut() {
    return (
      controller.signal.reason instanceof DOMException &&
      controller.signal.reason.name === 'TimeoutError'
    )
  }

  function respond(source: AsyncIterable<StreamChunk>) {
    async function* forward(): AsyncGenerator<StreamChunk> {
      const iterator = source[Symbol.asyncIterator]()
      try {
        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- Preserve event ordering while allowing the deadline to interrupt a pending pull.
          const next = await runWithAbort(controller.signal, () => iterator.next())
          if (next.done) {
            diagnostics.complete()
            return
          }
          yield next.value
          if (next.value.type === 'RUN_ERROR') return
        }
      } catch (error) {
        if (!delivery.signal.aborted) {
          diagnostics.fail(timedOut() ? 'deadline_exceeded' : 'stream_error', error)
          yield {
            type: EventType.RUN_ERROR,
            code: timedOut() ? episodeChatTimeoutCode : 'CHAT_UNAVAILABLE',
            message: timedOut() ? m.chat_timeout({}, { locale }) : m.chat_error({}, { locale }),
          }
        }
      } finally {
        dispose()
        // An uncooperative generator may still have a pending pull. Do not let return()
        // delay the terminal error; observe its eventual rejection without logging payloads.
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      }
    }
    return toServerSentEventsResponse(forward(), {
      abortController: delivery,
      headers: { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    })
  }

  return { controller, signal: controller.signal, timedOut, respond, dispose }
}
