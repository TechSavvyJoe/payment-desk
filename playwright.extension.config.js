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
});
