// Copyright 2025 Tim Hockin

import { defineConfig, devices } from '@playwright/test';

// Set DEVMODE=1 so that testing-related features are enabled.
process.env.DEVMODE = '1';

// Set "fast" mode for tests.
process.env.GO_FAST = '1';

// Set reaction timer to 3 seconds for tests to speed them up.
process.env.REACTION_TIMER = '3';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/devmode.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
