import { expect, test } from '@playwright/test'
import sharp from 'sharp'

test('renders the supplied logo and serves browser and Apple icons on localized pages', async ({
  page,
  request,
}) => {
  await page.goto('/fr/signin')

  const logo = page.locator('.brand img')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('src', '/logo-mark.png')
  await expect
    .poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(128)

  const icons = [
    { selector: 'link[rel="icon"][sizes="16x16"]', path: '/favicon-16x16.png', size: 16 },
    { selector: 'link[rel="icon"][sizes="32x32"]', path: '/favicon-32x32.png', size: 32 },
    { selector: 'link[rel="apple-touch-icon"]', path: '/apple-touch-icon.png', size: 180 },
  ]

  await Promise.all(
    icons.map(async (icon) => {
      await expect(page.locator(`head ${icon.selector}`)).toHaveAttribute('href', icon.path)
      const response = await request.get(icon.path)
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toContain('image/png')
      const metadata = await sharp(await response.body()).metadata()
      expect(metadata.width).toBe(icon.size)
      expect(metadata.height).toBe(icon.size)
      expect(metadata.hasAlpha).toBe(false)
    }),
  )

  await expect(page.locator('head link[rel="icon"][type="image/x-icon"]')).toHaveAttribute(
    'href',
    '/favicon.ico',
  )
  const favicon = await request.get('/favicon.ico')
  expect(favicon.ok()).toBe(true)
  const ico = await favicon.body()
  expect(ico.readUInt16LE(2)).toBe(1)
  expect(ico.readUInt16LE(4)).toBe(3)

  await expect(page.locator('head link[rel="mask-icon"]')).toHaveAttribute(
    'href',
    '/safari-pinned-tab.svg',
  )
  await expect(page.locator('head link[rel="mask-icon"]')).toHaveAttribute('color', '#191b1e')
  const mask = await request.get('/safari-pinned-tab.svg')
  expect(mask.ok()).toBe(true)
  expect(mask.headers()['content-type']).toContain('image/svg+xml')
  const svg = await mask.text()
  expect(
    await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml')
      return (
        document.querySelector('parsererror') === null && document.querySelector('path') !== null
      )
    }, svg),
  ).toBe(true)
})
