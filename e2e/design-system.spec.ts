import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { user as users } from '../src/db/auth-schema'
import { pocketCastsConnection } from '../src/db/pocket-casts-schema'
import { expect, test } from './fixtures'

test('loads a local font and decorative artwork without third-party font requests', async ({
  page,
}) => {
  await page.goto('/signin')
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('500 16px Inter'))).toBe(true)
  const font = await page.request.get('/fonts/InterVariable.woff2')
  expect(font.ok()).toBe(true)
  expect((await font.body()).subarray(0, 4).toString()).toBe('wOF2')
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map(({ name }) => name),
  )
  expect(resources.some((url) => url.includes('/fonts/InterVariable.woff2'))).toBe(true)
  expect(resources.some((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))).toBe(false)
  await expect(page.locator('img[src="/illustrations/microphone.svg"]')).toHaveAttribute('alt', '')
  await expect(page.getByRole('button', { name: /play/i })).toHaveCount(0)
})

test('adapts authentication to narrow and tablet layouts without horizontal overflow', async ({
  page,
}) => {
  for (const width of [320, 480, 768, 900, 901, 1440]) {
    // Each size must complete layout before the next resize.
    // oxlint-disable-next-line no-await-in-loop
    await page.setViewportSize({ width, height: 1000 })
    // oxlint-disable-next-line no-await-in-loop
    await page.goto('/fr/signin')
    // oxlint-disable-next-line no-await-in-loop
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
    // oxlint-disable-next-line no-await-in-loop
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('keeps mobile library controls out of the way, keyboard accessible, and always visible on desktop', async ({
  page,
  db,
}) => {
  let userId = ''
  try {
    const response = await page.request.post('/api/auth/sign-up/email', {
      data: {
        email: `design-${randomUUID()}@example.com`,
        name: 'Responsive design test',
        password: 'test-password-123',
      },
    })
    expect(response.ok()).toBe(true)
    userId = (await response.json()).user.id

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/discover')
    const toggle = page.getByRole('button', { name: 'Your library', exact: true })
    const librarySearch = page.getByRole('searchbox', { name: 'Filter your podcasts' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(librarySearch).toBeHidden()
    await expect(
      page.getByRole('searchbox', { name: 'Search podcasts', exact: true }),
    ).toBeVisible()
    await expect(toggle).toBeEnabled()
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(librarySearch).toBeVisible()
    await page.keyboard.press('Space')
    await expect(librarySearch).toBeHidden()
    await expect(toggle).toBeFocused()

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(toggle).toBeHidden()
    await expect(librarySearch).toBeVisible()
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(toggle).toBeVisible()
    await expect(librarySearch).toBeHidden()
    await toggle.click()
    await expect(librarySearch).toBeVisible()

    await page.getByRole('link', { name: 'Latest episodes', exact: true }).click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(librarySearch).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
  }
})

test('keeps the full connected Pocket Casts email readable on narrow French layouts', async ({
  page,
  db,
}) => {
  let userId = ''
  const email = 'a.long.pocket.casts.account.address@example.com'
  try {
    const response = await page.request.post('/api/auth/sign-up/email', {
      data: {
        email: `pocket-layout-${randomUUID()}@example.com`,
        name: 'Pocket Casts layout test',
        password: 'test-password-123',
      },
    })
    expect(response.ok()).toBe(true)
    userId = (await response.json()).user.id
    await db.insert(pocketCastsConnection).values({
      userId,
      email,
      // Reading connection identity does not decrypt tokens or call Pocket Casts.
      encryptedTokens: 'unused-by-this-read-only-layout-test',
    })

    await page.setViewportSize({ width: 320, height: 1000 })
    await page.goto('/fr/latest-episodes')
    const identity = page.getByText(`Connecté en tant que ${email}`, { exact: true })
    await expect(identity).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const layout = await identity.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const text = document.createRange()
      text.selectNodeContents(element)
      return {
        left: bounds.left,
        right: bounds.right,
        lines: Array.from(text.getClientRects(), (line) => ({
          left: line.left,
          right: line.right,
        })),
      }
    })
    expect(layout.lines.length).toBeGreaterThan(0)
    for (const line of layout.lines) {
      expect(line.left).toBeGreaterThanOrEqual(layout.left - 1)
      expect(line.right).toBeLessThanOrEqual(layout.right + 1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Déconnecter', exact: true })).toBeVisible()
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
  }
})
