import { EventType } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'

import type { EpisodeChatDecision, EpisodeChatResults } from '#/lib/episode-chat'
import { episodeChatToolName } from '#/lib/episode-chat'

export const chatPodcast = {
  id: 123,
  title: 'The History Show',
  publisher: 'History publisher',
  appleUrl: 'https://podcasts.apple.com/podcast/id123',
  feedUrl: null,
  artworkUrl: null,
}

export const chatLibrary = {
  podcasts: [{ podcast: chatPodcast, categories: ['history'] }],
  categories: [{ id: 'history', name: 'History' }],
}

export const chatDecision: EpisodeChatDecision = {
  action: 'search',
  clarification: '',
  unsupportedConstraints: [],
  filters: {
    term: 'Roman history',
    podcastId: null,
    categoryId: null,
    days: null,
    sort: 'relevance',
    searchMode: 'hybrid',
  },
}

export function chatResults(count = 6): EpisodeChatResults {
  return {
    kind: 'results',
    filters: { ...chatDecision.filters },
    total: 25,
    semanticUnavailable: false,
    ranking: 'baseline',
    episodes: Array.from({ length: count }, (_, index) => ({
      id: `episode-${index}`,
      title: `Roman history ${index + 1}`,
      description: 'An exploration of Roman Britain and its history.',
      publishedAt: '2026-10-20T09:00:00.000Z',
      durationSeconds: 3600,
      artworkUrl: null,
      podcast: chatPodcast,
      categories: ['history'],
      matchType: 'text',
    })),
  }
}

export async function* chatResultChunks(result: unknown): AsyncGenerator<StreamChunk> {
  yield { type: EventType.RUN_STARTED, runId: 'run', threadId: 'thread' }
  yield {
    type: 'TOOL_CALL_START',
    toolCallId: 'call',
    toolCallName: episodeChatToolName,
    parentMessageId: 'assistant',
  }
  yield { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call', delta: JSON.stringify(chatDecision) }
  yield { type: 'TOOL_CALL_END', toolCallId: 'call' }
  yield {
    type: EventType.TOOL_CALL_RESULT,
    messageId: 'result',
    toolCallId: 'call',
    content: JSON.stringify(result),
    role: 'tool',
  }
  yield { type: EventType.RUN_FINISHED, runId: 'run', threadId: 'thread' }
}
