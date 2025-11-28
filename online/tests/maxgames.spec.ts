import { test, expect } from '@playwright/test';

test.describe('MAX_GAMES Limit Tests', () => {
  test('MAX_GAMES limit prevents new game creation', async ({ browser }) => {
    // This test requires MAX_GAMES=2 to be set in the environment
    // Run this test with: npx playwright test --config=playwright.maxgames.config.ts
    
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    // Player 1 creates a game
    await page1.goto('/');
    await page1.click('text=Create a new game');
    await page1.fill('input[placeholder*="Enter your name"]', 'Player One');
    await page1.click('button:has-text("Create Game")');
    await expect(page1.locator('h2')).toContainText('Lobby - Game Code:');
    const code1 = (await page1.locator('h2').textContent())?.split(': ')[1].trim();
    expect(code1).toBeDefined();

    // Player 2 creates a game
    await page2.goto('/');
    await page2.click('text=Create a new game');
    await page2.fill('input[placeholder*="Enter your name"]', 'Player Two');
    await page2.click('button:has-text("Create Game")');
    await expect(page2.locator('h2')).toContainText('Lobby - Game Code:');
    const code2 = (await page2.locator('h2').textContent())?.split(': ')[1].trim();
    expect(code2).toBeDefined();
    expect(code2).not.toBe(code1); // Should be different games

    // Player 3 tries to create a game - should fail with server full error
    await page3.goto('/');
    await page3.click('text=Create a new game');
    await page3.fill('input[placeholder*="Enter your name"]', 'Player Three');
    await page3.click('button:has-text("Create Game")');
    
    // Wait for error message to appear in the modal
    // The error should be displayed in the Alert component within the modal
    await expect(page3.locator('.modal.show .alert-danger')).toContainText('server is full', { timeout: 5000, ignoreCase: true });
    
    // Verify the modal is still open (game was not created)
    await expect(page3.locator('.modal.show')).toBeVisible();
    
    // Verify we're still on the home page (not redirected to lobby)
    await expect(page3).toHaveURL(/\/$/);
    
    // Close the modal to clean up
    await page3.click('button:has-text("Cancel")');
    
    // Clean up contexts
    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });
});

