import { test, expect, Page } from '@playwright/test';

// Helper to create game
async function createGame(page: Page, name: string) {
  await page.goto('/');
  await page.click('text=Create a new game');
  await page.fill('input[placeholder="Enter your name"]', name);
  await page.click('button:has-text("Create Game")');
  await expect(page.locator('h2')).toContainText('Lobby - Game Code:');
  const text = await page.locator('h2').textContent();
  return text?.split(': ')[1].trim() as string;
}

// Helper to join game
async function joinGame(page: Page, name: string, code: string) {
  await page.goto('/');
  await page.click('text=Join a game');
  await page.fill('input[placeholder="Enter your name"]', name);
  await page.fill('input[placeholder="Enter 5-letter game code"]', code);
  await page.click('button:has-text("Join Game")');
}

test.describe('Exploding Clusters Game Scenarios', () => {
  
  test('Happy Path: 2 Players + Observer', async ({ browser }) => {
    const p1 = await browser.newContext();
    const p2 = await browser.newContext();
    const obs = await browser.newContext();
    const page1 = await p1.newPage();
    const page2 = await p2.newPage();
    const pageObs = await obs.newPage();

    // P1 Creates
    const code = await createGame(page1, 'Player One');

    // P2 Joins
    await joinGame(page2, 'Player Two', code);

    // Observer Watches
    await pageObs.goto('/');
    await pageObs.click('text=Watch a game');
    await pageObs.fill('input[placeholder="Enter 5-letter game code"]', code);
    await pageObs.click('button:has-text("Watch Game")');

    // Verify Lobby Sync
    await expect(page1.locator('text=Player Two')).toBeVisible();
    await expect(page1.locator('text=Watching: 1 person')).toBeVisible();
    await expect(pageObs.locator('text=Player One (Host)')).toBeVisible();

    // Start Game
    await page1.click('text=Start Game');

    // Verify Game Screen
    await expect(page1).toHaveURL(/game/);
    await expect(page2).toHaveURL(/game/);
    await expect(pageObs).toHaveURL(/observer/);

    // Verify Observer UI (No Hand)
    await expect(pageObs.locator('text=Your Hand')).not.toBeVisible();
    await expect(page1.locator('text=Your Hand')).toBeVisible();
  });

  test('Game Full Rejection', async ({ browser }) => {
    const p1 = await browser.newContext();
    const page1 = await p1.newPage();
    const code = await createGame(page1, 'Host');

    // Join 4 more (Total 5)
    const contexts = [];
    for (let i = 2; i <= 5; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        const p = await ctx.newPage();
        await joinGame(p, `Player ${i}`, code);
        await expect(p.locator('text=Lobby - Game Code')).toBeVisible();
    }

    // 6th Player
    const p6 = await browser.newContext();
    const page6 = await p6.newPage();
    await page6.goto('/');
    await page6.click('text=Join a game');
    await page6.fill('input[placeholder="Enter your name"]', 'Player 6');
    await page6.fill('input[placeholder="Enter 5-letter game code"]', code);
    await page6.click('button:has-text("Join Game")');

    // Expect Error
    await expect(page6.locator('.modal.show .alert-danger')).toContainText('Sorry, that game is full');
  });

  test('Duplicate Name Rejection', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Alice');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Try to join with same name
    await page2.goto('/');
    await page2.click('text=Join a game');
    await page2.fill('input[placeholder="Enter your name"]', 'Alice');
    await page2.fill('input[placeholder="Enter 5-letter game code"]', code);
    await page2.click('button:has-text("Join Game")');

    await expect(page2.locator('.modal.show .alert-danger')).toContainText('name is already taken');
  });

  test('Join Non-Existent Game', async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.click('text=Join a game');
    await page.fill('input[placeholder="Enter your name"]', 'Bob');
    await page.fill('input[placeholder="Enter 5-letter game code"]', 'XXXXX');
    await page.click('button:has-text("Join Game")');
    
    await expect(page.locator('.modal.show .alert-danger')).toContainText('does not exist');
  });

  test('Watch Non-Existent Game', async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.click('text=Watch a game');
    await page.fill('input[placeholder="Enter 5-letter game code"]', 'XXXXX');
    await page.click('button:has-text("Watch Game")');
    await expect(page.locator('.modal.show .alert-danger')).toContainText('does not exist');
  });

  test('Reconnect to Lobby', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Host');

    const ctx2 = await browser.newContext();
    let page2 = await ctx2.newPage();
    await joinGame(page2, 'Leaver', code);
    await expect(page2.locator('text=Lobby - Game Code')).toBeVisible();
    
    // Ensure session storage is populated
    await page2.waitForFunction(() => {
        const s = sessionStorage.getItem('exploding_session');
        if (!s) return false;
        const data = JSON.parse(s);
        return data.gameCode && data.nonce;
    });

    // P2 Navigates away (Disconnects)
    await page2.goto('about:blank');

    // P1 checks list (Leaver should disappear)
    await expect(page1.locator('text=Leaver')).not.toBeVisible();

    // P2 Reconnects
    await page2.goBack();
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load
    
    // Wait for the lobby header to appear as a sign of successful session restore
    // This implicitly waits for the redirect to /lobby
    await expect(page2.locator('h2:has-text("Lobby - Game Code:")')).toBeVisible({ timeout: 30000 });
    // Verify the URL directly too
    await expect(page2).toHaveURL(/lobby/, { timeout: 5000 }); 
    
    await expect(page2.locator('text=Lobby - Game Code')).toBeVisible();
    
    // P1 sees Leaver again
    await expect(page1.locator('text=Leaver')).toBeVisible({ timeout: 10000 }); // Increased timeout
  });

  test('Reconnect Fails after Nonce Change', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Host');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'Leaver', code);
    await expect(page2.locator('text=Lobby - Game Code')).toBeVisible();
    
    await page2.waitForFunction(() => !!sessionStorage.getItem('exploding_session'));
    // P2 Navigates away (Disconnects)
    await page2.goto('about:blank');

    // P3 Joins -> Updates Nonce
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'NewPlayer', code);
    await expect(page3.locator('text=Lobby - Game Code')).toBeVisible();

    // P2 tries to reconnect
    await page2.goBack();
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load
    
    // Should see Error Modal
    // Wait for the modal title to become visible, then assert text
    await expect(page2.locator('.modal.show .modal-title')).toBeVisible({ timeout: 10000 });
    await expect(page2.locator('.modal.show .modal-title')).toContainText('Sorry!', { timeout: 5000 });
    await expect(page2.locator('.modal.show .modal-body')).toContainText('Rejoining', { timeout: 5000 });
  });

  test('Attrition Win', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Winner');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'Loser', code);

    await page1.click('text=Start Game');
    await expect(page1).toHaveURL(/game/);

    // P2 Leaves
    await page2.click('button:has-text("Leave Game")');
    // Confirm modal (the danger button)
    await page2.locator('.modal-footer button.btn-danger').click();

    // P1 should see Win Dialog
    // Accept "You win!" or "Winner wins!" to be safe against name matching quirks
    await expect(page1.locator('.modal.show .modal-title')).toHaveText(/You win!|Winner wins!/);
    await page1.click('text=OK');
    await expect(page1).toHaveURL('/'); // Landing page
  });

  test('DEVMODE Debug Button limit', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Dev');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');

    const debugBtn = page1.locator('button:has-text("Give me a DEBUG card")');
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();

    // Click until disabled
    for (let i=0; i<10; i++) {
        if (await debugBtn.isDisabled()) break;
        await debugBtn.click();
        await page1.waitForTimeout(200); 
    }

    await expect(debugBtn).toBeDisabled();
  });

  test('Card Overlay Escape', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');
    await page1.waitForURL(/game/); // Ensure page is on game screen
    await page1.waitForLoadState('networkidle'); // Wait for content to load

    // Wait for hand to be visible and have cards
    // Locate the hand container directly by its droppableId, which is applied via provided.droppableProps
    await page1.waitForSelector('h5:has-text("Players")', { timeout: 15000 }); // Wait for player list to be visible
    await page1.waitForSelector('h5:has-text("Your Hand")', { timeout: 15000 }); // Wait for the "Your Hand" heading
    await page1.waitForSelector('h5:has-text("Your Hand")', { timeout: 15000 }); // Wait for the "Your Hand" heading
    const handSection = page1.locator('h5:has-text("Your Hand")').locator('xpath=..'); // Select the parent Row
    await expect(handSection).toBeVisible({ timeout: 15000 });
    const cardImg = handSection.locator('img').first();
    await expect(handSection.locator('img')).toHaveCount(8, { timeout: 10000 }); // Expect 8 cards after start
    await cardImg.dblclick({ force: true });

    // Check for overlay (z-index 1000)
    const overlay = page1.locator('div[style*="z-index: 1000"]');
    await expect(overlay).toBeVisible();

    // Escape
    await page1.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

  test('Show Deck Overlay Escape', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');

    await page1.click('text=Show me the deck');
    
    const overlay = page1.locator('text=Draw Pile');
    await expect(overlay).toBeVisible();

    await page1.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

});
