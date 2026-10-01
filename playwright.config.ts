import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:43187',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://127.0.0.1:43187/api/v1/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
