import { test, expect, Page, Locator } from '@playwright/test';
import { Buttons, Inputs, Headers, Locators, CSS } from './constants';
import { CardClass, TurnPhase } from '../src/api';

// Helper to wait for a page to actually load.  Without this lots of
// tests flake.
async function waitForURL(page: Page, url: string) {
  // The long timeout covers startup time.
  await expect(page).toHaveURL(url, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

// Helper to create game
// - Navigates to home page
// - Clicks "Create a new game"
// - Enters player name
// - Clicks "Create Game"
// - Verifies lobby is shown and extracts game code
async function createGame(page: Page, name: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.CREATE_NEW_GAME);
  await page.fill(Inputs.NAME, name);
  await page.click(Buttons.CREATE_GAME_CONFIRM);
  await waitForURL(page, /lobby/);
  await expect(page.locator(Headers.LOBBY_GAME_CODE)).toContainText('Lobby - Game Code:');
  const text = await page.locator(Headers.LOBBY_GAME_CODE).textContent();
  return text?.split(': ')[1].trim() as string;
}

// Helper to join game
// - Navigates to home page
// - Clicks "Join a game"
// - Enters player name and game code
// - Clicks "Join Game"
// - Verifies lobby is shown
async function joinGame(page: Page, name: string, code: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.JOIN_GAME);
  await page.fill(Inputs.NAME, name);
  await page.fill(Inputs.GAME_CODE, code);
  await page.click(Buttons.JOIN_GAME_CONFIRM);
  await waitForURL(page, /lobby/);
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible();
}

// Helper to watch game
// - Navigates to home page
// - Clicks "Watch a game"
// - Enters game code
// - Clicks "Watch Game"
// - Verifies lobby is shown
async function watchGame(page: Page, code: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.WATCH_GAME);
  await page.fill(Inputs.GAME_CODE, code);
  await page.click(Buttons.WATCH_GAME_CONFIRM);
  await waitForURL(page, /observer/);
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible();
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
  await expect(card).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
  await page.mouse.up();
}

// Helper to draw a card.
async function drawCard(page: Page) {
  await expect(findTurnArea(page)).toContainText(/^(It's your turn|You have been attacked)/);
  const drawPile = findDrawPile(page);
  const initialCount = await drawPile.getAttribute('data-drawcount');
  const count = parseInt(initialCount || '0', 10);
  await drawPile.click();
  await expect(drawPile).toHaveAttribute('data-drawcount', String(count + 1));
  await expect(findOverlay(page, "inspect-card")).toBeVisible();
  await page.waitForTimeout(200); // empirical: deflake tests
  await page.keyboard.press('Escape');
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
  return findHand(page).locator(`div[data-cardclass]`);
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
function findOverlay(page: Page, name: string): Locator {
  return page.locator(`div[data-overlayname="${name}"]`);
}

// Helper to find modal dialogs
function findModal(page: Page, name: string): Locator {
  return page.locator(`div[data-modalname="${name}"]`);
}

test.describe('UI Tests with DEVMODE=1', () => {

  test('Game screen loads: 2 players + observer', async ({ browser }) => {
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(pageObs, /observer/);

    // Verify Observer UI: Should NOT see a hand
    await expect(pageObs.locator(Headers.YOUR_HAND)).not.toBeVisible();
    // Verify Player UI: Should see a hand
    await expect(page1.locator(Headers.YOUR_HAND)).toBeVisible();
  });

  test('Fail to join: game is full', async ({ browser }) => {
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
    await page6.goto('/', { timeout: 15000 });
    await page6.click(Buttons.JOIN_GAME);
    await page6.fill(Inputs.NAME, 'Player 6');
    await page6.fill(Inputs.GAME_CODE, code);
    await page6.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "full" message
    await expect(page6.locator('.modal.show .alert-danger')).toContainText('Sorry, that game is full');
  });

  test('Fail to join: duplicate name', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Create game as 'Alice'
    const code = await createGame(page1, 'Alice');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Try to join with same name 'Alice'
    await page2.goto('/', { timeout: 15000 });
    await page2.click(Buttons.JOIN_GAME);
    await page2.fill(Inputs.NAME, 'Alice');
    await page2.fill(Inputs.GAME_CODE, code);
    await page2.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "name taken" message
    await expect(page2.locator('.modal.show .alert-danger')).toContainText('name is already taken');
  });

  test('Fail to join: unknown game code', async ({ browser }) => {
    const page = await browser.newPage();
    // Attempt to join invalid code 'YYYYY'
    await page.goto('/', { timeout: 15000 });
    await page.click(Buttons.JOIN_GAME);
    await page.fill(Inputs.NAME, 'Bob');
    await page.fill(Inputs.GAME_CODE, 'YYYYY');
    await page.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator('.modal.show .alert-danger')).toContainText('does not exist');
  });

  test('Fail to observe: unknown game coee', async ({ browser }) => {
    const page = await browser.newPage();
    // Attempt to watch invalid code 'YYYYY'
    await page.goto('/', { timeout: 15000 });
    await page.click(Buttons.WATCH_GAME);
    await page.fill(Inputs.GAME_CODE, 'YYYYY');
    await page.click(Buttons.WATCH_GAME_CONFIRM);
    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator('.modal.show .alert-danger')).toContainText('does not exist');
  });

  test('Lobby: disconnect, reconnect', async ({ browser }) => {
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
    await waitForURL(page2, /lobby/);

    // Host sees 'Leaver' again in the list
    await expect(page1.locator('text=Leaver')).toBeVisible();
  });

  test('Lobby: disconnect, reconnect fails after nonce change', async ({ browser }) => {
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
    await expect(findModal(page2, "rejoin-error")).toBeVisible();
  });

  test('Lobby: game owner reassignment', async ({ browser }) => {
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
    await expect(findModal(page2, "lobby-host-promotion")).toBeVisible();

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

  test('Game page: initial UI', async ({ browser }) => {
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

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

  test('Hand: card wrapping', async ({ browser }) => {
    // Create game
    // Set viewport to constrain hand width to approx 7 cards to force wrapping
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 800 } });
    const page = await ctx1.newPage();
    const code = await createGame(page, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    // Start Game
    await page.click(Buttons.START_GAME);
    await waitForURL(page, /game/);

    // Wait for hand to render and verify initial count (8)
    const handArea = findHand(page);
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

  test('Players leave game', async ({ browser }) => {
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

    // Verify P1 starts
    await expect(page1.locator('.list-group-item:has-text("P1")')).toHaveClass(/bg-success-subtle/);
    await expect(findTurnArea(page1)).toContainText("It's your turn");
    await expect(findTurnArea(page2)).toContainText("It's P1's turn, your turn is next");
    await expect(findTurnArea(page3)).toContainText("It's P1's turn");

    // P1 (current) disconnects
    await page1.goto('about:blank');

    // Verify disconnected player disappears from list
    await expect(page2.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();
    await expect(page3.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();

    // Verify "abandoned turn" message
    await expect(page2.locator(`text=P1 has abandoned their turn`)).toBeVisible();
    await expect(page3.locator(`text=P1 has abandoned their turn`)).toBeVisible();

    // Verify turn passes to next player
    await expect(findTurnArea(page2)).toContainText("It's your turn");
    await expect(findTurnArea(page3)).toContainText("It's P2's turn, your turn is next");

    // Reconnect attempt by disconnected player
    await page1.goBack();
    await page1.waitForLoadState('networkidle');

    // Verify Rejoin Fails (Error Modal)
    const modal = findModal(page1, "rejoin-error");
    await expect(modal).toBeVisible();

    // Verify player does NOT reappear in list
    await expect(page2.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();
    await expect(page3.locator(`.list-group-item:has-text("P1")`)).not.toBeVisible();

    // P2 leaves game voluntarily
    await page2.click(Buttons.LEAVE_GAME);
    // Confirm modal
    const leaveModal = findModal(page2, "leave-game");
    await expect(leaveModal).toBeVisible();
    await leaveModal.locator(' .modal-footer button.btn-danger').click();

    // Winner should see Win Dialog
    const winModal = findModal(page3, "game-end");
    await expect(winModal).toBeVisible();
    await expect(winModal.locator(' .modal-title')).toContainText("You win!");
    await page3.click(Buttons.OK);
    await waitForURL(page3, '/');
  });

  test('Hand: dismiss inspect-card overlay', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Wait for hand to be visible and have cards
    const handArea = findHand(page1)
    await expect(handArea).toBeVisible();
    await expect(findAllHandCards(page1)).toHaveCount(8);
    const cardImg = handArea.locator('img').first();

    // Double-click first card to open overlay
    await cardImg.dblclick({ force: true });

    // Check for overlay
    await expect(findOverlay(page1, "inspect-card")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press('Escape');
    await expect(findOverlay(page1, "inspect-card")).toBeHidden();

    // Double-click first card to open overlay again
    await cardImg.dblclick({ force: true });

    // Check for overlay
    await expect(findOverlay(page1, "inspect-card")).toBeVisible();

    // Click the overlay to dismiss
    await findOverlay(page1, "inspect-card").click();
    await expect(findOverlay(page1, "inspect-card")).toBeHidden();
  });

  test('DEVMODE: DEBUG Button limit', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'Dev');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);

    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();

    // Click until disabled (consuming all debug cards)
    for (let i=0; i<10; i++) {
      await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1 + i);
      if (await debugBtn.isDisabled()) break;
      await debugBtn.click();
      await page1.waitForTimeout(200);
    }

    await expect(debugBtn).toBeDisabled();
  });

  test('DEVMODE: put card back', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);

    // Verify initial hand count (8)
    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Get initial deck count from UI text (e.g. "(30 cards)")
    const deckCountText = await page1.locator(Locators.DRAW_PILE_COUNT).textContent();
    const initialDeckCount = parseInt(deckCountText?.replace(/\D/g, '') || '0', 10);

    const putBackBtn = page1.locator(Buttons.DEV_PUT_CARD_BACK);
    await expect(putBackBtn).toBeVisible();
    await expect(putBackBtn).toBeEnabled();

    // Click until disabled, verify hand count decreased and deck count
    // increased
    for (let i=0; i<10; i++) {
      await expect(findAllHandCards(page1)).toHaveCount(8 - i);
      await expect(page1.locator(Locators.DRAW_PILE_COUNT)).toHaveText(`(${initialDeckCount + i} cards)`);
      if (await putBackBtn.isDisabled()) break;
      await putBackBtn.click();
      await page1.waitForTimeout(200);
    }
    await expect(handArea.locator('img')).toHaveCount(0);
    await expect(page1.locator(Locators.DRAW_PILE_COUNT)).toHaveText(`(${initialDeckCount + 8} cards)`);
  });

  test('DEVMODE: dismiss show-deck overlay', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);

    // Click "Show the deck" button
    await page1.click(Buttons.DEV_SHOW_DECK);

    // Check for overlay
    await expect(findOverlay(page1, "show-deck")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press('Escape');
    await expect(findOverlay(page1, "show-deck")).toBeHidden();

    // Click "Show the deck" button again
    await page1.click(Buttons.DEV_SHOW_DECK);

    // Check for overlay
    await expect(findOverlay(page1, "show-deck")).toBeVisible();

    // Click the overlay to dismiss
    await findOverlay(page1, "show-deck").click();
    await expect(findOverlay(page1, "show-deck")).toBeHidden();
  });

  test('DEVMODE: dismiss show-removed overlay', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);

    // Click "Show removed cards" button
    await page1.click(Buttons.DEV_SHOW_REMOVED);

    // Check for overlay
    await expect(findOverlay(page1, "show-removed")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press('Escape');
    await expect(findOverlay(page1, "show-removed")).toBeHidden();

    // Click "Show removed cards" button again
    await page1.click(Buttons.DEV_SHOW_REMOVED);

    // Check for overlay
    await expect(findOverlay(page1, "show-removed")).toBeVisible();

    // Click the overlay to dismiss
    await findOverlay(page1, "show-removed").click();
    await expect(findOverlay(page1, "show-removed")).toBeHidden();
  });

  test('Hand: card selection. deselection', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const code = await createGame(page, 'FocusTest');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page.click(Buttons.START_GAME);
    await waitForURL(page, /game/);

    // Wait for hand to populate
    await expect(findAllHandCards(page)).toHaveCount(8);

    // Find pair of DEVELOPER cards (in the fixed deck)
    const devCards = findHandCardsByClass(page, CardClass.Developer);
    const count = await devCards.count();
    expect(count).toEqual(3);

    let firstPairIndex = -1;
    let secondPairIndex = -1;

    for (let i = 0; i < count; i++) {
      const src = await devCards.nth(i).locator("img").getAttribute('src');
      for (let j = i + 1; j < count; j++) {
        const src2 = await devCards.nth(j).locator("img").getAttribute('src');
        if (src === src2) {
          firstPairIndex = i;
          secondPairIndex = j;
          break;
        }
      }
      if (firstPairIndex !== -1) break;
    }

    expect(firstPairIndex).not.toBe(-1);
    expect(secondPairIndex).not.toBe(-1);
    const pair1 = devCards.nth(firstPairIndex);
    const pair2 = devCards.nth(secondPairIndex);

    // Find another playable card
    const other = findHandCardsByClass(page, CardClass.Shuffle);

    // Select first
    await pair1.click();
    await expect(pair1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Shift-click second
    await page.keyboard.down('Shift');
    await pair2.click();
    await page.keyboard.up('Shift');

    // Verify selection style
    await expect(pair1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Press shift again to check focus ring remains (regression)
    await page.keyboard.down('Shift');
    const parent = pair2.locator('xpath=..');
    await expect(parent).toHaveCSS('outline-style', 'none');
    await page.keyboard.up('Shift');
    await expect(parent).toHaveCSS('outline-style', 'none');
    await expect(pair1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Shift-click other, does nothing
    await page.keyboard.down('Shift');
    await other.click();
    await page.keyboard.up('Shift');
    await expect(pair1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Click other deselects the pair
    await other.click();
    await page.waitForTimeout(10000);
    await expect(pair1).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Click text "Your Hand" (empty space/container header) to deselect
    await page.click(Headers.YOUR_HAND);

    // Verify all cards are deselected
    await expect(pair1).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
  });

  test('Hand: drag unselected card', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const code = await createGame(page1, 'FocusTest');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);

    // Wait for hand to populate
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Locate two different cards (FAVOR and SHUFFLE)
    const favorCard = findHandCardsByClass(page1, CardClass.Favor);
    const shuffleCard = findHandCardsByClass(page1, CardClass.Shuffle);
    await expect(favorCard).toBeVisible();
    await expect(shuffleCard).toBeVisible();

    // Click to select FAVOR
    await favorCard.click();
    await expect(favorCard).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Drag SHUFFLE
    const srcBox = await shuffleCard.boundingBox();

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(srcBox.x + srcBox.width * 2, srcBox.y + srcBox.height / 2);

    // Verify selection
    await expect(favorCard).not.toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await page1.keyboard.press('Escape'); // cancel drag
    await expect(shuffleCard).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
  });

  test('Hand: reorder cards', async ({ browser }) => {
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

    // Use a player who is NOT current turn to perform reorder
    const handArea = findHand(page2)
    await expect(handArea).toBeVisible();
    await expect(findAllHandCards(page2)).toHaveCount(8);

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

  test('Hand: multi-card reorder', async ({ browser }) => {
    const viewport = { width: 1200, height: 800 };
    const ctx1 = await browser.newContext({ viewport });
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const handArea = findHand(page1);
    await expect(handArea).toBeVisible();
    await expect(findAllHandCards(page1)).toHaveCount(8);

    const devCards = findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);

    let firstPairIndex = -1;
    let secondPairIndex = -1;
    let pairSrc = '';

    for (let i = 0; i < 8; i++) {
      const src = await devCards.nth(i).locator("img").getAttribute('src');
      for (let j = i + 1; j < 8; j++) {
        const src2 = await devCards.nth(j).locator("img").getAttribute('src');
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
    expect(pairSrc).not.toBe("");
    const card1 = devCards.nth(firstPairIndex);
    const card2 = devCards.nth(secondPairIndex);

    // Select first card
    await card1.click();
    await expect(card1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

    // Shift-click second card to multi-select
    await page1.keyboard.down('Shift');
    await card2.click();
    await page1.keyboard.up('Shift');

    // Verify both are selected
    await expect(card1).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(card2).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);

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
    const newLast = findAllHandCards(page1).last().locator("img");
    const newNextLast = findAllHandCards(page1).nth(-2).locator("img");
    expect(await newLast.getAttribute('src')).toBe(pairSrc);
    expect(await newNextLast.getAttribute('src')).toBe(pairSrc);

    // Verify selection persists
    await expect(newLast.locator('xpath=..')).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
    await expect(newNextLast.locator('xpath=..')).toHaveCSS('box-shadow', CSS.CARD_SELECTED_BOX);
  });

  // TODO: Run this in non-devmode
  test('Hand: Verify initial state', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);

    // Verify initial card counts are 8 for both
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Verify each player has at least 1 DEBUG card
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);

    //TODO: verify playability of each card class (DEVMODE)
  });

  test('Game page: layout stability', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);

    // Wait for initial layout
    await page1.waitForSelector(Locators.DRAW_PILE_COUNT);

    // Locators for areas
    // The green table area (Col md=9)
    const tableArea = page1.locator('div[style*="background-color: rgb(34, 139, 34)"]');
    // The fixed height message container
    const messageArea = findLogArea(page1).locator('xpath=..');
    // The hand container (bg-light, fixed height)
    const handArea = page1.locator(Headers.YOUR_HAND).locator('xpath=..');

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
      await page1.click(Buttons.DEV_GIVE_SAFE_CARD);
    }

    // Wait a bit for any layout settling
    await page1.waitForTimeout(500);

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

  test('Draw: regular card', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Ensure it's P1's turn
    await expect(findTurnArea(page1)).toContainText(`It's your turn`);
    await expect(findTurnArea(page2)).toContainText(`your turn is next`);
    await expect(findAllHandCards(page1)).toHaveCount(8);

    // Click draw pile
    await findDrawPile(page1).click();

    // Verify Animation on P1
    const p1AnimatedHandCard = page1.locator(Locators.HAND_ANIMATION_CARD);
    await expect(p1AnimatedHandCard).toBeVisible();
    await expect(p1AnimatedHandCard).toHaveAttribute('src', /back\.png/);

    // Verify Animation on P2
    const p2AnimatedHandCard = page2.locator(Locators.HAND_ANIMATION_CARD);
    await expect(p2AnimatedHandCard).toBeVisible();
    await expect(p2AnimatedHandCard).toHaveAttribute('src', /back\.png/);

    // Verify overlay on P1
    await expect(findOverlay(page1, "inspect-card")).toBeVisible();
    await page1.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page1, "inspect-card")).toBeHidden();

    // Verify hand count +1
    await expect(findAllHandCards(page1)).toHaveCount(9);

    // Verify log message indicating turn advancement
    await expect(findLogArea(page1)).toContainText(`P1 drew a card`);
    await expect(findLogArea(page2)).toContainText(`P1 drew a card`);

    // Verify turn passed to P2
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
  });

  test('Draw: dismiss drawn-card overlay', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await createGame(page1, 'P1');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code);

    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // P1 draws a card
    await findDrawPile(page1).click();

    // Verify overlay appears
    const p1Overlay = findOverlay(page1, "inspect-card");
    await expect(p1Overlay).toBeVisible();

    // Click to dismiss (should disappear immediately)
    await p1Overlay.click();
    await expect(p1Overlay).toBeHidden();

    // Verify turn passes to P2
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);

    // P2 draws a card
    await findDrawPile(page2).click();

    // Verify overlay appears
    const p2Overlay = findOverlay(page2, "inspect-card");
    await expect(p2Overlay).toBeVisible();

    // Press <escape> to dismiss
    await page2.keyboard.press('Escape');
    await expect(p2Overlay).toBeHidden();

    // Verify turn passes to P1
    await expect(findTurnArea(page1)).toContainText(`It's your turn`);

    // P1 draws a card
    await findDrawPile(page1).click();

    // Verify overlay appears
    await expect(p1Overlay).toBeVisible();

    // Do nothing to dismiss (should disappear automatically in time)
    await expect(p1Overlay).toBeHidden();
  });

  // This test proves the basic game play loop - action/reaction/resolution -
  // works.  It uses NAK because NAK is the simplest card and has no effect
  // when played as an action.
  test('Play: NAK action, NAK reaction', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify P1's NAK cards are playable
    const p1Naks = findHandCardsByClass(page1, CardClass.Nak);
    await expect(p1Naks).toHaveCount(2);
    await expect(p1Naks.nth(0)).toHaveAttribute('data-playable', 'true');
    await expect(p1Naks.nth(1)).toHaveAttribute('data-playable', 'true');

    // Verify P2's NAK card is not playable
    const p2Naks = findHandCardsByClass(page2, CardClass.Nak);
    await expect(p2Naks).toHaveCount(1);
    await expect(p2Naks.nth(0)).toHaveAttribute('data-playable', 'false');

    let lastNak = "";

    // 1. P1 plays NAK, start reaction phase
    await playCard(page1, p1Naks.nth(1));

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(findLogArea(page1)).toContainText('P1 played NAK');
    await expect(findLogArea(page2)).toContainText('P1 played NAK');
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator('img')).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator('img').getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P2's NAK is playable
    await expect(p2Naks.nth(0)).toHaveAttribute('data-playable', 'true');

    // 2. P2 plays NAK, restart reaction phase
    await playCard(page2, p2Naks.nth(0));

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(findLogArea(page1)).toContainText('P2 played NAK');
    await expect(findLogArea(page2)).toContainText('P2 played NAK');
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator('img')).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator('img').getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Want to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Waiting for other players to react');

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify that P1's NAK is playable
    await expect(p1Naks.nth(0)).toHaveAttribute('data-playable', 'true');

    // 3. P1 plays NAK, restart reaction phase
    await playCard(page1, p1Naks.nth(0));

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(6);
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(findLogArea(page1)).toContainText('P1 played NAK');
    await expect(findLogArea(page2)).toContainText('P1 played NAK');
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator('img')).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator('img').getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing NAK played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing NAK played by "P1"');
    await expect(findLogArea(page1)).toContainText("P1 NAKed P2's NAK");
    await expect(findLogArea(page2)).toContainText("P1 NAKed P2's NAK");
    await expect(findLogArea(page1)).toContainText('DEV: op[1]: Executing NAK played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[1]: Executing NAK played by "P1"');
  });

  test('Play: SHUFFLE', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Find P1's SHUFFLE card
    const p1Card = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Card).toBeVisible();

    // P1 plays SHUFFLE, start reaction phase
    await playCard(page1, p1Card);

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(findLogArea(page1)).toContainText('P1 played SHUFFLE');
    await expect(findLogArea(page2)).toContainText('P1 played SHUFFLE');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE played by "P1"');
    await expect(findLogArea(page1)).toContainText("The deck was shuffled");
    await expect(findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test('Play: SHUFFLE NOW', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Find P2's SHUFFLE_NOW card
    const p2Card = findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2Card).toBeVisible();

    // P1 draws (P2 has the card we want)
    await drawCard(page1);
    await expect(findAllHandCards(page1)).toHaveCount(9);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Verify turn advance
    await expect(findTurnArea(page1)).toContainText(`It's P2's turn`);
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);

    // P2 plays SHUFFLE_NOW, start reaction phase
    await playCard(page2, p2Card);

    // Verify UI
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(findLogArea(page1)).toContainText('P2 played SHUFFLE_NOW');
    await expect(findLogArea(page2)).toContainText('P2 played SHUFFLE_NOW');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Want to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Waiting for other players to react');

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(findLogArea(page1)).toContainText("The deck was shuffled");
    await expect(findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test('Play: SHUFFLE NOW by non-current player', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Find P2's SHUFFLE_NOW card
    const p2Card = findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2Card).toBeVisible();

    // P2 plays SHUFFLE_NOW, start reaction phase
    await playCard(page2, p2Card);

    // Verify UI
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(findLogArea(page1)).toContainText('P2 played SHUFFLE_NOW');
    await expect(findLogArea(page2)).toContainText('P2 played SHUFFLE_NOW');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Want to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Waiting for other players to react');

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test('Play: racing NAKs', async ({ browser }) => {
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

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

    // P3 plays NAK, restart reaction phase, updates nonce to N2
    await playCard(page3, p3Nak);
    await expect(findLogArea(page2)).toContainText('P3 played NAK');

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);

    // P2 finishes their play, drops NAK, but sends nonce N1
    await page2.mouse.move(p2DstBox.x + p2DstBox.width / 2, p2DstBox.y + p2DstBox.height / 2);
    await page2.mouse.up();

    // Verify rejection dialog on P2
    const retryModal = findModal(page2, "retry-play");
    await expect(retryModal).toBeVisible();

    // P2 retries (Click OK)
    await retryModal.getByRole('button', { name: 'Play it!' }).click();

    // Verify P2 played
    await expect(findLogArea(page1)).toContainText('P2 played NAK');
  });

  test('Play: exhaustive action, reaction', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const timerArea = findTimerArea(page1);
    await expect(timerArea).toBeHidden();

    // Verify P1's lone DEVELOPER is not playable but others are.
    const p1Shuffle = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Shuffle).toHaveAttribute('data-playable', 'true');
    const p1Nak = findHandCardsByClass(page1, CardClass.Nak).first();
    await expect(p1Nak).toHaveAttribute('data-playable', 'true');

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

  test('Play: SHUFFLE action, NAK reaction', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Find P1's SHUFFLE card
    const p1Card = findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Card).toBeVisible();

    // Find P2's NAK card
    const p2Card = findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Card).toBeVisible();

    // 1. P1 plays SHUFFLE, start reaction phase
    await playCard(page1, p1Card);

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(findLogArea(page1)).toContainText('P1 played SHUFFLE');
    await expect(findLogArea(page2)).toContainText('P1 played SHUFFLE');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // 2. P2 plays NAK (negating SHUFFLE)
    await playCard(page2, p2Card);

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(findLogArea(page1)).toContainText('P2 played NAK');
    await expect(findLogArea(page2)).toContainText('P2 played NAK');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Want to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Waiting for other players to react');

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing NAK played by "P2"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing NAK played by "P2"');
    await expect(findLogArea(page1)).toContainText("P2 NAKed P1's SHUFFLE");
    await expect(findLogArea(page2)).toContainText("P2 NAKed P1's SHUFFLE");
  });

  test('Play: FAVOR (2 players)', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await page1.waitForLoadState('networkidle'); // Wait for page to fully load
    await page2.waitForLoadState('networkidle'); // Wait for page to fully load

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Verify P1 has a FAVOR
    const favorCard = findHandCardsByClass(page1, CardClass.Favor).first();
    await expect(favorCard).toBeVisible();

    // P1 plays FAVOR
    await playCard(page1, favorCard);

    // Verify the choose-victim modal DOES NOT appear
    const chooseVictimModal = findModal(page1, "favor-choose-victim");
    await expect(chooseVictimModal).not.toBeVisible();

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(findLogArea(page1)).toContainText('P1 asked P2 for a favor');
    await expect(findLogArea(page2)).toContainText('P1 asked P2 for a favor');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify card choice modal on P2
    const chooseCardModal = findModal(page2, "favor-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify P2 hand is shown
    await expect(page2.locator('.modal-body img')).toHaveCount(8); // P2 had 8 cards

    // P2 chooses first card
    await page2.locator('.modal-body div[style*="cursor: pointer"]').first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify P1 sees overlay
    await expect(findOverlay(page1, "favor-result")).toBeVisible();
    await expect(findOverlay(page1, "favor-result")).toContainText('You received:');
    await expect(page1.locator('h2')).toContainText('You received:');
    await page1.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page1, "favor-result")).toBeHidden();

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page1)).toContainText('P2 gave P1 a card.');
    await expect(findLogArea(page2)).toContainText('P2 gave P1 a card.');

    // Verify Counts
    await expect(findAllHandCards(page1)).toHaveCount(8); // 8 start - 1 played + 1 received
    await expect(findAllHandCards(page2)).toHaveCount(7); // 8 - 1
  });

  test('Play: FAVOR (4 players)', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context4 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    const page4 = await context4.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await joinGame(page3, 'P3', code);
    await joinGame(page4, 'P4', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);
    await waitForURL(page4, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(findAllHandCards(page3)).toHaveCount(8);
    await expect(findAllHandCards(page4)).toHaveCount(8);

    // Verify P1 has a FAVOR
    const favorCard = findHandCardsByClass(page1, CardClass.Favor).first();
    await expect(favorCard).toBeVisible();

    // Make sure P3 has no cards
    for (let i = 0; i < 8; i++) {
      await page3.click(Buttons.DEV_PUT_CARD_BACK);
      await expect(findAllHandCards(page3)).toHaveCount(8-(i+1));
    }
    await expect(findAllHandCards(page3)).toHaveCount(0);

    // P1 plays FAVOR
    await playCard(page1, favorCard);

    // Verify the choose-victim modal appears
    const chooseVictimModal = findModal(page1, "favor-choose-victim");
    await expect(chooseVictimModal).toBeVisible();
    // Verify player list: P2 should be present, P3 (empty hand) and P1 (self) should not.
    const modalBody = chooseVictimModal.locator('.modal-body');
    await expect(modalBody.locator('.list-group-item', { hasText: 'P1' })).not.toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P2' })).toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P3' })).not.toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P4' })).toBeVisible();

    // Select P2
    await page1.click('text=P2 (8 cards)');
    await page1.click('button:has-text("Ask Favor")');

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(7);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(findAllHandCards(page3)).toHaveCount(0);
    await expect(findAllHandCards(page4)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(findLogArea(page1)).toContainText('P1 asked P2 for a favor');
    await expect(findLogArea(page2)).toContainText('P1 asked P2 for a favor');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify card choice modal on P2
    const chooseCardModal = findModal(page2, "favor-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify P2 hand is shown
    await expect(page2.locator('.modal-body img')).toHaveCount(8); // P2 had 8 cards

    // P2 chooses first card
    await page2.locator('.modal-body div[style*="cursor: pointer"]').first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify P1 sees overlay
    await expect(findOverlay(page1, "favor-result")).toBeVisible();
    await expect(findOverlay(page1, "favor-result")).toContainText('You received:');
    await expect(page1.locator('h2')).toContainText('You received:');
    await page1.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page1, "favor-result")).toBeHidden();

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page3)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page4)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(findLogArea(page1)).toContainText('P2 gave P1 a card.');
    await expect(findLogArea(page2)).toContainText('P2 gave P1 a card.');
    await expect(findLogArea(page3)).toContainText('P2 gave P1 a card.');
    await expect(findLogArea(page4)).toContainText('P2 gave P1 a card.');

    // Verify Counts
    await expect(findAllHandCards(page1)).toHaveCount(8); // 8 start - 1 played + 1 received
    await expect(findAllHandCards(page2)).toHaveCount(7); // 8 - 1
    await expect(findAllHandCards(page3)).toHaveCount(0);
    await expect(findAllHandCards(page4)).toHaveCount(8);
  });

  test('Play: DEVELOPER 2x Combo (2 players)', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Verify P1 hand
    const devCards = findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);

    // Find the pair
    let firstPairIndex = -1;
    let secondPairIndex = -1;
    const count = await devCards.count();
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

    // Select Pair
    await card1.click();
    await page1.keyboard.down('Shift');
    await card2.click();
    await page1.keyboard.up('Shift');

    // Drag to Discard
    const discardPile = findDiscardPile(page1);
    const srcBox = await card1.boundingBox();
    const dstBox = await discardPile.boundingBox();
    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // Verify victim modal DOES NOT appear
    const chooseVictimModal = findModal(page1, "steal-choose-victim");
    await expect(chooseVictimModal).not.toBeVisible();

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(6);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(findLogArea(page1)).toContainText('P1 wants to steal a card from P2');
    await expect(findLogArea(page2)).toContainText('P1 wants to steal a card from P2');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify Card Choice Modal on P1
    const chooseCardModal = findModal(page1, "steal-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify card backs (P2 has 8 cards)
    await expect(page1.locator('.modal-body img')).toHaveCount(8);

    // Pick first card
    await chooseCardModal.locator('.modal-body div[style*="cursor: pointer"]').first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify overlays
    await expect(findOverlay(page1, "combo-result")).toBeVisible();
    await expect(findOverlay(page1, "combo-result")).toContainText('You stole:');
    await expect(findOverlay(page2, "combo-result")).toBeVisible();
    await expect(findOverlay(page2, "combo-result")).toContainText('P1 stole your:');
    await page1.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page1, "combo-result")).toBeHidden();
    await page2.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page2, "combo-result")).toBeHidden();

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page1)).toContainText('P1 stole a card from P2');
    await expect(findLogArea(page2)).toContainText('P1 stole a card from P2');

    // Verify Counts
    await expect(findAllHandCards(page1)).toHaveCount(7); // 8 start - 2 played + 1 received
    await expect(findAllHandCards(page2)).toHaveCount(7); // 8 - 1
  });

  test('Play: DEVELOPER 2x Combo (4 players)', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context4 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    const page4 = await context4.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await joinGame(page3, 'P3', code);
    await joinGame(page4, 'P4', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);
    await waitForURL(page4, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(findAllHandCards(page3)).toHaveCount(8);
    await expect(findAllHandCards(page4)).toHaveCount(8);

    // Verify P1 hand
    const devCards = findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);

    // Find the pair
    let firstPairIndex = -1;
    let secondPairIndex = -1;
    const count = await devCards.count();
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

    // Make sure P3 has no cards
    for (let i = 0; i < 8; i++) {
      await page3.click(Buttons.DEV_PUT_CARD_BACK);
      await expect(findAllHandCards(page3)).toHaveCount(8-(i+1));
    }
    await expect(findAllHandCards(page3)).toHaveCount(0);

    // Select Pair
    await card1.click();
    await page1.keyboard.down('Shift');
    await card2.click();
    await page1.keyboard.up('Shift');

    // Drag to Discard
    const discardPile = findDiscardPile(page1);
    const srcBox = await card1.boundingBox();
    const dstBox = await discardPile.boundingBox();
    if (!srcBox || !dstBox) throw new Error('Missing bounding box');

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // Verify Victim Modal appears
    const chooseVictimModal = findModal(page1, "steal-choose-victim");
    await expect(chooseVictimModal).toBeVisible();
    // Verify player list: P2 should be present, P3 (empty hand) and P1 (self) should not.
    const modalBody = chooseVictimModal.locator('.modal-body');
    await expect(modalBody.locator('.list-group-item', { hasText: 'P1' })).not.toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P2' })).toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P3' })).not.toBeVisible();
    await expect(modalBody.locator('.list-group-item', { hasText: 'P4' })).toBeVisible();

    // Select P2
    await page1.click('text=P2 (8 cards)');
    await page1.click('button:has-text("Steal Card")');

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(6);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(findAllHandCards(page3)).toHaveCount(0);
    await expect(findAllHandCards(page4)).toHaveCount(8);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(findLogArea(page1)).toContainText('P1 wants to steal a card from P2');
    await expect(findLogArea(page2)).toContainText('P1 wants to steal a card from P2');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Waiting for other players to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Want to react');

    // Verify that none of P1's cards are playable
    for (const card of await findAllHandCards(page1).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // Verify Card Choice Modal on P1
    const chooseCardModal = findModal(page1, "steal-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify card backs (P2 has 8 cards)
    await expect(page1.locator('.modal-body img')).toHaveCount(8);

    // Pick first card
    await chooseCardModal.locator('.modal-body div[style*="cursor: pointer"]').first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify overlays
    await expect(findOverlay(page1, "combo-result")).toBeVisible();
    await expect(findOverlay(page1, "combo-result")).toContainText('You stole:');
    await expect(findOverlay(page2, "combo-result")).toBeVisible();
    await expect(findOverlay(page2, "combo-result")).toContainText('P1 stole your:');
    await page1.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page1, "combo-result")).toBeHidden();
    await page2.keyboard.press('Escape'); // dismiss
    await expect(findOverlay(page2, "combo-result")).toBeHidden();

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page3)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page4)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(findLogArea(page1)).toContainText('P1 stole a card from P2');
    await expect(findLogArea(page2)).toContainText('P1 stole a card from P2');
    await expect(findLogArea(page3)).toContainText('P1 stole a card from P2');
    await expect(findLogArea(page4)).toContainText('P1 stole a card from P2');

    // Verify Counts
    await expect(findAllHandCards(page1)).toHaveCount(7); // 8 start - 2 played + 1 received
    await expect(findAllHandCards(page2)).toHaveCount(7); // 8 - 1
    await expect(findAllHandCards(page3)).toHaveCount(0);
    await expect(findAllHandCards(page4)).toHaveCount(8);
  });

  test('Play: SEE THE FUTURE', async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    const p1TimerArea = findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = findDiscardPile(page1);
    await expect(p1DiscardPile.locator('img')).not.toBeVisible();
    const p2DiscardPile = findDiscardPile(page2);
    await expect(p2DiscardPile.locator('img')).not.toBeVisible();

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // P2 has the SEE THE FUTURE card
    await drawCard(page1);
    await expect(findTurnArea(page1)).toContainText(`your turn is next`);
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);

    // Show the deck to get top 3 cards
    await page2.click(Buttons.DEV_SHOW_DECK);
    const deckOverlay = findOverlay(page2, "show-deck");
    await expect(deckOverlay).toBeVisible();
    const deckCards = await deckOverlay.locator('img').all();
    const top3CardClasses = await Promise.all(deckCards.slice(0, 3).map(async (img) => await img.getAttribute('alt')));
    await page2.keyboard.press('Escape'); // Dismiss deck view

    // P2 plays SEE THE FUTURE
    const card = findHandCardsByClass(page2, CardClass.SeeTheFuture);
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await playCard(page2, card);

    // Verify UI
    await expect(findAllHandCards(page1)).toHaveCount(9);
    await expect(findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.SeeTheFuture);
    await expect(p2DiscardPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.SeeTheFuture);
    await expect(findLogArea(page1)).toContainText('P2 played SEE_THE_FUTURE');
    await expect(findLogArea(page2)).toContainText('P2 played SEE_THE_FUTURE');

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText('Want to react');
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute('data-turnphase', TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText('Waiting for other players to react');

    // Verify that none of P2's cards are playable
    for (const card of await findAllHandCards(page2).all()) {
        await expect(card).toHaveAttribute('data-playable', 'false');
    }

    // P1 should NOT see the overlay
    await expect(findOverlay(page1, "see-the-future")).not.toBeVisible();

    // Verify P2 sees See The Future overlay
    const p2SeeTheFutureOverlay = findOverlay(page2, "see-the-future");
    await expect(p2SeeTheFutureOverlay).toBeVisible();
    await expect(p2SeeTheFutureOverlay.locator('h2')).toContainText('See The Future');
    const cardsInOverlay = p2SeeTheFutureOverlay.locator('img');
    await expect(cardsInOverlay).toHaveCount(3);

    // Verify the cards in the overlay are the top 3 from the deck
    const allCardsInOverlay = await cardsInOverlay.all();
    const overlayCardAlts = await Promise.all(allCardsInOverlay.map(async (img) => await img.getAttribute('alt')));
    expect(overlayCardAlts[0]).toContain(top3CardClasses[0]);
    expect(overlayCardAlts[1]).toContain(top3CardClasses[1]);
    expect(overlayCardAlts[2]).toContain(top3CardClasses[2]);

    // P2 dismisses overlay
    await page2.keyboard.press('Escape');

    // Verify P2 overlay is gone
    await expect(findOverlay(page2, "see-the-future")).toBeHidden();

    // Verify execution
    await expect(findLogArea(page1)).toContainText('DEV: op[0]: Executing SEE_THE_FUTURE played by "P2"');
    await expect(findLogArea(page2)).toContainText('DEV: op[0]: Executing SEE_THE_FUTURE played by "P2"');
    await expect(findLogArea(page1)).toContainText('P2 saw the future');
    await expect(findLogArea(page2)).toContainText('P2 saw the future');
  });

  test('Play: SKIP', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const context2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);

    // P2 plays SKIP
    const p2Skip = findHandCardsByClass(page2, CardClass.Skip);
    await expect(p2Skip).toHaveCount(1);
    await playCard(page2, p2Skip);

    // Turn should change to P1 without a draw.
    await expect(findTurnArea(page1)).toContainText("It's your turn");
  });

  test('Play: ATTACK', async ({ browser }) => {
    test.setTimeout(60000);

    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);

    // P2 plays ATTACK
    const p2Attack = findHandCardsByClass(page2, CardClass.Attack);
    await expect(p2Attack).toHaveCount(1);
    await playCard(page2, p2Attack);

    // Wait for P1 turn and verify 2 turns
    await expect(findTurnArea(page1)).toContainText("You have been attacked! You must take 2 turns");

    // P1 plays ATTACK, stacking
    const p1Attack = findHandCardsByClass(page1, CardClass.Attack);
    await expect(p1Attack).toHaveCount(1);
    await playCard(page1, p1Attack);

    // Wait for P2 turn and verify 4 turns
    await expect(findTurnArea(page2)).toContainText("You have been attacked! You must take 4 turns");

    // P2 plays SKIP, consuming 1 turn
    const p2Skip = findHandCardsByClass(page2, CardClass.Skip);
    await expect(p2Skip).toHaveCount(1);
    await playCard(page2, p2Skip);

    // Wait for reaction/execution and verify 3 turns remaining
    // Since it's still P2's turn, we wait for the text update
    await expect(findTurnArea(page2)).toContainText("You have been attacked! You must take 3 more turns");

    // P2 Draws
    await drawCard(page2);

    // Verify 2 turns remaining
    await expect(findTurnArea(page2)).toContainText("You have been attacked! You must take 2 more turns");
  });

  test('Play: ATTACK vs. EXPLODING and UPGRADE CLUSTER', async ({ browser }) => {
    test.setTimeout(60000);

    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await createGame(page1, 'P1');
    await joinGame(page2, 'P2', code);
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Verify hands
    await expect(findAllHandCards(page1)).toHaveCount(8);
    await expect(findAllHandCards(page2)).toHaveCount(8);
    await expect(findTurnArea(page1)).toContainText("It's your turn");

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);
    await drawCard(page2);

    // P1 plays ATTACK
    const p1Attack = findHandCardsByClass(page1, CardClass.Attack);
    await expect(p1Attack).toHaveCount(1);
    await playCard(page1, p1Attack);

    // Verify P2 turn bar says "2 turns"
    await expect(findTurnArea(page2)).toContainText("You have been attacked! You must take 2 turns");

    // P2 draws, explodes, debugs, inserts at 20
    const p2DrawPile = findDrawPile(page2);
    await p2DrawPile.click();

    // Handle Exploding Cluster
    const p2Overlay = findOverlay(page2, "inspect-card");
    await expect(p2Overlay).toBeVisible();
    await p2Overlay.click(); // Dismiss
    await expect(p2Overlay).toBeHidden();

    // P2 plays DEBUG
    const p2Debug = findHandCardsByClass(page2, CardClass.Debug).first();
    await playCard(page2, p2Debug);

    // Verify insertion modal
    const p2InsertModal = findModal(page2, "exploding-reinsert");
    await expect(p2InsertModal).toBeVisible();
    await p2InsertModal.locator('input[type="number"]').fill("20");
    await p2InsertModal.getByRole('button', { name: 'OK', exact: true }).click();

    // Verify P2 turn bar says "1 more turn"
    await expect(findTurnArea(page2)).toContainText("You have been attacked! You must take 1 more turn");

    // P2 draws second turn
    await drawCard(page2);

    // P1 turn
    await expect(findTurnArea(page1)).toContainText("It's your turn");

    // Sequence of safe draws
    await drawCard(page1);
    await drawCard(page2);
    await drawCard(page1);

    // P2 plays ATTACK
    const p2Attack = findHandCardsByClass(page2, CardClass.Attack);
    await expect(p2Attack).toHaveCount(1);
    await playCard(page2, p2Attack);

    // Verify P1 turn bar says "2 turns"
    await expect(findTurnArea(page1)).toContainText("You have been attacked! You must take 2 turns");

    // P1 draws, safe
    await drawCard(page1);
    await expect(findTurnArea(page1)).toContainText("You have been attacked! You must take 1 more turn");

    // P1 draws UPGRADE CLUSTER, insert at 1
    const p1DrawPile = findDrawPile(page1);
    await p1DrawPile.click();

    // Handle Upgrade Cluster
    const p1Overlay = findOverlay(page1, "inspect-card");
    await expect(p1Overlay).toBeVisible();
    await p1Overlay.click(); // Dismiss
    await expect(p1Overlay).toBeHidden();

    const p1UpgradeModal = findModal(page1, "upgrade-reinsert");
    await expect(p1UpgradeModal).toBeVisible();
    await p1UpgradeModal.locator('input[type="number"]').fill("0");
    await p1UpgradeModal.getByRole('button', { name: 'OK', exact: true }).click();

    // Verify P2 turn
    await expect(findTurnArea(page2)).toContainText(`It's your turn`);
    await expect(p2DrawPile.locator('img')).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
  });

  test('Draw: EXPLODING CLUSTER', async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (p1: string, page1: Page, p2: string, page2: Page, p3: string, page3: Page, hide: number) => {
      const p1Overlay = findOverlay(page1, "inspect-card");
      const p2Overlay = findOverlay(page2, "inspect-card");
      const p3Overlay = findOverlay(page3, "inspect-card");

      // P1 draws a card
      await drawCard(page1);

      // Verify overlays
      await expect(p1Overlay).toBeHidden();
      await expect(p2Overlay).toBeVisible();
      await expect(p3Overlay).toBeVisible();
      await expect(findLogArea(page1)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(findLogArea(page2)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(findLogArea(page3)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);

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
      await expect(findLogArea(page1)).toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page2)).toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page3)).toContainText(`${p1} played DEBUG`);
      await expect(findLogArea(page1)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page2)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(findLogArea(page3)).toContainText(`${p1}'s cluster almost exploded`);

      // Verify the insertion dialog
      const insertModal = findModal(page1, "exploding-reinsert");
      await expect(insertModal).toBeVisible();
      const input = insertModal.locator('input[type="number"]');
      await expect(input).toBeVisible();

      // Re-insert it
      await input.fill(hide.toString());
      await insertModal.getByRole('button', { name: 'OK', exact: true }).click();

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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

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
    await almostExplode("P1", page1, "P2", page2, "P3", page3, 0);
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P2 draws, explodes, and debugs
    await almostExplode("P2", page2, "P3", page3, "P1", page1, 0);
    await expect(findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(0);
    await expect(findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P3 draws, explodes, and debugs
    await almostExplode("P3", page3, "P1", page1, "P2", page2, 3);
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
    const p3Modal = findModal(page3, "game-end");
    await expect(p3Modal).toBeVisible();
    await expect(p3Modal).toContainText("You win!");

    // Verify other players' end of game messages
    const p1Modal = findModal(page1, "game-end");
    await expect(p1Modal).toBeVisible();
    await expect(p1Modal).toContainText("P3 wins!");

    const p2Modal = findModal(page2, "game-end");
    await expect(p2Modal).toBeVisible();
    await expect(p2Modal).toContainText("P3 wins!");
  });

  test('Draw: UPGRADE CLUSTER', async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (page: Page, hide: number) => {
      // Draw a card
      await drawCard(page);
      const overlay = findOverlay(page, "inspect-card");
      await expect(overlay).toBeHidden();

      // Discard pile should show EXPLODING CLUSTER
      const pile = findDiscardPile(page);
      await expect(pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify we can play DEBUG
      const debug = findHandCardsByClass(page, CardClass.Debug);
      await expect(debug.first()).toBeVisible();
      await expect(debug.first()).toHaveAttribute('data-playable', 'true');

      // Play DEBUG card
      await playCard(page, debug);

      // Verify it was played and messages sent
      await expect(pile.locator(`img`)).toHaveAttribute("data-cardclass", CardClass.Debug);

      // Verify the insertion dialog
      const insertModal = findModal(page, "exploding-reinsert");
      await expect(insertModal).toBeVisible();
      const input = insertModal.locator('input[type="number"]');
      await expect(input).toBeVisible();

      // Re-insert it
      await input.fill(hide.toString());
      await insertModal.getByRole('button', { name: 'OK', exact: true }).click();
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
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);
    await waitForURL(page3, /game/);

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

    const p1Overlay = findOverlay(page1, "inspect-card");
    const p2Overlay = findOverlay(page2, "inspect-card");
    const p3Overlay = findOverlay(page3, "inspect-card");

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
    const p2InsertModal = findModal(page2, "upgrade-reinsert");
    await expect(p2InsertModal).toBeVisible();
    const p2Input = p2InsertModal.locator('input[type="number"]');
    await expect(p2Input).toBeVisible();

    // Re-insert it
    await p2Input.fill("2");
    await p2InsertModal.getByRole('button', { name: 'OK', exact: true }).click();

    // Safe draws
    await drawCard(page3);
    await drawCard(page1);

    // P2 gets UPGRADE CLUSTER face-up
    await expect(findDrawPile(page2).locator(`img`).first()).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
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
    const p3InsertModal = findModal(page3, "upgrade-reinsert");
    await expect(p3InsertModal).toBeVisible();
    const p3Input = p3InsertModal.locator('input[type="number"]');
    await expect(p3Input).toBeVisible();

    // Re-insert it
    await p3Input.fill("0");
    await p3InsertModal.getByRole('button', { name: 'OK', exact: true }).click();

    // P1 gets UPGRADE CLUSTER face-up
    await expect(findTurnArea(page1)).toContainText(`It's your turn`);
    await expect(findDrawPile(page1).locator(`img`).first()).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await drawCard(page1);

    // Verify P3 sees "You win!"
    const p3Modal = findModal(page3, "game-end");
    await expect(p3Modal).toBeVisible();
    await expect(p3Modal).toContainText("You win!");

    // Verify other players' end of game messages
    const p1Modal = findModal(page1, "game-end");
    await expect(p1Modal).toBeVisible();
    await expect(p1Modal).toContainText("P3 wins!");

    const p2Modal = findModal(page2, "game-end");
    await expect(p2Modal).toBeVisible();
    await expect(p2Modal).toContainText("P3 wins!");
  });

  test('Message log: cleared between games', async ({ browser }) => {
    // P1 Creates Game 1
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const code1 = await createGame(page1, 'P1');

    // P2 Joins Game 1
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await joinGame(page2, 'P2', code1);

    // Start Game 1
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // P1 plays a card to generate a log
    // Draw until we have something playable? Or just use DEV_GIVE_SAFE_CARD if hand empty?
    // Start game gives 7 cards. Should have something.
    // Let's just use "Give me a safe card" to generate a "P1 put back..." or "P1 drew..." message if we used draw?
    // Or just "P1 joined" is already in the log.
    // Let's ensure a SPECIFIC unique message is there.
    // "P1 played ATTACK" (if we can).
    // Or simpler: P1 draws a card.
    drawCard(page1);
    // Wait for log
    await expect(findLogArea(page1)).toContainText('P1 drew a card');
    await expect(findLogArea(page2)).toContainText('P1 drew a card');

    // P1 Leaves Game
    await page1.click(Buttons.LEAVE_GAME);
    // Confirm Leave
    await page1.click(Buttons.LEAVE_GAME_CONFIRM);
    await waitForURL(page1, '/');

    // P2 sees win
    const modal = findModal(page2, "game-end");
    await page2.click(Buttons.MODAL_OK);
    await waitForURL(page2, '/');

    // P1 Creates Game 2
    const code2 = await createGame(page1, 'P1');
    expect(code2).not.toEqual(code1);

    // P2 Joins Game 2
    await joinGame(page2, 'P2', code2);

    // Start Game 2 to see the logs
    await page1.click(Buttons.START_GAME);
    await waitForURL(page1, /game/);
    await waitForURL(page2, /game/);

    // Verify logs are clean.
    // Game 1 had "P1 drew a card".
    // Game 2 should be empty initially.
    await expect(findLogArea(page1)).toHaveText('');
    await expect(findLogArea(page2)).toHaveText('');
  });

});
