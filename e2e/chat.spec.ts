import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { user as users } from '../src/db/auth-schema'
import { followedPodcast } from '../src/db/library-schema'
import { chatPodcast, chatResultChunks, chatResults } from '../src/test/episode-chat-fixtures'
import { expect, test } from './fixtures'

test('chat landing, real streamed cards, timeframe links, reset, and responsive layout', async ({
  page,
  db,
}, testInfo) => {
  let userId = ''
  try {
    if (testInfo.project.name !== 'mobile-safari')
      await page.setViewportSize({ width: 1440, height: 1100 })
    const signup = await page.request.post('/api/auth/sign-up/email', {
      data: {
        email: `chat-${randomUUID()}@example.com`,
        name: 'Chat test',
        password: 'test-password-123',
      },
    })
    expect(signup.ok()).toBe(true)
    const { user } = await signup.json()
    userId = user.id
    await page.goto('/')
    await expect(page).toHaveURL('/chat')
    await expect(
      page.getByText('Follow a podcast from search results to add it to your library.'),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Ask about your episodes' })).toBeDisabled()
    await db
      .insert(followedPodcast)
      .values({ userId, podcastId: chatPodcast.id, podcast: chatPodcast, categories: ['history'] })

    // Test the real client/SSE renderer without paid provider calls or invented production data.
    let requests = 0
    await page.route('**/api/chat', async (route) => {
      requests += 1
      if (requests === 2) {
        await route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'RUN_ERROR', code: 'CHAT_TIMEOUT', message: 'Upstream details must not be displayed' })}\n\n`,
        })
        return
      }
      const result = chatResults()
      result.filters = { ...result.filters, days: 30, podcastId: 123, categoryId: 'history' }
      const events: string[] = []
      for await (const chunk of chatResultChunks(result))
        events.push(`data: ${JSON.stringify(chunk)}\n\n`)
      await route.fulfill({ contentType: 'text/event-stream', body: events.join('') })
    })
    await page.reload()
    const input = page.getByRole('textbox', { name: 'Ask about your episodes' })
    await expect(input).toBeEnabled()
    await expect(page.getByText('Try:', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Roman history, from any time' })).toHaveCount(0)
    await expect(
      page.getByText('Only your followed podcasts · All time by default · No saved chat history'),
    ).toHaveCount(0)
    await input.fill('Roman history from the last 30 days')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Roman history 1', exact: true })).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Search results' }).getByRole('listitem'),
    ).toHaveCount(6)
    const more = page.getByRole('link', { name: /Show more episodes/ })
    await expect(more).toHaveAttribute('href', /days=30/)
    await expect(more).toHaveAttribute('href', /podcast=123/)
    await expect(more).toHaveAttribute('href', /category=history/)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('chat-layout.png'), fullPage: true })
    expect(requests).toBe(1)
    await more.click()
    await expect(page).toHaveURL(/\/latest-episodes\?/)
    await expect(page.getByRole('combobox', { name: 'Filter episodes by date' })).toHaveValue('30')
    await page.getByRole('link', { name: /Chat search/ }).click()
    await expect(page.getByText('What would you like to listen to?')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Roman history 1', exact: true })).toHaveCount(0)
    await input.fill('History')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Chat search took too long.')
    await expect(alert.getByRole('link', { name: 'Latest episodes' })).toHaveAttribute(
      'href',
      '/latest-episodes',
    )
    await expect(page.getByText('Upstream details must not be displayed')).toHaveCount(0)
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name: 'Roman history 1', exact: true })).toBeVisible()
    await expect(alert).toHaveCount(0)
    expect(requests).toBe(3)
    await page.getByRole('button', { name: 'Search settings and Pocket Casts' }).click()
    await expect(
      page.getByText('Conversations are not saved by this app.', { exact: false }),
    ).toBeVisible()
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
  }
})

test('chat API rejects anonymous and cross-origin requests without inference', async ({
  request,
  baseURL,
}) => {
  const body = { messages: [{ role: 'user', content: 'History' }] }
  const anonymous = await request.post('/api/chat', { headers: { origin: baseURL! }, data: body })
  expect(anonymous.status()).toBe(401)
  const foreign = await request.post('/api/chat', {
    headers: { origin: 'https://evil.example' },
    data: body,
  })
  expect(foreign.status()).toBe(403)
})
