import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/extension',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  outputDir: 'test-results/extension',
  use: { baseURL: 'http://127.0.0.1:4318' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4318 --strictPort',
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: !process.env.CI,
  },
});
