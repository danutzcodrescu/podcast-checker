import type { ModelMessage } from '@tanstack/ai'
import { z } from 'zod'

import { episodeChatPromptLimit, readEpisodeChatResult } from '#/lib/episode-chat'

const requestInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'tool', 'reasoning']),
        content: z.string().max(40_000).optional(),
      }),
    )
    .min(1)
    .max(80),
  forwardedProps: z
    .object({ locale: z.enum(['en', 'fr']).default('en') })
    .default({ locale: 'en' }),
})

export function parseEpisodeChatRequest(body: unknown) {
  const input = requestInput.parse(body)
  const last = input.messages.at(-1)
  if (
    last?.role !== 'user' ||
    !last.content?.trim() ||
    last.content.length > episodeChatPromptLimit
  ) {
    throw new Error('Invalid chat request')
  }
  const messages: ModelMessage[] = []
  let textLength = 0
  for (const message of input.messages) {
    if (message.role === 'reasoning') continue
    if (message.role === 'tool') {
      // Do not forward old card payloads or client-supplied tool executions to the model.
      // Only descriptive context is retained; all new searches reauthorize current library access.
      const result = readEpisodeChatResult(message.content)
      if (result?.kind === 'results') {
        messages.push({
          role: 'assistant',
          content: JSON.stringify({
            previousSearchCriteria: result.filters,
            episodeTitles: result.episodes.map(({ title, podcast }) => ({
              title,
              podcast: podcast.title,
            })),
          }),
        })
      } else if (result?.kind === 'clarification') {
        messages.push({ role: 'assistant', content: result.message })
      }
      continue
    }
    const content = message.content?.trim()
    if (!content) continue
    textLength += content.length
    if (content.length > episodeChatPromptLimit || textLength > 12_000) {
      throw new Error('Conversation too long')
    }
    messages.push({ role: message.role, content })
  }
  return { messages, locale: input.forwardedProps.locale }
}
