import { test, expect } from "@playwright/test";

test("Infoz should be disabled by default", async ({ page }) => {
  const response = await page.goto("/infoz");
  expect(response?.status()).toBe(404);
});
