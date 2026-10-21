import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4317'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // Test stable production assets: dev-server reloads can interrupt browser navigations.
    // Only the preview runtime uses test mode, avoiding production auth rate limits on test accounts.
    command:
      'pnpm build && NODE_ENV=test pnpm exec vite preview --host 127.0.0.1 --port 4317 --strictPort',
    url: `${baseURL}/signin`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: 'playwright-test-secret-for-local-tests-only-123456789',
    },
  },
})
