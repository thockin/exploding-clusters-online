// Copyright 2025 Tim Hockin

import { expect, Page, Locator, ConsoleMessage } from '@playwright/test';
import { Buttons, Inputs, Headers, Locators, CSS } from './constants';
import { CardClass } from '../src/api';

// Helper to wait for a page to actually load.  Without this lots of
// tests flake.
export async function waitForURL(page: Page, url: string | RegExp) {
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
export async function createGame(page: Page, name: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.CREATE_NEW_GAME);
  await page.fill(Inputs.NAME, name);
  await page.click(Buttons.CREATE_GAME_CONFIRM);
  await waitForURL(page, '/lobby');
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
export async function joinGame(page: Page, name: string, code: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.JOIN_GAME);
  await page.fill(Inputs.NAME, name);
  await page.fill(Inputs.GAME_CODE, code);
  await page.click(Buttons.JOIN_GAME_CONFIRM);
  await waitForURL(page, '/lobby');
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible();
}

// Helper to watch game
// - Navigates to home page
// - Clicks "Watch a game"
// - Enters game code
// - Clicks "Watch Game"
// - Verifies lobby is shown
export async function watchGame(page: Page, code: string) {
  await page.goto('/', { timeout: 15000 });
  await page.click(Buttons.WATCH_GAME);
  await page.fill(Inputs.GAME_CODE, code);
  await page.click(Buttons.WATCH_GAME_CONFIRM);
  await waitForURL(page, '/observer');
  await expect(page.locator(Locators.LOBBY_TEXT)).toBeVisible();
}

// Helper to leave game
// - Clicks "Leave Game" button
// - Verifies modal appears
// - Confirms leave in modal
// - Verifies redirected to home page
export async function leaveGame(page: Page) {
  await page.click(Buttons.LEAVE_GAME);
  const modal = findModal(page, "leave-game");
  await expect(modal).toBeVisible();
  const button = modal.locator(Buttons.LEAVE_GAME_CONFIRM);
  await expect(button).toBeVisible();
  await button.click();
  await waitForURL(page, '/');
}

// Helper to play a card via drag-and-drop from hand to pile.
export async function playCard(page: Page, card: Locator) {
  const pile = findDiscardPileDropTarget(page);
  await expect(pile).toBeVisible();

  await card.scrollIntoViewIfNeeded();
  await pile.scrollIntoViewIfNeeded();
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
export async function drawCard(page: Page) {
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

// Helper to find a matching pair of cards.
export async function findPair(cards: Locator): Promise<[Locator, Locator]> {
  let idx1 = -1;
  let idx2 = -1;
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const img1 = cards.nth(i).locator('img');
    const src = await img1.getAttribute('src');
    if (!src) continue;

    for (let j = i + 1; j < count; j++) {
      const img2 = cards.nth(j).locator('img');
      const src2 = await img2.getAttribute('src');
      if (!src2) continue;

      if (src === src2) {
        idx1 = i;
        idx2 = j;
        break;
      }
    }
    if (idx1 !== -1) break;
  }
  expect(idx1).not.toBe(-1);

  return [cards.nth(idx1), cards.nth(idx2)];
}

// Helper to find the player-list area.
export function findPlayerList(page: Page): Locator {
  return page.locator(`div[data-areaname="player-list"]`);
}

// Helper to find the hand area.
export function findHand(page: Page): Locator {
  return page.locator(`div[data-areaname="hand"]`);
}

// Helper to find cards in the hand area by their card class.  Can return
// multiple cards.
export function findHandCardsByClass(page: Page, cardClass: CardClass): Locator {
  return findHand(page).locator(`div[data-cardclass="${cardClass}"]`);
}

// Helper to find all cards in the hand area.  Can return multiple cards.
export function findAllHandCards(page: Page): Locator {
  return findHand(page).locator(`div[data-cardclass]`);
}

// Helper to find the draw pile.
export function findDrawPile(page: Page): Locator {
  return page.locator(`div[data-areaname="draw-pile"]`);
}

// Helper to find the discard pile.
export function findDiscardPile(page: Page): Locator {
  return page.locator(`div[data-areaname="discard-pile"]`);
}

// Helper to find the discard pile's drop target to play a card.
export function findDiscardPileDropTarget(page: Page): Locator {
  return findDiscardPile(page).locator('xpath=..');
}

// Helper to find the timer area.
export function findTimerArea(page: Page): Locator {
  return page.locator(`div[data-areaname="timer"]`);
}

// Helper to find the log area.
export function findLogArea(page: Page): Locator {
  return page.locator(`div[data-areaname="log"]`);
}

// Helper to find the turn area.
export function findTurnArea(page: Page): Locator {
  return page.locator(`div[data-areaname="turn"]`);
}

// Helper to find the overlay
export function findOverlay(page: Page, name: string): Locator {
  return page.locator(`div[data-overlayname="${name}"]`);
}

// Helper to find modal dialogs
export function findModal(page: Page, name: string): Locator {
  return page.locator(`div[data-modalname="${name}"]`);
}

// Helper to capture browser console messages
export function catchConsoleLogs(page: Page, prefix: string) {
  page.on('console', (msg: ConsoleMessage) => {
    console.log(`[${new Date().toISOString()}] ${prefix} ${msg.type()}: ${msg.text()}`);
  });
}

