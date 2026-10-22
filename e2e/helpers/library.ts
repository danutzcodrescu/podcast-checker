import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export async function expandLibrary(page: Page) {
  const toggle = page.getByRole('button', { name: 'Your library', exact: true })
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await expect(toggle).toBeEnabled()
    await toggle.click()
  }
}
