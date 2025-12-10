import { test, expect, Page, Locator } from '@playwright/test';
import { Buttons, Inputs, Headers, Locators } from './constants';
import { CardClass, TurnPhase } from '../src/api';

// Helper to create game
// - Navigates to home page
// - Clicks "Create a new game"
// - Enters player name
// - Clicks "Create Game"
// - Verifies lobby is shown and extracts game code
async function createGame(page: Page, name: string) {
  await page.goto('/', { timeout: 30000 });
  await page.click(Buttons.CREATE_NEW_GAME, { timeout: 15000 });
  await page.fill(Inputs.NAME, name, { timeout: 15000 });
  await page.click(Buttons.CREATE_GAME_CONFIRM, { timeout: 15000 });
  await expect(page.locator(Headers.LOBBY_GAME_CODE)).toContainText('Lobby - Game Code:', { timeout: 15000 });
  const text = await page.locator(Headers.LOBBY_GAME_CODE).textContent({ timeout: 15000 });
  return text?.split(': ')[1].trim() as string;
}

// Helper to join game
// - Navigates to home page
// - Clicks "Join a game"
// - Enters player name and game code
// - Clicks "Join Game"
// - Verifies lobby is shown
async function joinGame(page: Page, name: string, code: string) {
  await page.goto('/', { timeout: 30000 });
  await page.click(Buttons.JOIN_GAME, { timeout: 15000 });
  await page.fill(Inputs.NAME, name, { timeout: 15000 });
  await page.fill(Inputs.GAME_CODE, code, { timeout: 15000 });
  await page.click(Buttons.JOIN_GAME_CONFIRM, { timeout: 15000 });
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible({ timeout: 15000 });
}

// Helper to watch game
// - Navigates to home page
// - Clicks "Watch a game"
// - Enters game code
// - Clicks "Watch Game"
// - Verifies lobby is shown
async function watchGame(page: Page, code: string) {
  await page.goto('/', { timeout: 30000 });
  await page.click(Buttons.WATCH_GAME, { timeout: 15000 });
  await page.fill(Inputs.GAME_CODE, code, { timeout: 15000 });
  await page.click(Buttons.WATCH_GAME_CONFIRM, { timeout: 15000 });
  await expect(page).toHaveURL(/observer/, { timeout: 15000 });
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible({ timeout: 15000 });
}

// Helper to play a card via drag-and-drop from hand to pile.
async function playCard(page: Page, card: Locator) {
  const pile = findDiscardPileDropTarget(page);
  await expect(pile).toBeVisible();

  const srcBox = await card.boundingBox();
  const dstBox = await pile.boundingBox();
  if (!srcBox) throw new Error('Bounding box not found for card');
  if (!dstBox) throw new Error('Bounding box not found for pile');
  await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
  await expect(card).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');
  await page.mouse.up();
}

// Helper to draw a card.
async function drawCard(page: Page) {
  await expect(findTurnArea(page)).toContainText(`It's your turn`);
  await findDrawPile(page).click();
}

// Helper to find the player-list area.
function findPlayerList(page: Page): Locator {
  return page.locator(`div[data-areaname="player-list"]`);
}

// Helper to find the hand area.
function findHand(page: Page): Locator {
  return page.locator(`div[data-areaname="hand"]`);
}

// Helper to find cards in the hand area by their card class.  Can return
// multiple cards.
function findHandCardsByClass(page: Page, cardClass: CardClass): Locator {
  return findHand(page).locator(`div[data-cardclass="${cardClass}"]`);
}

// Helper to find all cards in the hand area.  Can return multiple cards.
function findAllHandCards(page: Page): Locator {
  const hand = page.locator(`div[data-areaname="hand"]`);
  return hand.locator(`div[data-cardclass]`);
}

// Helper to find the draw pile.
function findDrawPile(page: Page): Locator {
  return page.locator(`div[data-areaname="draw-pile"]`);
}

// Helper to find the discard pile.
function findDiscardPile(page: Page): Locator {
  return page.locator(`div[data-areaname="discard-pile"]`);
}

// Helper to find the discard pile's drop target to play a card.
function findDiscardPileDropTarget(page: Page): Locator {
  return findDiscardPile(page).locator('xpath=..');
}

// Helper to find the timer area.
function findTimerArea(page: Page): Locator {
  return page.locator(`div[data-areaname="timer"]`);
}

// Helper to find the message area.
function findMessageArea(page: Page): Locator {
  return page.locator(`div[data-areaname="message"]`);
}

// Helper to find the log area.
function findLogArea(page: Page): Locator {
  return page.locator(`div[data-areaname="log"]`);
}

// Helper to find the turn area.
function findTurnArea(page: Page): Locator {
  return page.locator(`div[data-areaname="turn"]`);
}

// Helper to find the overlay
function findOverlay(page: Page): Locator {
  return page.locator(`div[style*="z-index: 1000"] img`);
}

test.describe('UI Tests with DEVMODE=1', () => {

  test('Happy Path: 2 Players + Observer', async ({ browser }) => {
    const p1 = await browser.newContext();
    const p2 = await browser.newContext();
    const obs = await browser.newContext();
    const page1 = await p1.newPage();
    const page2 = await p2.newPage();
    const pageObs = await obs.newPage();

    // P1 Creates Game
    const code = await createGame(page1, 'Player One');

    // P2 Joins Game
    await joinGame(page2, 'Player Two', code);

    // Observer Watches Game
    await watchGame(pageObs, code);

    // Verify the player list has 2 players on all screens
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + ' .list-group-item')).toHaveCount(2);
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ' .list-group-item')).toHaveCount(2);
    await expect(pageObs.locator(Locators.LOBBY_PLAYER_LIST + ' .list-group-item')).toHaveCount(2);

    // Verify Lobby Sync on P1: Check that Player Two is listed
    await expect(page1.locator('text=Player Two')).toBeVisible();
    // Verify Lobby Sync on P1: Check spectator count
    await expect(page1.locator('text=Watching: 1 person')).toBeVisible();

    // Verify Lobby Sync on P2: Check that Player One is listed
    await expect(page1.locator('text=Player One')).toBeVisible();
    // Verify Lobby Sync on P2: Check spectator count
    await expect(page1.locator('text=Watching: 1 person')).toBeVisible();

    // Verify Lobby Sync on Observer: Check players
    await expect(pageObs.locator('text=Player One (Host)')).toBeVisible();
    await expect(pageObs.locator('text=Player Two')).toBeVisible();

    // Start Game (P1 clicks start)
    await page1.click(Buttons.START_GAME);

    // Verify Game Screen loaded for all participants
    await expect(page1).toHaveURL(/game/);
    await expect(page2).toHaveURL(/game/);
    await expect(pageObs).toHaveURL(/observer/);

    // Verify Observer UI: Should NOT see a hand
    await expect(pageObs.locator(Headers.YOUR_HAND)).not.toBeVisible();
    // Verify Player UI: Should see a hand
    await expect(page1.locator(Headers.YOUR_HAND)).toBeVisible();
  });

  test('Game Full Rejection', async ({ browser }) => {
    const p1 = await browser.newContext();
    const page1 = await p1.newPage();
    // P1 creates a game
    const code = await createGame(page1, 'Host');

    // Join 4 more players (Total 5) to fill the game
    const contexts = [];
    for (let i = 2; i <= 5; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const p = await ctx.newPage();
      await joinGame(p, `Player ${i}`, code);
      await expect(p.locator(Locators.LOBBY_TEXT)).toBeVisible();
    }

    // 6th Player attempts to join
    const p6 = await browser.newContext();
    const page6 = await p6.newPage();
    await page6.goto('/');
    await page6.click(Buttons.JOIN_GAME);
    await page6.fill(Inputs.NAME, 'Player 6');
    await page6.fill(Inputs.GAME_CODE, code);
    await page6.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "full" message
    await expect(page6.locator(Locators.MODAL_SHOW + ' .alert-danger')).toContainText('Sorry, that game is full');
  });

  test('Duplicate Name Rejection', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Create game as 'Alice'
    const code = await createGame(page1, 'Alice');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Try to join with same name 'Alice'
    await page2.goto('/');
    await page2.click(Buttons.JOIN_GAME);
    await page2.fill(Inputs.NAME, 'Alice');
    await page2.fill(Inputs.GAME_CODE, code);
    await page2.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "name taken" message
    await expect(page2.locator(Locators.MODAL_SHOW + ' .alert-danger')).toContainText('name is already taken');
  });

  test('Join Non-Existent Game', async ({ browser }) => {
    const page = await browser.newPage();
    // Attempt to join invalid code 'YYYYY'
    await page.goto('/');
    await page.click(Buttons.JOIN_GAME);
    await page.fill(Inputs.NAME, 'Bob');
    await page.fill(Inputs.GAME_CODE, 'YYYYY');
    await page.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator(Locators.MODAL_SHOW + ' .alert-danger')).toContainText('does not exist');
  });

  test('Watch Non-Existent Game', async ({ browser }) => {
    const page = await browser.newPage();
    // Attempt to watch invalid code 'YYYYY'
    await page.goto('/');
    await page.click(Buttons.WATCH_GAME);
    await page.fill(Inputs.GAME_CODE, 'YYYYY');
    await page.click(Buttons.WATCH_GAME_CONFIRM);
    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator(Locators.MODAL_SHOW + ' .alert-danger')).toContainText('does not exist');
  });

  test('Reconnect to Lobby', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Host creates game
    const code = await createGame(page1, 'Host');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Player 'Leaver' joins
    await joinGame(page2, 'Leaver', code);
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();

    // Ensure session storage is populated on P2
    await page2.waitForFunction(() => {
      const s = sessionStorage.getItem('exploding_session');
      if (!s) return false;
      const data = JSON.parse(s);
      return data.gameCode && data.nonce;
    });

    // P2 Navigates away (Disconnects)
    await page2.goto('about:blank');

    // Host checks list: 'Leaver' should disappear
    await expect(page1.locator('text=Leaver')).not.toBeVisible();

    // P2 Reconnects (Go back)
    await page2.goBack();
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load

    // Verify P2 successfully rejoins lobby
    await expect(page2.locator(Headers.LOBBY_GAME_CODE)).toBeVisible();
    // Verify URL is correct
    await expect(page2).toHaveURL(/lobby/, { timeout: 5000 }); 

    // Host sees 'Leaver' again in the list
    await expect(page1.locator('text=Leaver')).toBeVisible({ timeout: 10000 });
  });

  test('Reconnect Fails after Nonce Change', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Host creates game
    const code = await createGame(page1, 'Host');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Player 'Leaver' joins
    await joinGame(page2, 'Leaver', code);
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();

    // Ensure P2 session storage is ready
    await page2.waitForFunction(() => !!sessionStorage.getItem('exploding_session'));

    // P2 Navigates away (Disconnects)
    await page2.goto('about:blank');

    // New Player 'NewPlayer' joins -> Updates nonce
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'NewPlayer', code);
    await expect(page3.locator(Locators.LOBBY_TEXT)).toBeVisible();

    // P2 tries to reconnect
    await page2.goBack();
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load

    // Verify Reconnection Fails: Error Modal should appear due to nonce mismatch
    await expect(page2.locator(Locators.MODAL_SHOW + ' .modal-title')).toBeVisible({ timeout: 10000 });
    await expect(page2.locator(Locators.MODAL_SHOW + ' .modal-title')).toContainText('Sorry!', { timeout: 5000 });
    await expect(page2.locator(Locators.MODAL_SHOW + ' .modal-body')).toContainText('Rejoining', { timeout: 5000 });
  });

  test('Game owner Reassignment', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // 'Owner' creates game
    const code = await createGame(page1, 'Owner');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'Player 2', code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'Player 3', code);

    // Verify all players are in the lobby
    await expect(page1.locator('text=Player 2')).toBeVisible();
    await expect(page1.locator('text=Player 3')).toBeVisible();
    await expect(page2.locator('text=Owner (Host)')).toBeVisible();
    await expect(page3.locator('text=Owner (Host)')).toBeVisible();

    // Owner (P1) navigates away (Disconnects)
    await page1.goto('about:blank');

    // Verify Owner is gone from P2's list
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ':has-text("Owner")')).not.toBeVisible();

    // Verify a new owner is assigned (Player 2 or Player 3)
    // Wait for the host indicator to update on P2's screen
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ':has-text("(Host)")')).toBeVisible();

    // Check who is the new host and verify UI updates (Start Game button, Modal)
    const p2Host = await page2.locator(Locators.LOBBY_PLAYER_LIST + ':has-text("Player 2 (Host)")').isVisible();

    expect(p2Host).toBeTruthy();

    // P2 sees Start Game button
    await expect(page2.locator(Buttons.START_GAME)).toBeVisible();
    // P3 does not see Start Game button
    await expect(page3.locator(Buttons.START_GAME)).not.toBeVisible();
    // P2 sees promotion modal
    await expect(page2.locator('.modal-title:has-text("You are now the game owner")')).toBeVisible();

    // P1 Reconnects
    await page1.goBack();
    await page1.waitForLoadState('networkidle');

    // Verify P1 successfully rejoins
    await expect(page1.locator(Headers.LOBBY_GAME_CODE)).toBeVisible();

    // Verify P1 is present in P2's list again
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ':has-text("Owner")')).toBeVisible();

    // Verify P1 is NO LONGER the host
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + ':has-text("Owner (Host)")')).not.toBeVisible();
    // And P1 should NOT see the Start Game button
    await expect(page1.locator(Buttons.START_GAME)).not.toBeVisible();
  });

  test('Initial UI', async ({ browser }) => {
    // Setup 3 players
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'P3', code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);
    await page3.waitForURL(/game/);

    // Verify the player list
    await expect(findPlayerList(page1).locator('.list-group-item')).toHaveCount(3);
    await expect(findPlayerList(page1)).toContainText("P1 (that's you)");
    await expect(findPlayerList(page1)).toContainText("P2");
    await expect(findPlayerList(page1)).toContainText("P3");
    await expect(findPlayerList(page2).locator('.list-group-item')).toHaveCount(3);
    await expect(findPlayerList(page2)).toContainText("P1");
    await expect(findPlayerList(page2)).toContainText("P2 (that's you)");
    await expect(findPlayerList(page2)).toContainText("P3");
    await expect(findPlayerList(page3).locator('.list-group-item')).toHaveCount(3);
    await expect(findPlayerList(page3)).toContainText("P1");
    await expect(findPlayerList(page3)).toContainText("P2");
    await expect(findPlayerList(page3)).toContainText("P3 (that's you)");

    // Verify P1 (current turn) -> Lightgreen background
    const p1TurnArea = findTurnArea(page1);
    await expect(p1TurnArea).toBeVisible();
    await expect(p1TurnArea).toHaveCSS('background-color', 'rgb(144, 238, 144)');
    await expect(p1TurnArea).toContainText(`It's your turn, P2 is next`);

    // Verify P2 (next turn) -> Orange background
    const p2TurnArea = findTurnArea(page2);
    await expect(p2TurnArea).toBeVisible();
    await expect(p2TurnArea).toHaveCSS('background-color', 'rgb(255, 213, 128)');
    await expect(p2TurnArea).toContainText(`It's P1's turn, your turn is next`);

    // Verify P3 (other) -> Lightblue background
    const p3TurnArea = findTurnArea(page3);
    await expect(p3TurnArea).toBeVisible();
    await expect(p3TurnArea).toHaveCSS('background-color', 'rgb(173, 216, 230)');
    await expect(p3TurnArea).toContainText(`It's P1's turn`);
  });

  test('Card Wrapping', async ({ browser }) => {
    // Set viewport to constrain hand width to approx 7 cards to force wrapping
    const context = await browser.newContext({ viewport: { width: 850, height: 800 } });
    const page = await context.newPage();

    // Create game P1
    const code = await createGame(page, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Join P2
    await joinGame(page2, 'P2', code);

    // Start Game
    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);

    // Wait for hand to render and verify initial count (8)
    const handArea = page.locator(Headers.YOUR_HAND).locator('xpath=..');
    await expect(handArea.locator('img')).toHaveCount(8);

    // Check rows: 8 cards should wrap to 2 rows of 4
    const rows = handArea.locator('.d-flex.justify-content-center.flex-nowrap.w-100');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('img')).toHaveCount(4);
    await expect(rows.nth(1).locator('img')).toHaveCount(4);

    // Draw 9th card (using DEVMODE button)
    await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    await expect(handArea.locator('img')).toHaveCount(9);
    // Verify layout: 2 rows (5, 4)
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('img')).toHaveCount(5);
    await expect(rows.nth(1).locator('img')).toHaveCount(4);

    // Draw 10th card
    await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    await expect(handArea.locator('img')).toHaveCount(10);
    // Verify layout: 2 rows (5, 5)
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('img')).toHaveCount(5);
    await expect(rows.nth(1).locator('img')).toHaveCount(5);
    // Verify standard card size (100px)
    await expect(rows.nth(0).locator('.m-1').first()).toHaveCSS('width', '100px');

    // Add cards to force 3 rows (at standard size) -> should trigger resize to 2 rows (small cards)
    // Add 5 more cards -> Total 15
    for (let i = 0; i < 5; i++) {
      await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    }
    await expect(handArea.locator('img')).toHaveCount(15);

    // Verify layout: Should be 2 rows (small size)
    await expect(rows).toHaveCount(2);
    // Verify card size shrunk to 80px
    await expect(rows.nth(0).locator('.m-1').first()).toHaveCSS('width', '80px');

    // Add cards to force 3 rows even with SMALL size
    // Add 4 more -> Total 19
    for (let i = 0; i < 4; i++) {
      await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    }
    await expect(handArea.locator('img')).toHaveCount(19);

    // Verify layout: 3 rows (Small size)
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.m-1').first()).toHaveCSS('width', '80px');

    // Go backwards: Remove cards to reduce rows.
    for (let i = 0; i < 4; i++) {
      await page.click(Buttons.DEV_PUT_CARD_BACK);
    }
    await expect(handArea.locator('img')).toHaveCount(15);

    // Verify layout: Should be 2 rows (small size)
    await expect(rows).toHaveCount(2);
    // Verify card size shrunk to 80px
    await expect(rows.nth(0).locator('.m-1').first()).toHaveCSS('width', '80px');

    for (let i = 0; i < 5; i++) {
      await page.click(Buttons.DEV_PUT_CARD_BACK);
    }
    await expect(handArea.locator('img')).toHaveCount(10);

    // Verify layout: 2 rows (5, 5)
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('img')).toHaveCount(5);
    await expect(rows.nth(1).locator('img')).toHaveCount(5);
    // Verify standard card size (100px)
    await expect(rows.nth(0).locator('.m-1').first()).toHaveCSS('width', '100px');
  });

  test('Abandoned Turn', async ({ browser }) => {
    // Setup 3 players
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'P3', code);

    // Start Game
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);

    // Verify P1 starts (In DEVMODE)
    await expect(page1.locator('.list-group-item:has-text("P1")')).toHaveClass(/bg-success-subtle/);

    // Current player disconnects
    await page1.goto('about:blank');

    // Verify disconnected player disappears from list
    await expect(page2.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();

    // Verify "abandoned turn" message
    await expect(page2.locator(`text=P1 has abandoned their turn`)).toBeVisible();

    // Verify turn passes to next player (Green background check)
    await expect(page2.locator(`.list-group-item:has-text("P2")`)).toHaveClass(/bg-success-subtle/);
    const turnArea = findTurnArea(page2);
    await expect(turnArea).toContainText("It's your turn");

    // Reconnect attempt by disconnected player
    await page1.goBack();
    await page1.waitForLoadState('networkidle');

    // Verify Rejoin Fails (Error Modal)
    await expect(page1.locator(Locators.MODAL_SHOW)).toBeVisible();
    await expect(page1.locator(Locators.MODAL_SHOW)).toContainText('Sorry');

    // Verify player does NOT reappear in list
    await expect(page2.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();
  });

  test('Attrition Win', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Winner');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'Loser', code);

    // Start Game
    await page1.click(Buttons.START_GAME);
    await expect(page1).toHaveURL(/game/);

    // Loser Leaves Game voluntarily
    await page2.click(Buttons.LEAVE_GAME);
    // Confirm modal
    await page2.locator(Locators.MODAL_SHOW + ' .modal-footer button.btn-danger').click({ force: true });

    // Winner should see Win Dialog
    await expect(page1.locator(Locators.MODAL_SHOW + ' .modal-title')).toHaveText(/.*You win!/, { timeout: 10000 });
    await page1.click(Buttons.OK);
    // Winner redirected to landing page
    await expect(page1).toHaveURL('/'); 
  });

  test('Card Overlay Escape', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/); // Ensure page is on game screen
    await page1.waitForLoadState('networkidle'); // Wait for content to load

    // Wait for hand to be visible and have cards
    // Locate the hand container directly by its droppableId, which is applied via provided.droppableProps
    await page1.waitForSelector(Headers.YOUR_HAND, { timeout: 15000 }); // Wait for the "Your Hand" heading
    await page1.waitForSelector(Headers.YOUR_HAND, { timeout: 15000 }); // Wait for the "Your Hand" heading
    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..'); // Select the parent Row
    await expect(handArea).toBeVisible({ timeout: 15000 });
    const cardImg = handArea.locator('img').first();
    await expect(handArea.locator('img')).toHaveCount(8, { timeout: 10000 }); // Expect 8 cards after start
    await cardImg.dblclick({ force: true });

    // Check for overlay (z-index 1000)
    await expect(findOverlay(page1)).toBeVisible();

    // Escape
    await page1.keyboard.press('Escape');
    await expect(findOverlay(page1)).not.toBeVisible();
  });

  test('DEVMODE DEBUG Button limit', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Dev');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);

    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();

    // Click until disabled (consuming all debug cards)
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
    await page1.click(Buttons.START_GAME);

    // Click "Show the deck" button
    await page1.click(Buttons.DEV_SHOW_DECK);

    // Verify overlay appears
    const overlay = page1.locator(Locators.DRAW_PILE_TEXT);
    await expect(overlay).toBeVisible();

    // Press Escape to close
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
    await page1.click(Buttons.START_GAME);

    // Click "Show removed cards" button
    await page1.click(Buttons.DEV_SHOW_REMOVED); 

    // Verify overlay appears
    const overlay = page1.locator(Locators.REMOVED_PILE_TEXT);
    await expect(overlay).toBeVisible();

    // Press Escape to close
    await page1.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });

  test('Reorder Cards in Hand', async ({ browser }) => {
    // Set viewport to force 2 rows
    const viewport = { width: 850, height: 800 };
    const context = await browser.newContext({ viewport });
    const page1 = await context.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    // P3 to stabilize game
    const ctx3 = await browser.newContext({ viewport });
    const page3 = await ctx3.newPage();
    await joinGame(page3, 'P3', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/); 
    await page2.waitForURL(/game/);
    await page3.waitForURL(/game/);

    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Use a player who is NOT current turn to perform reorder
    await page2.waitForSelector(Headers.YOUR_HAND, { timeout: 15000 });
    const handArea = page2.locator(Headers.YOUR_HAND).locator('xpath=..');
    await expect(handArea).toBeVisible({ timeout: 15000 });
    await expect(handArea.locator('img')).toHaveCount(8, { timeout: 10000 });

    const rows = handArea.locator('.d-flex.justify-content-center.flex-nowrap.w-100');
    await expect(rows).toHaveCount(2);

    const row1Cards = rows.nth(0).locator('.m-1');
    const row2Cards = rows.nth(1).locator('.m-1');

    await expect(row1Cards).toHaveCount(4);
    await expect(row2Cards).toHaveCount(4);

    // --- Drag and Drop Test ---
    // Drag from Row 1 Index 0 to Row 2 Index 0
    const card0 = row1Cards.nth(0).locator('img');
    const card0Id = await card0.getAttribute('alt');

    const card0Div = row1Cards.nth(0);
    const card1Div = row1Cards.nth(1);

    const srcBox = await card0Div.boundingBox();
    const card1Box = await card1Div.boundingBox();
    const dstBox = await row2Cards.nth(0).boundingBox();

    if (!srcBox || !dstBox || !card1Box) throw new Error('Missing bounding box');

    // Perform Drag
    await page2.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page2.mouse.down();
    await page2.mouse.move(card1Box.x + card1Box.width / 2, card1Box.y + card1Box.height / 2, { steps: 20 });
    await page2.mouse.up();

    await page2.waitForTimeout(1000);

    // Verify Reorder: Card 0 should now be at Index 1
    const newRow1Idx1 = await row1Cards.nth(1).locator('img').getAttribute('alt');
    expect(newRow1Idx1).toBe(card0Id);

    // Reset Hand (Drag back)
    const currentCard0Div = row1Cards.nth(1); // 0 is here
    const currentCard1Div = row1Cards.nth(0); // 1 is here
    const currentCard0Box = await currentCard0Div.boundingBox();
    const currentCard1Box = await currentCard1Div.boundingBox();

    await page2.mouse.move(currentCard0Box!.x + currentCard0Box!.width / 2, currentCard0Box!.y + currentCard0Box!.height / 2);
    await page2.mouse.down();
    await page2.mouse.move(currentCard1Box!.x + currentCard1Box!.width / 2, currentCard1Box!.y + currentCard1Box!.height / 2, { steps: 20 });
    await page2.mouse.up();
    await page2.waitForTimeout(1000);
  });

  test('Play Single Non-DEVELOPER Card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page1.waitForLoadState('networkidle');

    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');
    const discardPile = page1.locator(Locators.DISCARD_PILE_TEXT).locator('xpath=..');
    const messageArea = findLogArea(page1);

    await expect(handArea.locator('img')).toHaveCount(8);
    await expect(discardPile.locator('img')).not.toBeVisible(); 

    // DEVMODE ensures we have a SHUFFLE card to play
    const cardToPlayLocator =  handArea.locator('img[alt^="SHUFFLE:"]');
    await expect(cardToPlayLocator).toBeVisible();

    const srcBox = await cardToPlayLocator.boundingBox();
    const dstBox = await discardPile.boundingBox();

    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    // Drag card to discard pile
    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // Verify card count decreased
    await expect(handArea.locator('img')).toHaveCount(7);
    // Verify discard pile has image
    await expect(discardPile.locator('img')).toBeVisible();
    // Verify log message
    await expect(messageArea).toContainText(`P1 played `);
  });

  test('Drag Different Card (Switch Selection)', async ({ browser }) => {
    const viewport = { width: 1200, height: 800 };
    const ctx1 = await browser.newContext({ viewport });
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page1.waitForLoadState('networkidle');

    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');
    const discardPile = page1.locator(Locators.DISCARD_PILE_TEXT).locator('xpath=..');
    const messageArea = findLogArea(page1);

    // Locate two different cards (FAVOR and SHUFFLE)
    const favorCard = handArea.locator('img[alt^="FAVOR:"]').first();
    const shuffleCard = handArea.locator('img[alt^="SHUFFLE:"]').first();

    await expect(favorCard).toBeVisible();
    await expect(shuffleCard).toBeVisible();

    // 1. Click to Select FAVOR
    await favorCard.click();
    // Verify selection visual (blue border)
    await expect(favorCard.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // 2. Drag SHUFFLE to discard (implicitly deselects FAVOR and plays SHUFFLE)
    const srcBox = await shuffleCard.boundingBox();
    const dstBox = await discardPile.boundingBox();
    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // 3. Verify SHUFFLE is played (gone)
    await expect(shuffleCard).not.toBeVisible(); 
    await expect(handArea.locator('img')).toHaveCount(7);

    // 4. Verify FAVOR is still there and DESELECTED
    await expect(favorCard).toBeVisible();
    await expect(favorCard.locator('xpath=..')).not.toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // 5. Verify message
    await expect(messageArea).toContainText(`P1 played SHUFFLE`);
  });

  test('Click Empty Space Deselects', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await expect(page1.locator('text=P2')).toBeVisible();

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page1.waitForLoadState('networkidle');

    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');

    // Select a card
    const card = handArea.locator('img').nth(6);
    await expect(card).toBeVisible();
    await card.click();
    await expect(card.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // Click text "Your Hand" (empty space/container header) to deselect
    await page1.click(Headers.YOUR_HAND);

    // Verify card is deselected
    await expect(card.locator('xpath=..')).not.toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');
  });

  test('Verify Hand Counts and DEBUG Card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);

    await page1.waitForSelector(Headers.YOUR_HAND, { timeout: 10000 });
    await page2.waitForSelector(Headers.YOUR_HAND, { timeout: 10000 });

    // Verify initial card counts are 8 for both
    const p1HandCount = await page1.locator(Headers.YOUR_HAND).locator('xpath=..').locator('img').count();
    const p2HandCount = await page2.locator(Headers.YOUR_HAND).locator('xpath=..').locator('img').count();

    expect(p1HandCount).toBe(8);
    expect(p2HandCount).toBe(8);

    // Verify each player has at least 1 DEBUG card
    const p1DebugCount = await page1.locator(Headers.YOUR_HAND).locator('xpath=..').locator('img[alt^="DEBUG:"]').count();
    const p2DebugCount = await page2.locator(Headers.YOUR_HAND).locator('xpath=..').locator('img[alt^="DEBUG:"]').count();

    expect(p1DebugCount).toBeGreaterThanOrEqual(1);
    expect(p2DebugCount).toBeGreaterThanOrEqual(1);
  });

  test('Multi-Card Reorder', async ({ browser }) => {
    const viewport = { width: 1200, height: 800 }; 
    const ctx1 = await browser.newContext({ viewport });
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page1.waitForLoadState('networkidle');

    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');
    await expect(handArea.locator('img')).toHaveCount(8);

    const devCards = handArea.locator('img[alt^="DEVELOPER:"]');
    const count = await devCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    let firstPairIndex = -1;
    let secondPairIndex = -1;
    let pairSrc = '';

    for (let i = 0; i < count; i++) {
      const src = await devCards.nth(i).getAttribute('src');
      for (let j = i + 1; j < count; j++) {
        const src2 = await devCards.nth(j).getAttribute('src');
        if (src === src2) {
          firstPairIndex = i;
          secondPairIndex = j;
          pairSrc = src || '';
          break;
        }
      }
      if (firstPairIndex !== -1) break;
    }

    expect(firstPairIndex).not.toBe(-1);
    const card1 = devCards.nth(firstPairIndex);
    const card2 = devCards.nth(secondPairIndex);

    // Select first card
    await card1.click();
    await expect(card1.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // Shift-click second card to multi-select
    await page1.keyboard.down('Shift');
    await card2.click();
    await page1.keyboard.up('Shift');

    // Verify both are selected
    await expect(card1.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');
    await expect(card2.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // Drag the first selected card to end of hand (moves both)
    const lastCard = handArea.locator('img').last();
    const srcBox = await card1.boundingBox();
    const dstBox = await lastCard.boundingBox(); 

    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.waitForTimeout(500);
    await page1.mouse.move(dstBox.x + dstBox.width, dstBox.y + dstBox.height / 2, { steps: 60 }); 
    await page1.waitForTimeout(500);
    await page1.mouse.up();

    await page1.waitForTimeout(500);

    // Verify the identical cards are now at the end of the hand
    const newLast = handArea.locator('img').last();
    const newSecondLast = handArea.locator('img').nth(-2);

    expect(await newLast.getAttribute('src')).toBe(pairSrc);
    expect(await newSecondLast.getAttribute('src')).toBe(pairSrc);

    // Verify selection persists
    await expect(newLast.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');
    await expect(newSecondLast.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');
  });

  test('Card Selection Focus Ring', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const code = await createGame(page, 'FocusTest');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);

    // Wait for hand to populate
    await expect(findAllHandCards(page)).toHaveCount(8);

    // Find pair of DEVELOPER cards (in the fixed deck)
    const devCards = findHand(page).locator('img[alt^="DEVELOPER:"]');
    const count = await devCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    let firstPairIndex = -1;
    let secondPairIndex = -1;

    for (let i = 0; i < count; i++) {
      const src = await devCards.nth(i).getAttribute('src');
      for (let j = i + 1; j < count; j++) {
        const src2 = await devCards.nth(j).getAttribute('src');
        if (src === src2) {
          firstPairIndex = i;
          secondPairIndex = j;
          break;
        }
      }
      if (firstPairIndex !== -1) break;
    }

    expect(firstPairIndex).not.toBe(-1);
    const card1 = devCards.nth(firstPairIndex);
    const card2 = devCards.nth(secondPairIndex);

    // Select first
    await card1.click();
    await expect(card1.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // Shift-click second
    await page.keyboard.down('Shift');
    await card2.click();
    await page.keyboard.up('Shift');

    // Verify selection style
    await expect(card2.locator('xpath=..')).toHaveCSS('box-shadow', 'rgb(0, 0, 255) 0px 0px 0px 3px');

    // Press Shift again to check focus ring suppression (outline style)
    await page.keyboard.down('Shift');
    const card2Wrapper = card2.locator('xpath=..');
    await expect(card2Wrapper).toHaveCSS('outline-style', 'none');
    await page.keyboard.up('Shift');
  });

  test('Draw Card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // Ensure it's P1's turn
    await expect(findTurnArea(page1)).toContainText(`It's your turn`);
    await expect(findTurnArea(page2)).toContainText(`your turn is next`);
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Click draw pile
    await findDrawPile(page1).click();

    // Verify overlay on P1
    await expect(findOverlay(page1)).toBeVisible();

    // Verify Animation on P2
    const animatedHandCard = page2.locator(Locators.HAND_ANIMATION_CARD);
    await expect(animatedHandCard).toBeVisible();
    await expect(animatedHandCard).toHaveAttribute('src', /back\.png/);

    // Wait for animation to finish (GO_FAST=1s)
    //await page1.waitForTimeout(1500);

    // Verify overlay gone
    await expect(findOverlay(page1)).not.toBeVisible();

    // Verify hand count +1
    await expect(findAllHandCards(page1)).toHaveCount(9);

    // Verify log message indicating turn advancement
    await expect(findLogArea(page1)).toContainText(`P1 drew a card`);
    await expect(findLogArea(page2)).toContainText(`P1 drew a card`);

    // Verify turn passed to P2
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
  });

  test('Dismiss Draw Overlay', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // P1 draws a card
    await findDrawPile(page1).click();

    // Verify overlay appears
    await expect(findOverlay(page1)).toBeVisible();

    // Click to dismiss (should disappear immediately)
    await findOverlay(page1).click();
    await expect(findOverlay(page1)).not.toBeVisible();

    // Verify turn eventually passes to P2 (after server timeout)
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
  });

  test('Play Single Card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // Find a SHUFFLE card to play (P1 has one).
    const card = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(card).toBeVisible();

    // Verify card count
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Play the card
    await playCard(page1, card);

    // Check for timer messages
    await expect(findTimerArea(page1)).toContainText(`Waiting for other players to react`);
    await expect(findTimerArea(page2)).toContainText(`Want to react?`);

    // Wait for timer to expire (2 seconds in tests)
    await expect(findTimerArea(page1)).not.toContainText(`Waiting for other players to react`);

    // Verify card count decreased
    await expect(findAllHandCards(page1)).toHaveCount(7);

    // Verify discard pile has image
    await expect(findDiscardPile(page1).locator('img')).toBeVisible();
    await expect(findDiscardPile(page2).locator('img')).toBeVisible();
  });

  test('Play Combo', async ({ browser }) => {
    const viewport = { width: 1200, height: 800 };

    const ctx1 = await browser.newContext({ viewport });
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();

    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // Wait for the hand to load
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Find pair of DEVELOPER cards
    const devCards = findHand(page1).locator('img[alt^="DEVELOPER:"]');
    const count = await devCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    let firstPairIndex = -1;
    let secondPairIndex = -1;

    for (let i = 0; i < count; i++) {
      const src = await devCards.nth(i).getAttribute('src');
      for (let j = i + 1; j < count; j++) {
        const src2 = await devCards.nth(j).getAttribute('src');
        if (src === src2) {
          firstPairIndex = i;
          secondPairIndex = j;
          break;
        }
      }
      if (firstPairIndex !== -1) break;
    }

    const card1 = devCards.nth(firstPairIndex);
    const card2 = devCards.nth(secondPairIndex);

    // Select Pair
    await card1.click();
    await page1.keyboard.down('Shift');
    await card2.click();
    await page1.keyboard.up('Shift');

    // Drag Pair to Discard Pile
    const srcBox = await card1.boundingBox();
    const dstBox = await findDiscardPile(page1).boundingBox();
    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.waitForTimeout(500); // Longer wait for drag start
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 60 }); // More steps
    await page1.waitForTimeout(500); // Longer wait over drop target
    await page1.mouse.up();

    // Check for timer messages
    await expect(findTimerArea(page1)).toContainText(`Waiting for other players to react`);
    await expect(findTimerArea(page2)).toContainText(`Want to react?`);

    // Wait for timer to expire (2 seconds in tests)
    await expect(findTimerArea(page1)).not.toContainText(`Waiting for other players to react`);

    // Verify 2 cards removed
    await expect(findAllHandCards(page1)).toHaveCount(6);

    // Verify log message
    await expect(findLogArea(page1)).toContainText(`P1 played a pair of DEVELOPER`);
  });

  test('Put Card Back', async ({ browser }) => {
    // Setup context
    const context = await browser.newContext();
    const page = await context.newPage();
    // P1 Creates Game
    const code = await createGame(page, 'P1');

    // P2 Joins
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    // Start Game
    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);

    // Verify initial hand count (8)
    const handArea = page.locator(Headers.YOUR_HAND).locator('xpath=..');
    await expect(handArea.locator('img')).toHaveCount(8);

    // Get initial deck count from UI text (e.g. "(30 cards)")
    const deckCountText = await page.locator(Locators.DRAW_PILE_COUNT).textContent();
    const initialDeckCount = parseInt(deckCountText?.replace(/\D/g, '') || '0', 10);

    // Click "Put a card back" button
    await page.click(Buttons.DEV_PUT_CARD_BACK);

    // Verify hand count decreased to 7
    await expect(handArea.locator('img')).toHaveCount(7);

    // Verify deck count increased by 1
    await expect(page.locator(Locators.DRAW_PILE_COUNT)).toHaveText(`(${initialDeckCount + 1} cards)`);
  });

  test('Layout Stability', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const code = await createGame(page, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);

    // Wait for initial layout
    await page.waitForSelector(Locators.DRAW_PILE_COUNT);

    // Locators for areas
    // The green table area (Col md=9)
    const tableArea = page.locator('div[style*="background-color: rgb(34, 139, 34)"]'); 
    // The fixed height message container
    const messageArea = findLogArea(page).locator('xpath=..'); 
    // The hand container (bg-light, fixed height)
    const handArea = page.locator(Headers.YOUR_HAND).locator('xpath=..'); 

    await expect(tableArea).toBeVisible();
    await expect(messageArea).toBeVisible();
    await expect(handArea).toBeVisible();

    // Get initial bounding boxes
    const initialTableBox = await tableArea.boundingBox();
    const initialMessageBox = await messageArea.boundingBox();
    const initialHandBox = await handArea.boundingBox();

    if (!initialTableBox || !initialMessageBox || !initialHandBox) {
        throw new Error("Could not get initial bounding boxes");
    }

    // Add 20 cards to force scrolling and potential layout shift
    for (let i = 0; i < 20; i++) {
      await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    }

    // Wait a bit for any layout settling
    await page.waitForTimeout(500);

    // Get new bounding boxes
    const finalTableBox = await tableArea.boundingBox();
    const finalMessageBox = await messageArea.boundingBox();
    const finalHandBox = await handArea.boundingBox();

    if (!finalTableBox || !finalMessageBox || !finalHandBox) {
        throw new Error("Could not get final bounding boxes");
    }

    // Assert dimensions haven't changed
    expect(finalTableBox.height).toBeCloseTo(initialTableBox.height, 1);
    expect(finalTableBox.width).toBeCloseTo(initialTableBox.width, 1);

    expect(finalMessageBox.height).toBeCloseTo(initialMessageBox.height, 1);
    expect(finalMessageBox.y).toBeCloseTo(initialMessageBox.y, 1);

    // Hand container HEIGHT should not change (it is 35vh fixed)
    expect(finalHandBox.height).toBeCloseTo(initialHandBox.height, 1);
  });

  test('Message Log Cleared Between Games', async ({ browser }) => {
    // P1 Creates Game 1
    const context = await browser.newContext();
    const page = await context.newPage();
    const code1 = await createGame(page, 'P1');

    // P2 Joins Game 1
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code1);

    // Start Game 1
    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // P1 plays a card to generate a log
    // Draw until we have something playable? Or just use DEV_GIVE_SAFE_CARD if hand empty?
    // Start game gives 7 cards. Should have something.
    // Let's just use "Give me a safe card" to generate a "P1 put back..." or "P1 drew..." message if we used draw?
    // Or just "P1 joined" is already in the log.
    // Let's ensure a SPECIFIC unique message is there.
    // "P1 played ATTACK" (if we can).
    // Or simpler: P1 draws a card.
    drawCard(page);
    // Wait for log
    await expect(findLogArea(page)).toContainText('P1 drew a card');
    await expect(findLogArea(page2)).toContainText('P1 drew a card');

    // P1 Leaves Game
    await page.click(Buttons.LEAVE_GAME);
    // Confirm Leave
    await page.click(Buttons.LEAVE_GAME_CONFIRM);
    await page.waitForURL('/');

    // P2 sees win/end?
    // "game ended due to insufficient players"
    // P2 acknowledges
    await expect(page2.locator(Locators.MODAL_SHOW)).toContainText(/win/i);
    await page2.click(Buttons.MODAL_OK);
    await page2.waitForURL('/');

    // P1 Creates Game 2
    const code2 = await createGame(page, 'P1');
    expect(code2).not.toEqual(code1);

    // P2 Joins Game 2
    await joinGame(page2, 'P2', code2);

    // Start Game 2 to see the logs
    await page.click(Buttons.START_GAME);
    await page.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // Verify logs are clean.
    // Game 1 had "P1 drew a card".
    // Game 2 should be empty initially.
    await expect(findLogArea(page)).toHaveText('');
    await expect(findLogArea(page2)).toHaveText('');
  });

  test('Simultaneous NAKs', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await joinGame(page3, 'P3', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);
    await page3.waitForURL(/game/);

    // Find the important elements of the page
    const p1Shuffle = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Shuffle).toBeVisible();
    await expect(p1Shuffle).toHaveAttribute('data-playable', 'true');

    const p2Nak = findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Nak).toBeVisible();
    await expect(p2Nak).toHaveAttribute('data-playable', 'false');

    const p2Discard = findDiscardPileDropTarget(page2);
    await expect(p2Discard).toBeVisible();

    const p3Nak = findHandCardsByClass(page3, CardClass.Nak).first();
    await expect(p3Nak).toBeVisible();
    await expect(p3Nak).toHaveAttribute('data-playable', 'false');

    // P1 plays SHUFFLE, enter reaction phase
    await playCard(page1, p1Shuffle);
    await expect(findLogArea(page2)).toContainText('P1 played SHUFFLE');

    // Verify reaction phase
    const timerArea = findTimerArea(page1);
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2Nak).toHaveAttribute('data-playable', 'true');
    await expect(p3Nak).toHaveAttribute('data-playable', 'true');

    // P2 starts to play NAK, but does not finish yet
    const p2SrcBox = await p2Nak.boundingBox();
    const p2DstBox = await p2Discard.boundingBox();
    if (!p2SrcBox) throw new Error('Bounding box not found for card');
    if (!p2DstBox) throw new Error('Bounding box not found for pile');
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2, p2SrcBox.y + p2SrcBox.height / 2);
    await page2.mouse.down();
    // Move a bit to start drag
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2 + 20, p2SrcBox.y + p2SrcBox.height / 2 + 20);

    // P3 Plays NAK, restart reaction phase, updates nonce to N2
    await playCard(page3, p3Nak);
    await expect(findLogArea(page2)).toContainText('P3 played NAK');

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);

    // P2 finishes their play, drops NAK, but sends nonce N1
    await page2.mouse.move(p2DstBox.x + p2DstBox.width / 2, p2DstBox.y + p2DstBox.height / 2);
    await page2.mouse.up();

    // Verify rejection dialog on P2
    await expect(page2.locator('.modal-title')).toHaveText('Game Updated');
    await expect(page2.locator('.modal-body')).toContainText('beat you to it');

    // P2 retries (Click OK)
    await page2.getByRole('button', { name: 'Play it!' }).click();

    // Verify P2 played
    await expect(findLogArea(page1)).toContainText('P2 played NAK');
  });

  test('Action/reaction logic', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    const timerArea = findTimerArea(page1);
    await expect(timerArea).toBeHidden();

    // Verify P1's lone DEVELOPER is not playable but others are.
    const p1Shuffle = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Shuffle).toHaveAttribute('data-playable', 'true');
    const p1Nak = findHandCardsByClass(page1, CardClass.Nak).first();
    await expect(p1Nak).toHaveAttribute('data-playable', 'false');

    const devCards = findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3) 
    let foundPlayable = false;
    let foundUnplayable = false;
    for (const card of await devCards.all()) {
      const playable = await card.getAttribute('data-playable');
      if (playable === 'true') {
          foundPlayable = true;
      } else if (playable === 'false') {
          foundUnplayable = true;
      } else {
          throw new Error(`Unexpected data-playable value: ${playable} (${typeof playable})`);
      }
    }
    expect(foundPlayable).toBe(true);
    expect(foundUnplayable).toBe(true);

    // Verify P2's SHUFFLE_NOW is playable and not others.
    const p2ShuffleNow = findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2ShuffleNow).toHaveAttribute('data-playable', 'true');
    const p2Debug = findHandCardsByClass(page2, CardClass.Debug).first();
    await expect(p2Debug).toHaveAttribute('data-playable', 'false');
    const p2Nak = findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Nak).toHaveAttribute('data-playable', 'false');
    const p2Skip = findHandCardsByClass(page2, CardClass.Skip).first();
    await expect(p2Skip).toHaveAttribute('data-playable', 'false');

    // P1 plays SHUFFLE, restart reaction phase
    await playCard(page1, p1Shuffle);
    await expect(findLogArea(page2)).toContainText('P1 played SHUFFLE');

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(timerArea).toBeVisible();
    await expect(page1.getByText('Waiting for other players to react')).toBeVisible();
    await expect(page2.getByText('Want to react')).toBeVisible();

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P2's NAK and SHUFFLE_NOW cards are playable
    await expect(p2Nak).toHaveAttribute('data-playable', 'true');
    await expect(p2ShuffleNow).toHaveAttribute('data-playable', 'true');

    // P2 plays NAK, restart reaction phase
    await playCard(page2, p2Nak);
    await expect(findLogArea(page1)).toContainText('P2 played NAK');

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(page1.getByText('Want to react')).toBeVisible();
    await expect(page2.getByText('Waiting for other players to react')).toBeVisible();

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P1's NAK is playable
    await expect(p1Nak).toHaveAttribute('data-playable', 'true');

    // P1 plays NAK, restart reaction phase
    await playCard(page1, p1Nak);
    await expect(findLogArea(page2)).toContainText('P1 played NAK');

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(page1.getByText('Waiting for other players to react')).toBeVisible();
    await expect(page2.getByText('Want to react')).toBeVisible();

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P2's SHUFFLE_NOW card is playable
    await expect(p2ShuffleNow).toHaveAttribute('data-playable', 'true');

    // P2 plays SHUFFLE_NOW, restart reaction phase
    await playCard(page2, p2ShuffleNow);
    await expect(findLogArea(page1)).toContainText('P2 played SHUFFLE_NOW');

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(page1.getByText('Want to react')).toBeVisible();
    await expect(page2.getByText('Waiting for other players to react')).toBeVisible();

    // P1 plays another NAK, restart reaction phase
    const p1Nak2 = findHandCardsByClass(page1, CardClass.Nak).first();
    await playCard(page1, p1Nak2);
    await expect(findLogArea(page2)).toContainText('P1 played NAK');

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(page1.getByText('Waiting for other players to react')).toBeVisible();
    await expect(page2.getByText('Want to react')).toBeVisible();

    // Verify that none of P1's or P2's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }
  });

  test('Non-current player plays NOW first', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    const timerArea = findTimerArea(page1);
    await expect(timerArea).toBeHidden();

    const p1Nak = findHandCardsByClass(page1, CardClass.Nak).first();
    await expect(p1Nak).toHaveAttribute('data-playable', 'false');

    const p2ShuffleNow = findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2ShuffleNow).toHaveAttribute('data-playable', 'true');

    // P2 plays SHUFFLE_NOW, enter reaction phase
    await playCard(page2, p2ShuffleNow);
    await expect(findLogArea(page1)).toContainText('P2 played SHUFFLE_NOW');

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(timerArea).toBeVisible();
    await expect(page1.getByText('Want to react')).toBeVisible();
    await expect(page2.getByText('Waiting for other players to react')).toBeVisible();

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P1's NAK card is playable
    await expect(p1Nak).toHaveAttribute('data-playable', 'true');

    // P1 plays NAK, restart reaction phase
    await playCard(page1, p1Nak);
    await expect(findLogArea(page2)).toContainText('P1 played NAK');

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(page1.getByText('Waiting for other players to react')).toBeVisible();
    await expect(page2.getByText('Want to react')).toBeVisible();

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }
  });

  test('Drawing EXPLODING CLUSTER', async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    type dismissFunc = (page: Page) => Promise<void>;
    const almostExplode = async (p1: string, page1: Page, p2: string, page2: Page, p3: string, page3: Page, dismiss: dismissFunc, hide: number) => {
      const p1Overlay = findOverlay(page1);
      const p2Overlay = findOverlay(page2);
      const p3Overlay = findOverlay(page3);

      // P1 draws a card
      await drawCard(page1);

      // Verify P1's overlay
      await expect(p1Overlay).toBeVisible();

      // Dismiss P1's overlay
      await dismiss(page1);
      await expect(p1Overlay).toBeHidden();
      await expect(p2Overlay).toBeVisible();
      await expect(p3Overlay).toBeVisible();
      await expect(findLogArea(page1)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(findLogArea(page2)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(findLogArea(page3)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);

      // Verify other overlays
      await expect(p2Overlay).toBeVisible();
      await expect(p3Overlay).toBeVisible();

      // Discard piles should show EXPLODING CLUSTER
      const p1Pile = findDiscardPile(page1);
      const p2Pile = findDiscardPile(page2);
      const p3Pile = findDiscardPile(page3);
      await expect(p1Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);
      await expect(p2Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);
      await expect(p3Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify P1 messages
      await expect(findTimerArea(page1)).toContainText("PLAY A DEBUG CARD");
      await expect(findTurnArea(page1)).toContainText("Your cluster is exploding");

      // Verify P2 messages
      await expect(findTimerArea(page2)).toContainText(`Waiting for ${p1} to debug`);
      await expect(findTurnArea(page2)).toContainText("your turn is next");

      // Verify P3 messages
      await expect(findTimerArea(page3)).toContainText(`Waiting for ${p1} to debug`);
      await expect(findTurnArea(page3)).toContainText(`It's ${p1}'s turn`);

      // Verify EXPLODING CLUSTER is NOT in anyone's hand
      await expect(findHandCardsByClass(page1, CardClass.ExplodingCluster)).toHaveCount(0);
      await expect(findHandCardsByClass(page2, CardClass.ExplodingCluster)).toHaveCount(0);
      await expect(findHandCardsByClass(page3, CardClass.ExplodingCluster)).toHaveCount(0);

      // Verify P1 can play DEBUG and P2, P3 cannot (or don't have one)
      const p1Debug = findHandCardsByClass(page1, CardClass.Debug);
      await expect(p1Debug.first()).toBeVisible();
      await expect(p1Debug.first()).toHaveAttribute('data-playable', 'true');
      const p2Debug = findHandCardsByClass(page2, CardClass.Debug);
      if (await p2Debug.count() > 0) {
        await expect(p2Debug.first()).toHaveAttribute('data-playable', 'false');
      }
      const p3Debug = findHandCardsByClass(page3, CardClass.Debug);
      if (await p3Debug.count() > 0) {
        await expect(p3Debug.first()).toHaveAttribute('data-playable', 'false');
      }

      // Verify no messages have been sent yet
      await expect(findLogArea(page1)).not.toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page2)).not.toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page3)).not.toContainText(`${p1}'s cluster almost exploded`);

      // P1 plays DEBUG card
      await playCard(page1, p1Debug);

      // Verify it was played and messages sent
      await expect(p1Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(p2Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(p3Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(findLogArea(page1)).not.toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page2)).not.toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page3)).not.toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page1)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page2)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page3)).toContainText(`${p1}'s cluster almost exploded`);

      // Verify the insertion dialog
      await expect(page1.locator('.modal-title')).toContainText("You're safe, for now");
      await expect(page1.locator('input[type="number"]')).toBeVisible();

      // Re-insert it
      await page1.fill('input[type="number"]', hide.toString());
      await page1.getByRole('button', { name: 'OK', exact: true }).click();

      // Verify turn advance
      await expect(findTurnArea(page1)).toContainText(`It's ${p2}'s turn`);
      await expect(findTurnArea(page2)).toContainText(`It's your turn`);
      await expect(findTurnArea(page3)).toContainText(`your turn is next`);
    }

    // Setup game
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const code = await createGame(page1, 'P1');

    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page2 = await context2.newPage();
    await joinGame(page2, 'P2', code);

    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page3 = await context3.newPage();
    await joinGame(page3, 'P3', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);
    await page3.waitForURL(/game/);

    // Play begins - we have a fixed deck for DEVMODE, so we need to get past
    // initial safe draws
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);

    // Verify everyone starts with 1 DEBUG
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P1 draws, explodes, and debugs
    const waitForAutoDismiss = async (page: Page) => {
      // Wait for auto-dismiss
      await expect(findOverlay(page)).toBeHidden();
    }
    await almostExplode("P1", page1, "P2", page2, "P3", page3, waitForAutoDismiss, 0);
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P2 draws, explodes, and debugs
    const hitEscape = async (page: Page) => {
      // Hit escape to dismiss
      await page.keyboard.press('Escape');
    }
    await almostExplode("P2", page2, "P3", page3, "P1", page1, hitEscape, 0);
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P3 draws, explodes, and debugs
    const clickSomething = async (page: Page) => {
      // Click anywhere to dismiss
      await page.click();
    }
    await almostExplode("P3", page3, "P1", page1, "P2", page2, hitEscape, 3);
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(0);

    // Play continues - some more safe draws
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);

    // P1 draws and explodes
    await drawCard(page1)

    // Verify P1 is out
    await expect(findLogArea(page1)).toContainText(`P1's cluster has exploded`);
    await expect(findLogArea(page2)).toContainText(`P1's cluster has exploded`);
    await expect(findLogArea(page3)).toContainText(`P1's cluster has exploded`);

    // Verify turn advance
    await expect(findTurnArea(page1)).toContainText(`You are OUT`);
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
    await expect(findTurnArea(page3)).toContainText(`your turn is next`);

    // Play continues (we have a fixed deck for DEVMODE)
    await drawCard(page2);
    await expect(findTurnArea(page2)).toContainText(`your turn is next`);
    await expect(findTurnArea(page3)).toContainText(`It's your turn`);
    await drawCard(page3);
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
    await expect(findTurnArea(page3)).toContainText(`your turn is next`);

    // P2 draws and explodes
    await drawCard(page2)

    // Verify P3 sees "You win!"
    await expect(page3.locator('.modal-title')).toHaveText("You win!");
    await expect(page3.locator('.modal-body')).toContainText("You have the last operational cluster");
    await page3.getByRole('button', { name: 'OK', exact: true }).click();

    // Verify other players' end of game messages
    await expect(page1.locator('.modal-title')).toHaveText("P3 wins!");
    await expect(page1.locator('.modal-body')).toContainText("P3 wins, with the last operational cluster");
    await page1.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page2.locator('.modal-title')).toHaveText("P3 wins!");
    await expect(page2.locator('.modal-body')).toContainText("P3 wins, with the last operational cluster");
    await page2.getByRole('button', { name: 'OK', exact: true }).click();
  });

  test('Drawing UPGRADE CLUSTER', async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (page: Page, hide: number) => {
      const overlay = findOverlay(page1);

      // Draw a card
      await drawCard(page1);

      // Verify overlay
      await expect(overlay).toBeVisible();

      // Dismiss overlay
      await page1.keyboard.press('Escape');
      await expect(overlay).toBeHidden();

      // Discard pile should show EXPLODING CLUSTER
      const pile = findDiscardPile(page1);
      await expect(pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify we can play DEBUG
      const debug = findHandCardsByClass(page1, CardClass.Debug);
      await expect(debug.first()).toBeVisible();
      await expect(debug.first()).toHaveAttribute('data-playable', 'true');

      // Play DEBUG card
      await playCard(page1, debug);

      // Verify it was played and messages sent
      await expect(pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.Debug);

      // Verify the insertion dialog
      await expect(page1.locator('.modal-title')).toContainText("You're safe, for now");
      await expect(page1.locator('input[type="number"]')).toBeVisible();

      // Re-insert it
      await page1.fill('input[type="number"]', hide.toString());
      await page1.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(findTurnArea(page3)).toContainText(`your turn is next`);
    }


    // Setup game
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const code = await createGame(page1, 'P1');

    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page2 = await context2.newPage();
    await joinGame(page2, 'P2', code);

    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page3 = await context3.newPage();
    await joinGame(page3, 'P3', code);

    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);
    await page3.waitForURL(/game/);

    // Play begins - we have a fixed deck for DEVMODE, so we need to get past
    // initial draws
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    // More safe draws
    await drawCard(page2);
    await drawCard(page3);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page3);

    // Give P1 another DEBUG card to test multiple DEBUGs
    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();
    await debugBtn.click();
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    const p1Overlay = findOverlay(page1);
    const p2Overlay = findOverlay(page2);
    const p3Overlay = findOverlay(page3);

    const p1Pile = findDiscardPile(page1);
    const p2Pile = findDiscardPile(page2);
    const p3Pile = findDiscardPile(page3);

    // P2 gets UPGRADE CLUSTER face-down
    await drawCard(page2);

    // Verify overlays
    await expect(p1Overlay).toBeVisible();
    await expect(p2Overlay).toBeHidden();
    await expect(p3Overlay).toBeVisible();

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify the insertion dialog
    await expect(page2.locator('.modal-title')).toContainText("back into the deck");
    await expect(page2.locator('input[type="number"]')).toBeVisible();

    // Re-insert it
    await page2.fill('input[type="number"]', "2");
    await page2.getByRole('button', { name: 'OK', exact: true }).click();

    // Safe draws
    await drawCard(page3);
    await drawCard(page1);

    // P2 gets UPGRADE CLUSTER face-up
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
    await expect(findDrawPile(page2).locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await drawCard(page2);

    // Verify P2 is out
    await expect(findLogArea(page1)).toContainText(`P2's cluster was upgraded out of existence`);
    await expect(findLogArea(page2)).toContainText(`P2's cluster was upgraded out of existence`);
    await expect(findLogArea(page3)).toContainText(`P2's cluster was upgraded out of existence`);

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify turn advance
    await expect(findTurnArea(page1)).toContainText(`your turn is next`);
    await expect(findTurnArea(page2)).toContainText(`You are OUT`);
    await expect(findTurnArea(page3)).toContainText(`It's your turn`);

    // P3 gets UPGRADE CLUSTER face-down
    await drawCard(page3);

    // Verify overlays
    await expect(p1Overlay).toBeVisible();
    await expect(p2Overlay).toBeVisible();
    await expect(p3Overlay).toBeHidden();

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify the insertion dialog
    await expect(page3.locator('.modal-title')).toContainText("back into the deck");
    await expect(page3.locator('input[type="number"]')).toBeVisible();

    // Re-insert it
    await page3.fill('input[type="number"]', "0");
    await page3.getByRole('button', { name: 'OK', exact: true }).click();

    // P1 gets UPGRADE CLUSTER face-up
    await expect(findTurnArea(page1)).toContainText(`It's your turn`);
    await expect(findDrawPile(page1).locator(`img`)).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await drawCard(page1);

    // Verify P3 sees "You win!"
    await expect(page3.locator('.modal-title')).toHaveText("You win!");
    await expect(page3.locator('.modal-body')).toContainText("You have the last operational cluster");
    await page3.getByRole('button', { name: 'OK', exact: true }).click();

    // Verify other players' end of game messages
    await expect(page1.locator('.modal-title')).toHaveText("P3 wins!");
    await expect(page1.locator('.modal-body')).toContainText("P3 wins, with the last operational cluster");
    await page1.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page2.locator('.modal-title')).toHaveText("P3 wins!");
    await expect(page2.locator('.modal-body')).toContainText("P3 wins, with the last operational cluster");
    await page2.getByRole('button', { name: 'OK', exact: true }).click();
  });

  test('Card Action: NAK', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Create game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await page1.waitForURL(/game/);
    await page2.waitForURL(/game/);

    // Verify initial hands
    const p1Shuffle = findHandCardsByClass(page1, CardClass.Shuffle).first();
    const p1Nak = findHandCardsByClass(page1, CardClass.Nak).first();
    const p2Nak = findHandCardsByClass(page2, CardClass.Nak).first();
    const p2ShuffleNow = findHandCardsByClass(page2, CardClass.ShuffleNow).first();

    await expect(p1Shuffle).toBeVisible();
    await expect(p1Nak).toBeVisible();
    await expect(p2Nak).toBeVisible();
    await expect(p2ShuffleNow).toBeVisible();

    // 1. P1 plays SHUFFLE
    await playCard(page1, p1Shuffle);
    await expect(findLogArea(page1)).toContainText('P1 played SHUFFLE');
    await expect(findLogArea(page2)).toContainText('P1 played SHUFFLE');

    // Verify reaction timer
    await expect(findTimerArea(page1)).toContainText('Waiting for other players');

    // 2. P2 plays NAK (negating SHUFFLE)
    await playCard(page2, p2Nak);
    await expect(findLogArea(page1)).toContainText('P2 played NAK');

    // 3. P1 plays NAK (negating P2's NAK)
    await playCard(page1, p1Nak);
    await expect(findLogArea(page1)).toContainText('P1 played NAK');

    // 4. P2 plays SHUFFLE_NOW (Reaction to P1's NAK)
    await playCard(page2, p2ShuffleNow);
    await expect(findLogArea(page1)).toContainText('P2 played SHUFFLE_NOW');

    // 5. P1 gets another NAK (via DEVMODE button or hand)
    // P1 started with 2 NAKs. We used one. One remains.
    const p1Nak2 = findHandCardsByClass(page1, CardClass.Nak).first();
    await expect(p1Nak2).toBeVisible();

    // 5. P1 plays NAK (negating SHUFFLE_NOW)
    await playCard(page1, p1Nak2);
    await expect(findLogArea(page1)).toContainText('P1 played NAK');

    // Wait for timer to expire
    await expect(findTimerArea(page1)).not.toContainText('Waiting for other players', { timeout: 15000 });

    // Verify Execution Logs (LIFO)
    // 1. NAK(P1) negates SHUFFLE_NOW(P2)
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing NAK played by "P1"');
    await expect(findLogArea(page1)).toContainText("P1 NAKed P2's SHUFFLE_NOW");

    // 2. NAK(P1) negates NAK(P2)
    await expect(findLogArea(page1)).toContainText('DEV: op[1]: Executing NAK played by "P1"');
    await expect(findLogArea(page1)).toContainText("P1 NAKed P2's NAK");

    // 3. SHUFFLE(P1) executes
    await expect(findLogArea(page1)).toContainText('DEV: op[2]: Executing SHUFFLE played by "P1"');
  });
});
