import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'

import { db } from '../src/db/index'
import { user as users } from '../src/db/auth-schema'
import { followedPodcast, podcastCategory } from '../src/db/library-schema'
import { podcastFeed } from '../src/db/ingestion-schema'

test.afterAll(async () => {
  await db.$client.end()
})

test('persists category edits and unfollowing, with account-isolated libraries and responsive controls', async ({
  page,
  browser,
  baseURL,
}) => {
  const userIds: string[] = []
  const feedUrl = `https://example.com/library-${randomUUID()}.xml`
  const otherContext = await browser.newContext({ baseURL })
  const podcast = {
    id: 123,
    title: 'Library test podcast',
    publisher: 'Test publisher',
    appleUrl: 'https://podcasts.apple.com/podcast/id123',
    feedUrl,
    artworkUrl: null,
  }
  try {
    await Promise.all(
      [page.request, otherContext.request].map(async (request, index) => {
        const response = await request.post('/api/auth/sign-up/email', {
          data: {
            email: `library-${randomUUID()}@example.com`,
            name: 'Library test',
            password: 'test-password-123',
          },
        })
        expect(response.ok()).toBe(true)
        const { user } = await response.json()
        userIds[index] = user.id
        await db
          .insert(followedPodcast)
          .values({ userId: user.id, podcastId: podcast.id, podcast, categories: [] })
      }),
    )
    await db
      .insert(podcastCategory)
      .values({ userId: userIds[1], id: 'private', name: 'Private category' })

    await page.goto('/')
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByRole('button', { name: 'Followed podcasts 1' })).toBeVisible()
    await expect(sidebar.getByText('Private category')).toHaveCount(0)
    await sidebar.getByRole('button', { name: 'Followed podcasts 1' }).click()
    const results = page.getByRole('list', { name: 'Followed podcast results' })
    await results.getByRole('button', { name: 'Edit tags for Library test podcast' }).click()
    const editor = page.getByRole('dialog', { name: 'Add to categories' })
    await editor.getByRole('searchbox').fill('Development')
    await editor.getByRole('button', { name: 'Create “Development”' }).click()
    await editor.getByRole('button', { name: 'Save categories' }).click()
    await expect(editor).toHaveCount(0)
    await expect(sidebar.getByRole('button', { name: 'Development 1' })).toBeVisible()
    await expect(results.getByText(/Episode import queued/)).toBeVisible()
    const [followed] = await db
      .select()
      .from(followedPodcast)
      .where(eq(followedPodcast.userId, userIds[0]))
    expect(followed.feedId).not.toBeNull()
    const [feed] = await db.select().from(podcastFeed).where(eq(podcastFeed.url, feedUrl))
    expect(feed.id).toBe(followed.feedId)
    expect(feed.status).toBe('queued')

    await page.reload()
    await sidebar.getByRole('button', { name: 'Development 1' }).click()
    await expect(page.getByRole('heading', { name: 'Development' })).toBeVisible()
    await expect(results.getByRole('heading', { name: podcast.title })).toBeVisible()
    await results.getByRole('button', { name: 'Edit tags for Library test podcast' }).click()
    await expect(editor.getByRole('checkbox', { name: 'Development' })).toBeChecked()
    const bounds = await editor.boundingBox()
    expect(bounds).not.toBeNull()
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth)
    await editor.getByRole('searchbox').press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(
      results.getByRole('button', { name: 'Edit tags for Library test podcast' }),
    ).toBeFocused()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await results.getByRole('button', { name: 'Edit tags for Library test podcast' }).click()
    await expect(editor).toBeVisible()
    await sidebar.getByRole('heading', { name: 'Categories' }).click()
    await expect(editor).toHaveCount(0)

    await results.getByRole('button', { name: 'Unfollow Library test podcast' }).click()
    await expect(sidebar.getByRole('button', { name: 'Followed podcasts 0' })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: 'Development 0' })).toBeVisible()
    await page.reload()
    await expect(sidebar.getByRole('button', { name: 'Followed podcasts 0' })).toBeVisible()

    const accountTrigger = page.getByRole('button', { name: 'Account menu' })
    await accountTrigger.focus()
    await accountTrigger.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeChecked()
    await accountTrigger.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(accountTrigger).toBeFocused()
    await accountTrigger.click()
    await page.getByRole('menuitemradio', { name: 'Français' }).click()
    await expect(page).toHaveURL(/\/fr\/?$/)
    await page.getByRole('button', { name: 'Menu du compte' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Français' })).toBeChecked()
    await page.getByRole('menuitemradio', { name: 'English' }).click()
    await expect(page).toHaveURL('/')
    await accountTrigger.click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/signin')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

    const otherPage = await otherContext.newPage()
    await otherPage.goto('/')
    await expect(otherPage.getByRole('button', { name: 'Followed podcasts 1' })).toBeVisible()
    await expect(otherPage.getByRole('button', { name: 'Private category 0' })).toBeVisible()
    await expect(otherPage.getByRole('button', { name: 'Development 0' })).toHaveCount(0)
  } finally {
    await otherContext.close()
    await Promise.all(userIds.filter(Boolean).map((id) => db.delete(users).where(eq(users.id, id))))
    await db.delete(podcastFeed).where(eq(podcastFeed.url, feedUrl))
  }
})
