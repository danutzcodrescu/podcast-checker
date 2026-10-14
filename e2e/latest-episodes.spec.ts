import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { inArray } from 'drizzle-orm'

import { db } from '../src/db/index'
import { user as users } from '../src/db/auth-schema'
import { podcastEpisode, podcastFeed } from '../src/db/ingestion-schema'
import { followedPodcast, podcastCategory } from '../src/db/library-schema'

test.afterAll(async () => {
  await db.$client.end()
})

function episode(feedId: string, title: string, publishedAt: Date | null) {
  return {
    feedId,
    key: title,
    title,
    embeddingTitle: title,
    description: 'Episode description',
    cleanedDescription: 'Episode description',
    publishedAt,
    durationSeconds: 3240,
  }
}

test('chooses the login landing page and displays only followed episodes with working filters and pagination', async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `episodes-${randomUUID()}@example.com`
  const password = 'test-password-123'
  const userIds: string[] = []
  const feedIds: string[] = []
  const otherContext = await browser.newContext({ baseURL })
  try {
    await Promise.all(
      [page.request, otherContext.request].map(async (request, index) => {
        const response = await request.post('/api/auth/sign-up/email', {
          data: {
            email: index === 0 ? email : `private-${randomUUID()}@example.com`,
            name: 'Episodes test',
            password,
          },
        })
        expect(response.ok()).toBe(true)
        const { user } = await response.json()
        userIds[index] = user.id
      }),
    )
    await page.goto('/')
    await expect(page).toHaveURL('/discover')
    await page.getByRole('link', { name: 'Latest episodes', exact: true }).click()
    await expect(page).toHaveURL('/latest-episodes')
    await expect(page.getByRole('heading', { name: 'No episodes yet' })).toBeVisible()
    await expect(
      page.getByText('Follow a podcast from search results to add it to your library.').last(),
    ).toBeVisible()

    const feeds = await db
      .insert(podcastFeed)
      .values(
        ['development', 'history', 'private'].map((name) => ({
          url: `https://example.com/${name}-${randomUUID()}.xml`,
          status: 'ready' as const,
        })),
      )
      .returning()
    feedIds.push(...feeds.map((feed) => feed.id))
    const podcasts = feeds.map((feed, index) => ({
      id: index + 100,
      title: ['Development show', 'History show', 'Private show'][index],
      publisher: 'Test publisher',
      appleUrl: `https://podcasts.apple.com/podcast/id${index + 100}`,
      feedUrl: feed.url,
      artworkUrl: null,
    }))
    await db.insert(podcastCategory).values([
      { userId: userIds[0], id: 'development', name: 'Development' },
      { userId: userIds[0], id: 'history', name: 'History' },
    ])
    await db.insert(followedPodcast).values(
      podcasts.map((podcast, index) => ({
        userId: userIds[index === 2 ? 1 : 0],
        podcastId: podcast.id,
        podcast,
        feedId: feeds[index].id,
        categories: index === 0 ? ['development'] : ['history'],
      })),
    )
    // An alternate catalog entry for the same RSS feed must not duplicate episodes.
    await db.insert(followedPodcast).values({
      userId: userIds[0],
      podcastId: 200,
      podcast: { ...podcasts[0], id: 200, title: 'Development alias' },
      feedId: feeds[0].id,
      categories: ['development'],
    })
    const now = Date.now()
    await db
      .insert(podcastEpisode)
      .values([
        ...Array.from({ length: 26 }, (_, index) =>
          episode(
            feeds[0].id,
            `Development episode ${String(index + 1).padStart(2, '0')}`,
            new Date(now - index * 1000),
          ),
        ),
        episode(feeds[1].id, 'History today', new Date(now - 60_000)),
        episode(feeds[1].id, 'History yesterday', new Date(now - 86_400_000)),
        episode(feeds[0].id, 'Older development episode', new Date(now - 10 * 86_400_000)),
        episode(feeds[1].id, 'Undated history', null),
        episode(feeds[2].id, 'Private episode', new Date(now)),
      ])

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/signin')
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL('/latest-episodes')
    await expect(page.getByRole('link', { name: 'Latest episodes', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByText('28 episodes', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Development episode 01', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'History yesterday', exact: true })).toHaveCount(
      0,
    )
    await page.getByRole('button', { name: 'Load more episodes' }).click()
    await expect(
      page.getByRole('heading', { name: 'History yesterday', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load more episodes' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Yesterday', exact: true })).toBeVisible()
    await expect(page.getByText('54 min').first()).toBeVisible()

    await page.getByRole('combobox', { name: 'Filter episodes by podcast' }).selectOption('101')
    await expect(page.getByText('2 episodes', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Development episode 01', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Filter episodes by tag' }).selectOption('development')
    await expect(page.getByRole('heading', { name: 'No episodes yet' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Filter episodes by podcast' }).selectOption('')
    await expect(page.getByText('26 episodes', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Filter episodes by tag' }).selectOption('')
    await page.getByRole('combobox', { name: 'Filter episodes by date' }).selectOption('')
    await expect(page.getByText('30 episodes', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Sort episodes' }).selectOption('oldest')
    await expect(
      page.getByRole('heading', { name: 'Older development episode', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Load more episodes' }).click()
    await expect(page.getByRole('heading', { name: 'Unknown date', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Undated history', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Private episode', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Private show', exact: true })).toHaveCount(0)

    const sidebar = page.getByRole('complementary')
    await sidebar.getByRole('button', { name: 'History 1', exact: true }).click()
    await expect(page.getByText('3 episodes', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter episodes by tag' })).toHaveValue(
      'history',
    )
    await sidebar.getByRole('searchbox').fill('development')
    await expect(
      sidebar.getByRole('button', { name: 'History show History', exact: true }),
    ).toHaveCount(0)
    await sidebar.getByRole('searchbox').fill('')
    await sidebar.getByRole('button', { name: 'Followed podcasts 3', exact: true }).click()
    await expect(page.getByText('30 episodes', { exact: true })).toBeVisible()

    await page.getByRole('combobox', { name: 'Sort episodes' }).selectOption('newest')
    await expect(page.getByText('30 episodes', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh episodes' })).toBeEnabled()
    await db
      .insert(podcastEpisode)
      .values(episode(feeds[1].id, 'Newly imported episode', new Date()))
    await page.getByRole('button', { name: 'Refresh episodes' }).click()
    await expect(page.getByText('31 episodes', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Newly imported episode', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitemradio', { name: 'Français' }).click()
    await expect(page).toHaveURL('/fr/latest-episodes')
    await expect(
      page.getByRole('heading', { name: 'Derniers épisodes', exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Découvrir', exact: true }).click()
    await expect(page).toHaveURL('/fr/discover')
    await page.goto('/fr/')
    await expect(page).toHaveURL('/fr/latest-episodes')
  } finally {
    await otherContext.close()
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    if (feedIds.length) await db.delete(podcastFeed).where(inArray(podcastFeed.id, feedIds))
  }
})
