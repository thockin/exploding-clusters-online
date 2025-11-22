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

    // P3 Joins -> Updates Nonce (in production)
    // In DEVMODE, nonce is fixed, so this will NOT change the nonce.
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'NewPlayer', code);
    await expect(page3.locator('text=Lobby - Game Code')).toBeVisible();

    // P2 tries to reconnect
    await page2.goBack();
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load
    
    // In DEVMODE and production, nonce changes, so P2 should see Error Modal.
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

  test('DEVMODE Show Deck Overlay Escape', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');

    await page1.click('button:has-text("Show the deck")');
    
    const overlay = page1.locator('text=Draw Pile');
    await expect(overlay).toBeVisible();

    await page1.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

  test('DEVMODE Show Removed Overlay Escape', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');

    // Force some cards into the removed pile for testing
    // In DEVMODE, we have 4 debug cards that are put back into the deck.
    // Since 2 are dealt to players, 2 are returned. So 2 are discarded.
    // The startGame method removes exploding/upgrade cards to the removedPile.
    // For 2 players, 1 exploding card and 0 upgrade cards are inserted.
    // Total 4 exploding clusters, 2 upgrade clusters. So 3 exploding and 2 upgrade cards should be in removed pile.
    // Total removed in a 2 player game: 2 debug + 3 exploding + 2 upgrade = 7 cards.
    
    await page1.click('text=Show removed cards'); 
    
    const overlay = page1.locator('text=Removed Pile');
    await expect(overlay).toBeVisible();

    await page1.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

  test('Reorder Cards in Hand', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');
    await page1.waitForURL(/game/); // Ensure page is on game screen
    await page1.waitForLoadState('networkidle');

    await page1.waitForSelector('h5:has-text("Your Hand")', { timeout: 15000 });
    const handSection = page1.locator('h5:has-text("Your Hand")').locator('xpath=..');
    await expect(handSection).toBeVisible({ timeout: 15000 });
    await expect(handSection.locator('img')).toHaveCount(8, { timeout: 10000 });

    // Get initial order and card IDs by looking at the alt attribute of the img inside the draggable div
    const initialDraggableElements = await handSection.locator('.m-1').all();
    const initialCardIds = await Promise.all(initialDraggableElements.map(async (el) => await el.locator('img').getAttribute('alt')));

    const firstDraggableElement = initialDraggableElements[0];
    const secondDraggableElement = initialDraggableElements[1];

    const firstCardBox = await firstDraggableElement.boundingBox();
    const secondCardBox = await secondDraggableElement.boundingBox();

    if (!firstCardBox || !secondCardBox) {
      throw new Error('Could not get bounding box for cards');
    }

    const startX = firstCardBox.x + firstCardBox.width / 2;
    const startY = firstCardBox.y + firstCardBox.height / 2;
    const endX = secondCardBox.x + secondCardBox.width / 2;
    const endY = secondCardBox.y + secondCardBox.height / 2;

    console.log(`Dragging from (${startX}, ${startY}) to (${endX}, ${endY})`);

    await page1.mouse.move(startX, startY);
    await page1.mouse.down();
    await page1.mouse.move(endX, endY, { steps: 20 }); // More steps for smoother drag
    await page1.mouse.up();

    await page1.waitForTimeout(500); // Give UI time to react

    // Verify new order by comparing card IDs (using alt text as a proxy for card name/id for simplicity)
    const newDraggableElements = await handSection.locator('.m-1').all();
    const newCardIds = await Promise.all(newDraggableElements.map(async (el) => await el.locator('img').getAttribute('alt')));

    await expect(newCardIds[0]).toBe(initialCardIds[1]); // Original second card is now first
    await expect(newCardIds[1]).toBe(initialCardIds[0]);  // Original first card is now second

    // Reload page to verify persistence
    await page1.reload();
    await page1.waitForURL(/lobby|game/);
    
    if (process.env.DEVMODE === '1') {
        // In DEVMODE, since nonce is fixed, it should rejoin to game
        await expect(page1).toHaveURL(/game/, { timeout: 10000 }); // Explicitly assert game URL
        await page1.waitForSelector('h5:has-text("Your Hand")', { timeout: 15000 });
        const reloadedHandSection = page1.locator('h5:has-text("Your Hand")').locator('xpath=..');
        const reloadedDraggableElements = await reloadedHandSection.locator('.m-1').all();
        const reloadedCardIds = await Promise.all(reloadedDraggableElements.map(async (el) => await el.locator('img').getAttribute('alt')));
        await expect(reloadedCardIds[0]).toBe(initialCardIds[1]); 
        await expect(reloadedCardIds[1]).toBe(initialCardIds[0]);  
    } else {
        // In production, nonce changes, so player is sent to landing page
        await expect(page1).toHaveURL('/');
    }
  });

  test('Correct Number of Debug Cards', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');
    await expect(page1).toHaveURL(/game/, { timeout: 10000 });
    
    // Wait for the draw pile image to be visible, which indicates the game screen is fully loaded
    await page1.waitForSelector('img[alt="Draw Pile"]', { timeout: 10000 });
    
    // We can check this via the "Show me the deck" feature in DEVMODE
    await page1.click('button:has-text("Show the deck")');
    const deckOverlay = page1.locator('div[style*="z-index: 1000"]').locator('h2:has-text("Draw Pile")').locator('xpath=..');
    await expect(deckOverlay).toBeVisible();
    
    // Count debug cards in the deck list
    // The overlay shows images. We can count images with specific alt text or src.
    // Our debug cards have filenames starting with 'debug_-_'.
    // The deck overlay renders images.
    const debugCardsInDeck = await deckOverlay.locator('img[src*="debug_-_"]').count();
    
    // 2 players -> 2 dealt. Max 2 returned to deck. 6 total - 2 dealt - 2 returned = 2 discarded.
    expect(debugCardsInDeck).toBe(2);
  });

  test('Verify Hand Counts and Debug Card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click('text=Start Game');
    
    await page1.waitForSelector('h5:has-text("Your Hand")', { timeout: 10000 });
    await page2.waitForSelector('h5:has-text("Your Hand")', { timeout: 10000 });

    const p1HandCount = await page1.locator('h5:has-text("Your Hand")').locator('xpath=..').locator('img').count();
    const p2HandCount = await page2.locator('h5:has-text("Your Hand")').locator('xpath=..').locator('img').count();

    expect(p1HandCount).toBe(8);
    expect(p2HandCount).toBe(8);

    // Verify each has a debug card
    // Debug cards have 'debug_-_' in src
    const p1DebugCount = await page1.locator('h5:has-text("Your Hand")').locator('xpath=..').locator('img[src*="debug_-_"]').count();
    const p2DebugCount = await page2.locator('h5:has-text("Your Hand")').locator('xpath=..').locator('img[src*="debug_-_"]').count();

    expect(p1DebugCount).toBeGreaterThanOrEqual(1);
    expect(p2DebugCount).toBeGreaterThanOrEqual(1);
  });
});