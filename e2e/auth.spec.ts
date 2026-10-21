import { expect, test } from '@playwright/test'

test('serves built assets without dev-server reload scripts', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByLabel('Email address')).toBeEnabled()
  // Development reloads can interrupt the navigations these browser tests exercise.
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map(({ name }) => new URL(name).pathname),
  )
  expect(resources).not.toContain('/@vite/client')
})

for (const route of ['/signin', '/signup', '/fr/signin', '/fr/signup']) {
  test(`enables authentication fields on a direct visit to ${route}`, async ({ page }) => {
    await page.goto(route)
    await Promise.all(
      (await page.locator('form input').all()).map((input) => expect(input).toBeEnabled()),
    )
    await expect(page.locator('form button[type="submit"]')).toBeEnabled()
    await page.locator('input[name="email"]').fill('listener@example.com')
    await page.locator('input[name="password"]').fill('password123')
    if (route.endsWith('/signup')) {
      await page.locator('input[name="confirmPassword"]').fill('password123')
    }
  })
}

test('protects the home page on direct requests and client navigation', async ({
  page,
  request,
}) => {
  const response = await request.get('/', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toBe('/signin')

  await Promise.all(
    ['/discover', '/latest-episodes'].map(async (route) => {
      const protectedResponse = await request.get(route, { maxRedirects: 0 })
      expect(protectedResponse.status()).toBe(307)
      expect(protectedResponse.headers().location).toBe('/signin')
    }),
  )

  await page.goto('/')
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await expect(page).toHaveURL('/signin')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.getByRole('link', { name: 'Podcast Finder home' }).click()
  await expect(page).toHaveURL('/signin')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('navigates between sign-in and email-only sign-up', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page).toHaveURL('/signup')
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await expect(page.locator('input[name="name"]')).toHaveCount(0)
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Confirm password')).toBeVisible()
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL('/signin')
  await expect(page.getByLabel('Confirm password')).toHaveCount(0)
})

test('switches to French and preserves locale in links and protected redirects', async ({
  page,
  request,
}) => {
  await page.goto('/signin')
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('fr')
  await expect(page).toHaveURL('/fr/signin')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page).toHaveTitle('Connexion | Podcast Finder')
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
  await expect(page.getByLabel('Adresse e-mail')).toBeEnabled()
  await expect(page.getByRole('combobox', { name: 'Langue', exact: true })).toHaveValue('fr')
  await expect(page.getByRole('combobox').locator('option')).toHaveCount(2)

  await page.getByRole('link', { name: 'Créer un compte' }).click()
  await expect(page).toHaveURL('/fr/signup')
  await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Langue', exact: true }).selectOption('en')
  await expect(page).toHaveURL('/signup')
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en')
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  const response = await request.get('/fr/', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toBe('/fr/signin')
})

test('shows localized authentication errors and supports a retry', async ({ page }) => {
  // Keep this starter suite independent of a database and real accounts.
  let attempts = 0
  await page.route('**/api/auth/sign-in/email', (route) => {
    attempts += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      }),
    })
  })
  await page.goto('/fr/signin')
  await page.getByLabel('Adresse e-mail').fill('listener@example.com')
  const password = page.getByLabel('Mot de passe', { exact: true })
  await password.fill('password123')
  await expect(page.getByLabel('Confirmer le mot de passe')).toHaveCount(0)
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'L’adresse e-mail ou le mot de passe est incorrect.',
  )
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeEnabled()
  await expect(page).toHaveURL('/fr/signin')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect.poll(() => attempts).toBe(2)
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeEnabled()
})

test('keeps the sign-up form usable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/fr/signup')
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Créer un compte', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('requires matching passwords only on sign-up', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/auth/sign-up/email', (route) => {
    attempts += 1
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        message: 'User already exists',
      }),
    })
  })
  await page.goto('/fr/signup')
  await page.getByLabel('Adresse e-mail').fill('listener@example.com')
  const password = page.getByLabel('Mot de passe', { exact: true })
  const confirmation = page.getByLabel('Confirmer le mot de passe')
  await password.fill('password123')
  await confirmation.fill('different-password')
  await page.getByRole('button', { name: 'Créer un compte', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Les mots de passe ne correspondent pas.')
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
  expect(attempts).toBe(0)

  await confirmation.fill('password123')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(confirmation).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Afficher la confirmation du mot de passe' }).click()
  await expect(confirmation).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Créer un compte', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Un compte avec cette adresse e-mail existe déjà.',
  )
  expect(attempts).toBe(1)
})
