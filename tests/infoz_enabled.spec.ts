import { test, expect } from "@playwright/test";

test("Infoz should be enabled when ENABLE_INFOZ=1", async ({ page }) => {
  const response = await page.goto("/infoz");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toContainText("Current Games");
});
