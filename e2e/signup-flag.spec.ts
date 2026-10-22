import { randomUUID } from 'node:crypto'

import { expect, test } from './fixtures'

function credentials() {
  return {
    name: 'Registration flag test',
    email: `signup-flag-${randomUUID()}@example.com`,
    password: 'test-password-123',
  }
}

test('allows registration when enabled and preserves existing-account sign-in after disabling it', async ({
  request,
  setSignupEnabled,
}) => {
  const listener = credentials()
  const registration = await request.post('/api/auth/sign-up/email', { data: listener })
  expect(registration.status()).toBe(200)
  expect((await registration.json()).user.email).toBe(listener.email)
  expect((await request.post('/api/auth/sign-out', { data: {} })).status()).toBe(200)

  await setSignupEnabled(false)
  const blocked = await request.post('/api/auth/sign-up/email', { data: credentials() })
  expect(blocked.status()).toBe(404)
  expect(await blocked.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' })
  const signIn = await request.post('/api/auth/sign-in/email', { data: listener })
  expect(signIn.status()).toBe(200)
  expect((await signIn.json()).user.email).toBe(listener.email)
})

test('defaults to disabled when the flag row is missing and can re-enable registration without restarting', async ({
  page,
  request,
  setSignupEnabled,
}) => {
  await setSignupEnabled(null)
  await page.goto('/signin')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0)
  expect((await request.get('/signup')).status()).toBe(404)
  const registration = await request.post('/api/auth/sign-up/email', { data: credentials() })
  expect(registration.status()).toBe(404)
  expect(await registration.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' })

  await setSignupEnabled(true)
  await page.reload()
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeEnabled()
})

test('rejects an already-open sign-up form when registration is disabled before submission', async ({
  page,
  setSignupEnabled,
}) => {
  const listener = credentials()
  await page.goto('/signup')
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await page.getByLabel('Email address').fill(listener.email)
  await page.getByLabel('Password', { exact: true }).fill(listener.password)
  await page.getByLabel('Confirm password').fill(listener.password)

  await setSignupEnabled(false)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL('/signup')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.locator('form')).toHaveCount(0)
})

test.describe('registration disabled', () => {
  test.use({ signupEnabled: false })

  for (const locale of ['', '/fr']) {
    test(`hides registration and returns generic 404 responses (${locale || 'en'})`, async ({
      page,
      request,
    }) => {
      await page.goto(`${locale}/signin`)
      await expect(
        page.getByRole('button', { name: locale ? 'Se connecter' : 'Sign in', exact: true }),
      ).toBeEnabled()
      await expect(
        page.getByRole('link', { name: locale ? 'Créer un compte' : 'Create an account' }),
      ).toHaveCount(0)

      const response = await page.goto(`${locale}/signup`)
      expect(response?.status()).toBe(404)
      await expect(
        page.getByRole('heading', { name: locale ? 'Page introuvable' : 'Page not found' }),
      ).toBeVisible()
      await expect(page.locator('form')).toHaveCount(0)

      const registration = await request.post('/api/auth/sign-up/email', { data: credentials() })
      expect(registration.status()).toBe(404)
      expect(await registration.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' })
    })
  }
})
