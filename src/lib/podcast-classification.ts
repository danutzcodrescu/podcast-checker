import { z } from 'zod'

import { podcastClassificationInstructions, podcastClassifiers } from './podcast-classifiers'

const choiceSchema = z.enum([...podcastClassifiers.map(({ id }) => id), 'none'])
const decisionSchema = z.object({
  answers: z.object({
    category: z.object({
      type: z.literal('choice'),
      choice: choiceSchema,
      probabilities: z.record(choiceSchema, z.number().min(0).max(1)).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  }),
})

type PodcastClassificationInput = {
  title: string
  description: string
  publisher?: string | null
  language?: string | null
  categories?: string[]
}

export async function classifyPodcast(podcast: PodcastClassificationInput, signal?: AbortSignal) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(15_000)
  // Jev is a decision model, not a chat model. Use its dedicated API directly;
  // TanStack AI's OpenAI-compatible chat adapter cannot send Decisions requests.
  const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      model: process.env.PODCAST_CLASSIFICATION_MODEL || '~typesafe/jev-latest',
      state: {
        title: podcast.title.slice(0, 500),
        description: podcast.description.slice(0, 12_000),
        publisher: podcast.publisher?.slice(0, 500) ?? null,
        language: podcast.language?.slice(0, 100) ?? null,
        categories: (podcast.categories ?? [])
          .slice(0, 20)
          .map((category) => category.slice(0, 200)),
      },
      questions: {
        category: {
          type: 'choice',
          instructions: podcastClassificationInstructions,
          criteria: {
            ...Object.fromEntries(podcastClassifiers.map(({ id, ...criteria }) => [id, criteria])),
            none: 'None of the categories fits, the metadata is insufficient, or there is no clear primary category.',
          },
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`OpenRouter decision request failed (HTTP ${response.status})`)
  // Do not include raw provider responses or podcast metadata in logged errors.
  const result = decisionSchema.safeParse(await response.json().catch(() => undefined))
  if (!result.success) throw new Error('OpenRouter returned an invalid podcast decision')
  const { choice } = result.data.answers.category
  return choice === 'none' ? null : choice
}
