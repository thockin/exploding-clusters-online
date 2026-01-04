// Copyright 2025 Tim Hockin

import { defineConfig, devices } from '@playwright/test';

// Force DEVMODE=1 for tests so that debug features are enabled and nonce behavior is deterministic
process.env.DEVMODE = '1';
process.env.MAX_GAMES = '2';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/maxgames.spec.ts',
  fullyParallel: false, // Run sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to ensure games are created sequentially
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

