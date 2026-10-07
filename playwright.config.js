import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PAYMENT_DESK_TEST_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PAYMENT_DESK_TEST_PORT must be a port from 1024 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    // WebKit cold starts are slower on Windows and hosted CI; keep the same assertions.
    { name: 'webkit', timeout: 45_000, expect: { timeout: 10_000 }, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, timeout: 60000 },
});
