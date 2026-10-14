import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHydrated } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

import type { Podcast } from '#/lib/apple-podcasts'
import {
  createPodcastCategory,
  getPodcastLibrary,
  saveFollowedPodcast,
  unfollowPodcast,
} from '#/lib/podcast-library'
import type { PodcastLibrary } from '#/lib/podcast-library'

type Operation =
  | { type: 'save'; podcast: Podcast; categories: string[] }
  | { type: 'unfollow'; id: number }
  | { type: 'category'; name: string }

export type LibraryPodcast = {
  podcast: Podcast
  categoryIds: string[]
  categoryNames: string[]
  searchFields: string[]
}

const emptyLibrary: PodcastLibrary = { podcasts: [], categories: [] }
const emptyCategories: string[] = []

export function usePodcastLibrary(email: string) {
  const hydrated = useHydrated()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['podcast-library', email], [email])
  const {
    data = emptyLibrary,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => getPodcastLibrary(),
    enabled: hydrated,
    retry: false,
  })
  const {
    mutateAsync,
    isPending: isSaving,
    isError: isSaveError,
  } = useMutation({
    mutationFn: (operation: Operation) => {
      if (operation.type === 'save')
        return saveFollowedPodcast({
          data: { podcast: operation.podcast, categories: operation.categories },
        })
      if (operation.type === 'unfollow') return unfollowPodcast({ data: operation.id })
      return createPodcastCategory({ data: operation.name })
    },
    onSuccess: async (library) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData(queryKey, library)
    },
  })

  const indexes = useMemo(() => {
    const categories = data.categories.map((category) => ({ ...category, count: 0 }))
    const categoryById = new Map(categories.map((category) => [category.id, category]))
    const podcasts: LibraryPodcast[] = data.podcasts.map(({ podcast, categories: categoryIds }) => {
      const categoryNames: string[] = []
      for (const id of new Set(categoryIds)) {
        const category = categoryById.get(id)
        if (category) {
          category.count += 1
          categoryNames.push(category.name)
        }
      }
      return {
        podcast,
        categoryIds,
        categoryNames,
        searchFields: [podcast.title, podcast.publisher, ...categoryNames].map((value) =>
          value.toLowerCase(),
        ),
      }
    })
    const podcastById = new Map(podcasts.map((item) => [item.podcast.id, item]))
    return { podcasts, categories, categoryById, podcastById }
  }, [data])

  const run = useCallback(
    async (operation: Operation) => {
      if (isSaving) return false
      try {
        await mutateAsync(operation)
        return true
      } catch {
        return false
      }
    },
    [isSaving, mutateAsync],
  )

  const savePodcast = useCallback(
    (podcast: Podcast, categories: string[]) => run({ type: 'save', podcast, categories }),
    [run],
  )
  const unfollow = useCallback((id: number) => run({ type: 'unfollow', id }), [run])
  const createCategory = useCallback((name: string) => run({ type: 'category', name }), [run])
  const getCategories = useCallback(
    (podcast: Podcast) => indexes.podcastById.get(podcast.id)?.categoryNames ?? emptyCategories,
    [indexes],
  )
  const isFollowed = useCallback(
    (podcast: Podcast) => indexes.podcastById.has(podcast.id),
    [indexes],
  )
  const getCategoryName = useCallback((id: string) => indexes.categoryById.get(id)?.name, [indexes])

  return {
    podcasts: indexes.podcasts,
    categories: indexes.categories,
    isPending,
    isError,
    isSaving,
    isSaveError,
    disabled: isPending || isError || !hydrated,
    refetch,
    savePodcast,
    unfollow,
    createCategory,
    getCategories,
    isFollowed,
    getCategoryName,
  }
}

export type PodcastLibraryState = ReturnType<typeof usePodcastLibrary>
