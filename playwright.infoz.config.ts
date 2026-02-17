// Copyright 2025 Tim Hockin

import { defineConfig, devices } from '@playwright/test';

// Set DEVMODE so that testing-related features are enabled.
process.env.DEVMODE = '1';
process.env.ENABLE_INFOZ = '1';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/infoz_enabled.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
