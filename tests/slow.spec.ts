// Copyright 2025 Tim Hockin

import { test, expect } from '@playwright/test';
import { Buttons } from './constants';
import * as utils from './util';

test.describe('Slow Tests', () => {

  // This relies on a longer draw timer (GO_FAST=0) to not be flaky.
  test('Leave mid-draw', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, 'P1');
    await utils.joinGame(page2, 'P2', code);
    await utils.joinGame(page3, 'P3', code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, /game/);
    await utils.waitForURL(page2, /game/);
    await utils.waitForURL(page3, /game/);

    // P1 clicks draw pile
    await utils.findDrawPile(page1).click();

    // P1 disconnects immediately (mid-draw)
    await utils.leaveGame(page1);

    // Verify P2 sees the specific log message
    await expect(utils.findLogArea(page2)).toContainText("P1 left the game mid-draw");
  });

});


