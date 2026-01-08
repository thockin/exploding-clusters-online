// Copyright 2025 Tim Hockin

import { test, expect } from "@playwright/test";
import { Buttons, Inputs, Headers, Locators, CSS } from "./constants";
import { CardClass, TurnPhase } from "../src/api";
import * as utils from "./util";

test.describe("Browser Tests (DEVMODE=1)", () => {

  test("Redirect game code in URLs", async ({ browser }) => {
    // A browser to test URLs
    const page = await browser.newPage();

    // Non-existant codes should redirect to /
    await page.goto("/lobby?gameCode=WRONG", { timeout: 15000 });
    await utils.waitForURL(page, "/");

    await page.goto("/game?gameCode=WRONG", { timeout: 15000 });
    await utils.waitForURL(page, "/");

    await page.goto("/observer?gameCode=WRONG", { timeout: 15000 });
    await utils.waitForURL(page, "/");

    // Create a game in a new window
    const page2 = await browser.newPage();
    const code = await utils.createGame(page2, "Host");

    // Real codes should also redirect to / (for non-players)
    await page.goto(`/lobby?gameCode=${code}`, { timeout: 15000 });
    await utils.waitForURL(page, "/");

    await page.goto(`/game?gameCode=${code}`, { timeout: 15000 });
    await utils.waitForURL(page, "/");

    await page.goto(`/observer?gameCode=${code}`, { timeout: 15000 });
    await utils.waitForURL(page, "/");

  });

  test("Fail to join: unknown game code", async ({ browser }) => {
    const page = await browser.newPage();

    // Attempt to join invalid code "WRONG"
    await page.goto("/", { timeout: 15000 });
    await page.click(Buttons.JOIN_GAME);

    await expect(page.locator(Inputs.GAME_CODE)).toBeFocused();
    await page.fill(Inputs.GAME_CODE, "WRONG");
    await page.fill(Inputs.NAME, "Bob");
    await page.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator(".modal.show .alert-danger")).toContainText("does not exist");

    // Now test the /join URL approach - it should redirect to the dialog
    await page.goto("/join/WRONG", { timeout: 15000 });
    await utils.waitForURL(page, "/?gameCode=WRONG&action=join");

    // Verify the join dialog is shown with the game code pre-filled
    await expect(page.locator(Inputs.GAME_CODE)).toHaveValue("WRONG");
    await expect(page.locator(Inputs.NAME)).toBeFocused();
    await page.fill(Inputs.NAME, "Bob");
    await page.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator(".modal.show .alert-danger")).toContainText("does not exist");
  });

  test("Fail to observe: unknown game code", async ({ browser }) => {
    const page = await browser.newPage();

    // Attempt to watch invalid code "WRONG"
    await page.goto("/", { timeout: 15000 });
    await page.click(Buttons.WATCH_GAME);

    await expect(page.locator(Inputs.GAME_CODE)).toBeFocused();
    await page.fill(Inputs.GAME_CODE, "WRONG");
    await page.click(Buttons.WATCH_GAME_CONFIRM);

    // Verify Error Modal appears with "does not exist" message
    await expect(page.locator(".modal.show .alert-danger")).toContainText("does not exist");

    // Now test the /watch URL approach - it should attempt to watch and show error
    await page.goto("/watch/WRONG", { timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Verify Error message appears with "does not exist" message
    await expect(page.locator("text=Game WRONG does not exist")).toBeVisible();

    // Click the button
    await page.click("button:has-text('OK')");

    // Verify URL is /
    await utils.waitForURL(page, "/");
  });

  test("Fail to join: game is full", async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    // P1 creates a game
    const code = await utils.createGame(page1, "Host");

    // Join 4 more players (Total 5) to fill the game
    const contexts = [];
    for (let i = 2; i <= 5; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const p = await ctx.newPage();
      await utils.joinGame(p, `Player ${i}`, code);
      await expect(p.locator(Locators.LOBBY_TEXT)).toBeVisible();
    }

    // 6th Player attempts to join
    const p6 = await browser.newContext();
    const page6 = await p6.newPage();
    await page6.goto("/", { timeout: 15000 });
    await page6.click(Buttons.JOIN_GAME);
    await page6.fill(Inputs.NAME, "Player 6");
    await page6.fill(Inputs.GAME_CODE, code);
    await page6.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "full" message
    await expect(page6.locator(".modal.show .alert-danger")).toContainText("Sorry, that game is full");

    // Now test the /join URL approach - it should redirect to the dialog
    await page6.goto(`/join/${code}`, { timeout: 15000 });
    await utils.waitForURL(page6, `/?gameCode=${code}&action=join`);

    // Verify the join dialog is shown with the game code pre-filled
    await expect(page6.locator(Inputs.GAME_CODE)).toHaveValue(code);
    // Verify focus is on the name input
    await expect(page6.locator(Inputs.NAME)).toBeFocused();

    // Try to join with a name - should fail with "full" message
    await page6.fill(Inputs.NAME, "Player 6b");
    await page6.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "full" message
    await expect(page6.locator(".modal.show .alert-danger")).toContainText("Sorry, that game is full");
  });

  test("Fail to observe: game is full", async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    // P1 creates a game
    const code = await utils.createGame(page1, "Host");

    // Watch with 5 spectators (Total 5) to fill the spectator limit
    const contexts = [];
    for (let i = 1; i <= 5; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const p = await ctx.newPage();
      await utils.watchGame(p, code);
      await expect(p.locator(Locators.LOBBY_TEXT)).toBeVisible();
    }

    // 6th Spectator attempts to watch
    const s6 = await browser.newContext();
    const page6 = await s6.newPage();
    await page6.goto("/", { timeout: 15000 });
    await page6.click(Buttons.WATCH_GAME);

    await expect(page6.locator(Inputs.GAME_CODE)).toBeFocused();
    await page6.fill(Inputs.GAME_CODE, code);
    await page6.click(Buttons.WATCH_GAME_CONFIRM);

    // Verify Error Modal appears with "spectator limit" message
    await expect(page6.locator(".modal.show .alert-danger")).toContainText("spectator limit");

    // Now test the /watch URL approach - it should attempt to watch and show error
    await page6.goto(`/watch/${code}`, { timeout: 15000 });
    await page6.waitForLoadState("networkidle");

    // Verify Error message appears with "spectator limit" message
    await expect(page6.locator("text=Sorry, this game has reached its spectator limit.")).toBeVisible();

    // Click the button
    await page6.click("button:has-text('OK')");

    // Verify URL is /
    await utils.waitForURL(page6, "/");
  });

  test("Fail to join: duplicate name", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Create game as "Alice"
    const code = await utils.createGame(page1, "Alice");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Try to join with same name "Alice"
    await page2.goto("/", { timeout: 15000 });
    await page2.click(Buttons.JOIN_GAME);
    await page2.fill(Inputs.NAME, "Alice");
    await page2.fill(Inputs.GAME_CODE, code);
    await page2.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify Error Modal appears with "name taken" message
    await expect(page2.locator(".modal.show .alert-danger")).toContainText("name is already taken");
  });

  test("Lobby: player disconnect, reconnect", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Host creates game
    const code = await utils.createGame(page1, "Host");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    // Player "Leaver" joins
    await utils.joinGame(page2, "Leaver", code);
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();
    // Verify URL is correct
    await utils.waitForURL(page2, "/lobby");

    // Ensure session storage is populated on P2
    await page2.waitForFunction(() => {
      const s = sessionStorage.getItem("exploding_session");
      if (!s) return false;
      const data = JSON.parse(s);
      return data.gameCode && data.nonce;
    });

    // P2 Navigates away (disconnects)
    await page2.goto("about:blank");

    // Host checks list: "Leaver" should disappear
    await expect(page1.locator("text=Leaver")).not.toBeVisible();

    // P2 reconnects (Go back)
    await page2.goBack();
    await page2.waitForLoadState("networkidle"); // Wait for page to fully load

    // Verify P2 successfully rejoins lobby
    await expect(page2.locator(Headers.LOBBY_GAME_CODE)).toBeVisible();
    // Verify URL is correct
    await utils.waitForURL(page2, "/lobby");

    // Host sees "Leaver" again in the list
    await expect(page1.locator("text=Leaver")).toBeVisible();
  });

  test("Lobby: observer disconnect, reconnect", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Host creates game
    const code = await utils.createGame(page1, "Host");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    // Observer watches the game
    await utils.watchGame(page2, code);
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();
    // Verify URL is correct
    await utils.waitForURL(page2, "/observer");

    // Verify spectator count is 1 on host's page
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();

    // Ensure session storage is populated on P2
    await page2.waitForFunction(() => {
      const s = sessionStorage.getItem("exploding_session");
      if (!s) return false;
      const data = JSON.parse(s);
      return data.gameCode;
    });

    // P2 Navigates away (disconnects)
    await page2.goto("about:blank");

    // Host checks spectator count: should be 0
    await expect(page1.locator("text=Watching: 0 people")).toBeVisible();

    // P2 reconnects (Go back)
    await page2.goBack();
    await page2.waitForLoadState("networkidle"); // Wait for page to fully load

    // Verify P2 successfully rejoins observer screen
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();
    // Verify URL is correct
    await utils.waitForURL(page2, "/observer");

    // Host sees spectator count back to 1
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();
  });

  test("Lobby: player disconnect, reconnect fails after nonce change", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // Host creates game
    const code = await utils.createGame(page1, "Host");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // Player "Leaver" joins
    await utils.joinGame(page2, "Leaver", code);
    await expect(page2.locator(Locators.LOBBY_TEXT)).toBeVisible();

    // Ensure P2 session storage is ready
    await page2.waitForFunction(() => !!sessionStorage.getItem("exploding_session"));

    // P2 Navigates away (disconnects)
    await page2.goto("about:blank");

    // New Player "NewPlayer" joins -> Updates nonce
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "NewPlayer", code);
    await expect(page3.locator(Locators.LOBBY_TEXT)).toBeVisible();

    // P2 tries to reconnect
    await page2.goBack();
    await page2.waitForLoadState("networkidle"); // Wait for page to fully load

    // Verify Reconnection Fails: Error Modal should appear due to nonce mismatch
    await expect(utils.findModal(page2, "rejoin-error")).toBeVisible();
  });

  test("Lobby: game owner reassignment", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    // P1 creates game
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "P3", code);

    // Verify all players are in the lobby
    await expect(page1.locator("text=P2")).toBeVisible();
    await expect(page1.locator("text=P3")).toBeVisible();
    await expect(page2.locator("text=P1 (Host)")).toBeVisible();
    await expect(page3.locator("text=P1 (Host)")).toBeVisible();

    // Owner (P1) navigates away and back (e.g. refresh)
    // NOTE: This has to happen inside 1sec to avoid timeout-based
    // disconnect logic. If it becomes flaky, consider setting a longer
    // timeout for tests.
    await page1.goto("about:blank");
    await page1.goBack();
    await page1.waitForLoadState("networkidle");
    await expect(page1.locator(Headers.LOBBY_GAME_CODE)).toBeVisible();

    // P1 sees Start Game button
    await expect(page1.locator(Buttons.START_GAME)).toBeVisible();
    // P2 does not see Start Game button
    await expect(page2.locator(Buttons.START_GAME)).not.toBeVisible();
    // P3 does not see Start Game button
    await expect(page3.locator(Buttons.START_GAME)).not.toBeVisible();

    // Verify P1 is present in others' lists again
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P1 (Host)')")).toBeVisible();
    await expect(page3.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P1 (Host)')")).toBeVisible();

    // Owner (P1) navigates away (disconnects)
    await page1.goto("about:blank");

    // Verify P1 is gone from P2's list
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P1')")).not.toBeVisible();

    // Verify a new owner is assigned (P2)
    // Wait for the host indicator to update on P2's screen
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('(Host)')")).toBeVisible();

    // Check who is the new host and verify UI updates (Start Game button, Modal)
    const p2Host = await page2.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P2 (Host)')").isVisible();
    expect(p2Host).toBeTruthy();

    // P2 sees promotion modal
    await expect(utils.findModal(page2, "host-promotion")).toBeVisible();
    // P2 clicks the button on the promotion modal
    await page2.click("button:has-text('Awesome!')");
    // P2 sees Start Game button
    await expect(page2.locator(Buttons.START_GAME)).toBeVisible();
    // P3 does not see Start Game button
    await expect(page3.locator(Buttons.START_GAME)).not.toBeVisible();

    // P1 reconnects
    await page1.goBack();
    await page1.waitForLoadState("networkidle");

    // Verify P1 successfully rejoins
    await expect(page1.locator(Headers.LOBBY_GAME_CODE)).toBeVisible();

    // Verify P1 is present in P2's list again
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P1')")).toBeVisible();

    // Verify P1 is NO LONGER the host
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + ":has-text('P1 (Host)')")).not.toBeVisible();
    // And P1 should NOT see the Start Game button
    await expect(page1.locator(Buttons.START_GAME)).not.toBeVisible();

    // P2 clicks Leave Game
    await utils.leaveGame(page2);

    // Verify P1 immediately becomes the game owner
    await expect(utils.findModal(page1, "host-promotion")).toBeVisible();
    await expect(page1.locator(Buttons.START_GAME)).toBeVisible();
    await expect(page1.locator("text=P1 (Host)")).toBeVisible();
  });

  test("Lobby: invite links and copy buttons", async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();

    // Create a game as the host
    const code = await utils.createGame(page, "Host");

    // Verify invite sections are visible
    await expect(page.locator("text=Invite friends to play:")).toBeVisible();
    await expect(page.locator("text=Invite friends to watch:")).toBeVisible();

    // Get the base URL
    const baseUrl = await page.evaluate(() => window.location.origin);
    const expectedJoinUrl = `${baseUrl}/join/${code}`;
    const expectedWatchUrl = `${baseUrl}/watch/${code}`;

    // Find the input groups - they should be in order: join first, watch second
    const inviteRows = page.locator("text=Invite friends").locator("..").locator("..");
    const joinRow = inviteRows.first();
    const watchRow = inviteRows.last();

    // Verify the URLs are correct in the text inputs
    const joinInput = joinRow.locator("input[readonly]");
    const watchInput = watchRow.locator("input[readonly]");

    await expect(joinInput).toHaveValue(expectedJoinUrl);
    await expect(watchInput).toHaveValue(expectedWatchUrl);

    // Test copying the join URL
    const joinCopyButton = joinRow.locator("button:has-text('Copy')");
    await joinCopyButton.click();
    await expect(joinRow.locator("button:has-text('Copied!')")).toBeVisible();

    // Verify clipboard contains the join URL
    const clipboardJoinText = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });
    expect(clipboardJoinText).toBe(expectedJoinUrl);

    // Wait for "Copied!" to disappear
    await expect(joinRow.locator("button:has-text('Copied!')")).toBeHidden({ timeout: 3000 });

    // Test copying the watch URL
    const watchCopyButton = watchRow.locator("button:has-text('Copy')");
    await watchCopyButton.click();
    await expect(watchRow.locator("button:has-text('Copied!')")).toBeVisible();

    // Verify clipboard contains the watch URL
    const clipboardWatchText = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });
    expect(clipboardWatchText).toBe(expectedWatchUrl);

    // Verify a non-host player doesn't see the invite sections
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await utils.joinGame(page2, "Player", code);

    await expect(page2.locator("text=Invite friends to play:")).not.toBeVisible();
    await expect(page2.locator("text=Invite friends to watch:")).not.toBeVisible();
  });

  test("Lobby: URL handling", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();

    // P1 creates a game
    const code = await utils.createGame(page1, "P1");

    // Verify 1 player
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST)).toContainText("P1");
    const playerCount = await page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item").count();
    expect(playerCount).toBe(1);

    // P2 starts at /join/XXXXX
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`/join/${code}`, { timeout: 15000 });

    // Verify the join dialog
    await expect(utils.findModal(page2, "join-game")).toBeVisible();

    // Verify the game code is prepopulated
    await expect(page2.locator(Inputs.GAME_CODE)).toHaveValue(code);

    // Verify the focus is in the name
    await expect(page2.locator(Inputs.NAME)).toBeFocused();

    // Click join
    await page2.fill(Inputs.NAME, "P2");
    await page2.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify URL
    await utils.waitForURL(page2, "/lobby");

    // Verify 2 players, 0 observers
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 0 people")).toBeVisible();
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator("text=Watching: 0 people")).toBeVisible();

    // P2 refreshes (or navigates away and back)
    await page2.goto("about:blank");
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(1);
    await page2.goBack();
    await page2.waitForLoadState("networkidle");

    // Verify URL
    await utils.waitForURL(page2, "/lobby");

    // Verify 2 players, 0 observers
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 0 people")).toBeVisible();
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator("text=Watching: 0 people")).toBeVisible();

    // P2 go to /join/XXXXX
    await page2.goto(`/join/${code}`, { timeout: 15000 });

    // Verify 1 players, 0 observers
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(1);
    await expect(page1.locator("text=Watching: 0 people")).toBeVisible();

    // Verify the join dialog and re-join
    await expect(utils.findModal(page2, "join-game")).toBeVisible();
    await page2.fill(Inputs.NAME, "P2");
    await page2.click(Buttons.JOIN_GAME_CONFIRM);

    // Verify 2 players, 0 observers
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 0 people")).toBeVisible();

    // P3 start at /watch/XXXXX
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await page3.goto(`/watch/${code}`, { timeout: 15000 });

    // Verify URL
    await utils.waitForURL(page3, "/observer");

    // Verify 2 players, 1 observer
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page3.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page3.locator("text=Watching: 1 person")).toBeVisible();

    // P3 refreshes (or navigates away and back)
    await page3.goto("about:blank");
    await page3.goBack();
    await page3.waitForLoadState("networkidle");

    // Verify URL
    await utils.waitForURL(page3, "/observer");

    // Verify 2 players, 1 observer
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page3.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page3.locator("text=Watching: 1 person")).toBeVisible();

    // P3 go to /watch/XXXXX
    await page3.goto(`/watch/${code}`, { timeout: 15000 });

    // Verify URL
    await utils.waitForURL(page3, "/observer");

    // Verify 2 players, 1 observer
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator("text=Watching: 1 person")).toBeVisible();
    await expect(page3.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page3.locator("text=Watching: 1 person")).toBeVisible();
  });

  test("Game: URL handling", async ({ browser }) => {
    // P1 creates a game
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");

    // P2 joins
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    // P3 joins
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "P3", code);

    // P4 watches
    const ctx4 = await browser.newContext();
    const page4 = await ctx4.newPage();
    await utils.watchGame(page4, code);

    // P1 starts the game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");
    await utils.waitForURL(page4, "/observer");

    // Verify all players are in the game
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findAllHandCards(page3)).toHaveCount(8);
    await expect(utils.findAllHandCards(page4)).toHaveCount(0);

    // P2 refreshes (or navigates away and back)
    await page2.goto("about:blank");
    await page2.goBack();
    await page2.waitForLoadState("networkidle");

    // Verify URL
    await utils.waitForURL(page2, "/game");

    // Verify P2 is still in the game
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // P2 go to /join/XXXXX
    await page2.goto(`/join/${code}`, { timeout: 15000 });
    await expect(utils.findModal(page2, "join-game")).toBeVisible();
    await page2.fill(Inputs.NAME, "P2");
    await page2.click(Buttons.JOIN_GAME_CONFIRM);
    // Verify error contains "that game has already started"
    await expect(page2.locator(".modal.show .alert-danger")).toContainText("that game has already started");

    // P4 (observer) refreshes (or navigates away and back)
    await page4.goto("about:blank");
    await page4.goBack();
    await page4.waitForLoadState("networkidle");

    // Verify URL
    await utils.waitForURL(page4, "/observer");

    // P4 go to /watch/XXXXX
    await page4.goto(`/watch/${code}`, { timeout: 15000 });

    // Verify URL
    await utils.waitForURL(page4, "/observer");
  });

  test("Game: 2 players + observer", async ({ browser }) => {
    const p1 = await browser.newContext();
    const p2 = await browser.newContext();
    const obs = await browser.newContext();
    const page1 = await p1.newPage();
    const page2 = await p2.newPage();
    const pageObs = await obs.newPage();

    // P1 Creates Game
    const code = await utils.createGame(page1, "Player One");

    // P2 Joins Game
    await utils.joinGame(page2, "Player Two", code);

    // Observer Watches Game
    await utils.watchGame(pageObs, code);

    // Verify the player list has 2 players on all screens
    await expect(page1.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(page2.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);
    await expect(pageObs.locator(Locators.LOBBY_PLAYER_LIST + " .list-group-item")).toHaveCount(2);

    // Verify Lobby Sync on P1: Check that Player Two is listed
    await expect(page1.locator("text=Player Two")).toBeVisible();
    // Verify Lobby Sync on P1: Check spectator count
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();

    // Verify Lobby Sync on P2: Check that Player One is listed
    await expect(page1.locator("text=Player One")).toBeVisible();
    // Verify Lobby Sync on P2: Check spectator count
    await expect(page1.locator("text=Watching: 1 person")).toBeVisible();

    // Verify Lobby Sync on Observer: Check players
    await expect(pageObs.locator("text=Player One (Host)")).toBeVisible();
    await expect(pageObs.locator("text=Player Two")).toBeVisible();

    // Start Game (P1 clicks start)
    await page1.click(Buttons.START_GAME);

    // Verify Game Screen loaded for all participants
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(pageObs, "/observer");

    // Verify Observer UI: Should NOT see a hand
    await expect(pageObs.locator(Headers.YOUR_HAND)).not.toBeVisible();
    // Verify Player UI: Should see a hand
    await expect(page1.locator(Headers.YOUR_HAND)).toBeVisible();
  });

  test("Game page: initial UI", async ({ browser }) => {
    // Setup 3 players
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Verify the player list
    await expect(utils.findPlayerList(page1).locator(".list-group-item")).toHaveCount(3);
    await expect(utils.findPlayerList(page1)).toContainText("P1 (that's you)");
    await expect(utils.findPlayerList(page1)).toContainText("P2");
    await expect(utils.findPlayerList(page1)).toContainText("P3");
    await expect(utils.findPlayerList(page2).locator(".list-group-item")).toHaveCount(3);
    await expect(utils.findPlayerList(page2)).toContainText("P1");
    await expect(utils.findPlayerList(page2)).toContainText("P2 (that's you)");
    await expect(utils.findPlayerList(page2)).toContainText("P3");
    await expect(utils.findPlayerList(page3).locator(".list-group-item")).toHaveCount(3);
    await expect(utils.findPlayerList(page3)).toContainText("P1");
    await expect(utils.findPlayerList(page3)).toContainText("P2");
    await expect(utils.findPlayerList(page3)).toContainText("P3 (that's you)");

    // Verify P1 (current turn) -> Lightgreen background
    const p1TurnArea = utils.findTurnArea(page1);
    await expect(p1TurnArea).toBeVisible();
    await expect(p1TurnArea).toHaveCSS("background-color", "rgb(144, 238, 144)");
    await expect(p1TurnArea).toContainText(`It's your turn, P2 is next`);

    // Verify P2 (next turn) -> Orange background
    const p2TurnArea = utils.findTurnArea(page2);
    await expect(p2TurnArea).toBeVisible();
    await expect(p2TurnArea).toHaveCSS("background-color", "rgb(255, 213, 128)");
    await expect(p2TurnArea).toContainText("It's P1's turn, your turn is next");

    // Verify P3 (other) -> Lightblue background
    const p3TurnArea = utils.findTurnArea(page3);
    await expect(p3TurnArea).toBeVisible();
    await expect(p3TurnArea).toHaveCSS("background-color", "rgb(173, 216, 230)");
    await expect(p3TurnArea).toContainText("It's P1's turn");
  });

  test("DEVMODE: DEBUG Button limit", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "Dev");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");

    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();

    // Click until disabled (consuming all debug cards)
    for (let i=0; i<10; i++) {
      await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1 + i);
      if (await debugBtn.isDisabled()) break;
      await debugBtn.click();
      await page1.waitForTimeout(200);
    }

    await expect(debugBtn).toBeDisabled();
  });

  test("DEVMODE: put card back", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");

    // Verify initial hand count (8)
    const handArea = page1.locator(Headers.YOUR_HAND).locator("xpath=..");
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);

    // Get initial deck count from UI text (e.g. "(30 cards)")
    const deckCountText = await page1.locator(Locators.DRAW_PILE_COUNT).textContent();
    const initialDeckCount = parseInt(deckCountText?.replace(/\D/g, "") || "0", 10);

    const putBackBtn = page1.locator(Buttons.DEV_PUT_CARD_BACK);
    await expect(putBackBtn).toBeVisible();
    await expect(putBackBtn).toBeEnabled();

    // Click until disabled, verify hand count decreased and deck count
    // increased
    for (let i=0; i<10; i++) {
      await expect(utils.findAllHandCards(page1)).toHaveCount(8 - i);
      await expect(page1.locator(Locators.DRAW_PILE_COUNT)).toHaveText(`(${initialDeckCount + i} cards)`);
      if (await putBackBtn.isDisabled()) break;
      await putBackBtn.click();
      await page1.waitForTimeout(200);
    }
    await expect(handArea.locator("img")).toHaveCount(0);
    await expect(page1.locator(Locators.DRAW_PILE_COUNT)).toHaveText(`(${initialDeckCount + 8} cards)`);
  });

  test("DEVMODE: dismiss show-deck overlay", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);

    // Click "Show the deck" button
    await page1.click(Buttons.DEV_SHOW_DECK);

    // Check for overlay
    await expect(utils.findOverlay(page1, "show-deck")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press("Escape");
    await expect(utils.findOverlay(page1, "show-deck")).toBeHidden();

    // Click "Show the deck" button again
    await page1.click(Buttons.DEV_SHOW_DECK);

    // Check for overlay
    await expect(utils.findOverlay(page1, "show-deck")).toBeVisible();

    // Click the overlay to dismiss
    await utils.findOverlay(page1, "show-deck").click();
    await expect(utils.findOverlay(page1, "show-deck")).toBeHidden();
  });

  test("DEVMODE: dismiss show-removed overlay", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);

    // Click "Show removed cards" button
    await page1.click(Buttons.DEV_SHOW_REMOVED);

    // Check for overlay
    await expect(utils.findOverlay(page1, "show-removed")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press("Escape");
    await expect(utils.findOverlay(page1, "show-removed")).toBeHidden();

    // Click "Show removed cards" button again
    await page1.click(Buttons.DEV_SHOW_REMOVED);

    // Check for overlay
    await expect(utils.findOverlay(page1, "show-removed")).toBeVisible();

    // Click the overlay to dismiss
    await utils.findOverlay(page1, "show-removed").click();
    await expect(utils.findOverlay(page1, "show-removed")).toBeHidden();
  });

  test("Hand: card wrapping", async ({ browser }) => {
    // Create game
    // Set viewport to constrain hand width to approx 6 cards to force wrapping
    const ctx1 = await browser.newContext({ viewport: { width: 700, height: 1000 } });
    const page = await ctx1.newPage();
    const code = await utils.createGame(page, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    // Start Game
    await page.click(Buttons.START_GAME);
    await utils.waitForURL(page, "/game");

    // Wait for hand to render and verify initial count (8)
    const handArea = utils.findHand(page);
    await expect(handArea.locator("img")).toHaveCount(8);

    // Check rows: 8 cards should wrap to 2 rows
    const rows = handArea.locator(".d-flex.justify-content-center.flex-nowrap.w-100");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("img")).toHaveCount(6);
    await expect(rows.nth(1).locator("img")).toHaveCount(2);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "77px"); // empirical

    // Draw 9th card (using DEVMODE button)
    await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    await expect(handArea.locator("img")).toHaveCount(9);
    // Verify layout: 2 rows (6, 3)
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("img")).toHaveCount(6);
    await expect(rows.nth(1).locator("img")).toHaveCount(3);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "77px"); // empirical

    // Draw 10th card
    await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    await expect(handArea.locator("img")).toHaveCount(10);
    // Verify layout: 2 rows (6, 4)
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("img")).toHaveCount(6);
    await expect(rows.nth(1).locator("img")).toHaveCount(4);
    // Verify card size
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "77px"); // empirical

    // Add cards to force 3 rows
    for (let i = 0; i < 5; i++) {
      await page.click(Buttons.DEV_GIVE_SAFE_CARD);
    }
    await expect(handArea.locator("img")).toHaveCount(15);
    // Verify layout: Should be 3 rows
    await expect(rows).toHaveCount(3);
    // Verify card size
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "77px"); // empirical

    for (let i = 0; i < 8; i++) {
      await page.click(Buttons.DEV_PUT_CARD_BACK);
    }
    await expect(handArea.locator("img")).toHaveCount(7);

    // Verify layout: 2 rows
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("img")).toHaveCount(6);
    await expect(rows.nth(1).locator("img")).toHaveCount(1);
    // Verify card size
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "77px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(6);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(6);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "86px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(5);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(5);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "106px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(4);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(4);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "106px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(3);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(3);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "106px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(2);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(2);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "106px"); // empirical

    await page.click(Buttons.DEV_PUT_CARD_BACK);
    await expect(handArea.locator("img")).toHaveCount(1);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator("img")).toHaveCount(1);
    await expect(rows.nth(0).locator(".m-1").first()).toHaveCSS("width", "106px"); // empirical
  });

  test("Hand: dismiss inspect-card overlay", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Wait for hand to be visible and have cards
    const handArea = utils.findHand(page1)
    await expect(handArea).toBeVisible();
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    const cardImg = handArea.locator("img").first();
    await cardImg.scrollIntoViewIfNeeded();

    // Double-click first card to open overlay
    await cardImg.dblclick({ force: true });

    // Check for overlay
    await expect(utils.findOverlay(page1, "inspect-card")).toBeVisible();

    // Press <escape> to dismiss
    await page1.keyboard.press("Escape");
    await expect(utils.findOverlay(page1, "inspect-card")).toBeHidden();

    // Double-click first card to open overlay again
    await cardImg.dblclick({ force: true });

    // Check for overlay
    await expect(utils.findOverlay(page1, "inspect-card")).toBeVisible();

    // Click the overlay to dismiss
    await utils.findOverlay(page1, "inspect-card").click();
    await expect(utils.findOverlay(page1, "inspect-card")).toBeHidden();
  });

  test("Hand: card selection, deselection", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const code = await utils.createGame(page, "FocusTest");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page.click(Buttons.START_GAME);
    await utils.waitForURL(page, "/game");

    // Wait for hand to populate
    await expect(utils.findAllHandCards(page)).toHaveCount(8);

    // Find pair of DEVELOPER cards (in the fixed deck)
    const devCards = utils.findHandCardsByClass(page, CardClass.Developer);
    const count = await devCards.count();
    expect(count).toEqual(3);
    const [ pair1, pair2 ] = await utils.findPair(devCards);

    // Find another playable card
    const other = utils.findHandCardsByClass(page, CardClass.Shuffle);

    // Select first
    await pair1.scrollIntoViewIfNeeded();
    await pair1.click();
    await expect(pair1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Shift-click second
    await pair2.scrollIntoViewIfNeeded();
    await page.keyboard.down("Shift");
    await pair2.click();
    await page.keyboard.up("Shift");

    // Verify selection style
    await expect(pair1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Press shift again to check focus ring remains (regression)
    await page.keyboard.down("Shift");
    const parent = pair2.locator("xpath=..");
    await expect(parent).toHaveCSS("outline-style", "none");
    await page.keyboard.up("Shift");
    await expect(parent).toHaveCSS("outline-style", "none");
    await expect(pair1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Shift-click other, does nothing
    await other.scrollIntoViewIfNeeded();
    await page.keyboard.down("Shift");
    await other.click();
    await page.keyboard.up("Shift");
    await expect(pair1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Click other deselects the pair
    await other.click();
    await page.waitForTimeout(10000);
    await expect(pair1).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Click text "Your Hand" (empty space/container header) to deselect
    await page.click(Headers.YOUR_HAND);

    // Verify all cards are deselected
    await expect(pair1).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(pair2).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(other).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
  });

  test("Hand: drag unselected card", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const code = await utils.createGame(page1, "FocusTest");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");

    // Wait for hand to populate
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);

    // Locate two different cards (FAVOR and SHUFFLE)
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor);
    const shuffleCard = utils.findHandCardsByClass(page1, CardClass.Shuffle);
    await expect(favorCard).toBeVisible();
    await expect(shuffleCard).toBeVisible();

    // Click to select FAVOR
    await favorCard.scrollIntoViewIfNeeded();
    await favorCard.click();
    await expect(favorCard).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Drag SHUFFLE
    await shuffleCard.scrollIntoViewIfNeeded();
    const srcBox = await shuffleCard.boundingBox();

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(srcBox.x + srcBox.width * 2, srcBox.y + srcBox.height / 2, { steps: 20 });

    // Verify selection
    await expect(favorCard).not.toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await page1.keyboard.press("Escape"); // cancel drag
    await expect(shuffleCard).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
  });

  test("Hand: reorder cards", async ({ browser }) => {
    // Set viewport to force 2 rows
    const viewport = { width: 700, height: 1000 };
    const context = await browser.newContext({ viewport });
    const page1 = await context.newPage();
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    // P3 to stabilize game
    const ctx3 = await browser.newContext({ viewport });
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "P3", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Use a player who is NOT current turn to perform reorder
    const handArea = utils.findHand(page2)
    await expect(handArea).toBeVisible();
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const rows = handArea.locator(".d-flex.justify-content-center.flex-nowrap.w-100");
    await expect(rows).toHaveCount(2);

    const row1Cards = rows.nth(0).locator(".m-1");
    const row2Cards = rows.nth(1).locator(".m-1");

    // Empirical values for for this viewport size
    await expect(row1Cards).toHaveCount(6);
    await expect(row2Cards).toHaveCount(2);

    // --- Drag and Drop Test ---
    // Drag from Row 1 Index 0 to Row 2 Index 0
    const card0 = row1Cards.nth(0).locator("img");
    const card0Id = await card0.getAttribute("alt");

    const card0Div = row1Cards.nth(0);
    const card1Div = row1Cards.nth(1);

    const srcBox = await card0Div.boundingBox();
    const card1Box = await card1Div.boundingBox();
    const dstBox = await row2Cards.nth(0).boundingBox();

    if (!srcBox || !dstBox || !card1Box) throw new Error("Missing bounding box");

    // Perform Drag
    await page2.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page2.mouse.down();
    await page2.mouse.move(card1Box.x + card1Box.width / 2, card1Box.y + card1Box.height / 2, { steps: 20 });
    await page2.mouse.up();

    await page2.waitForTimeout(1000); // empirical wait for reorder animation

    // Verify Reorder: Card 0 should now be at Index 1
    const newRow1Idx1 = await row1Cards.nth(1).locator("img").getAttribute("alt");
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
  });

  test("Hand: multi-card reorder", async ({ browser }) => {
    const viewport = { width: 1200, height: 800 };
    const ctx1 = await browser.newContext({ viewport });
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext({ viewport });
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const handArea = utils.findHand(page1);
    await expect(handArea).toBeVisible();
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);

    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [ card1, card2 ] = await utils.findPair(devCards);
    const pairSrc = await card1.locator("img").getAttribute("src");

    // Select first card
    await card1.scrollIntoViewIfNeeded();
    await card1.click();
    await expect(card1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Shift-click second card to multi-select
    await card2.scrollIntoViewIfNeeded();
    await page1.keyboard.down("Shift");
    await card2.click();
    await page1.keyboard.up("Shift");

    // Verify both are selected
    await expect(card1).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(card2).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);

    // Drag the first selected card to end of hand (moves both)
    const lastCard = handArea.locator("img").last();
    const srcBox = await card1.boundingBox();
    const dstBox = await lastCard.boundingBox();

    if (!srcBox || !dstBox) throw new Error("Missing bounding box");

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.waitForTimeout(500);
    await page1.mouse.move(dstBox.x + dstBox.width, dstBox.y + dstBox.height / 2, { steps: 60 });
    await page1.waitForTimeout(500);
    await page1.mouse.up();
    await page1.waitForTimeout(500);

    // Verify the identical cards are now at the end of the hand
    const newLast = utils.findAllHandCards(page1).last().locator("img");
    const newNextLast = utils.findAllHandCards(page1).nth(-2).locator("img");
    expect(await newLast.getAttribute("src")).toBe(pairSrc);
    expect(await newNextLast.getAttribute("src")).toBe(pairSrc);

    // Verify selection persists
    await expect(newLast.locator("xpath=..")).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
    await expect(newNextLast.locator("xpath=..")).toHaveCSS("box-shadow", CSS.CARD_SELECTED_BOX);
  });

  // TODO: Run this in non-devmode
  test("Hand: Verify initial state", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);

    // Verify initial card counts are 8 for both
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Verify each player has at least 1 DEBUG card
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await expect(utils.findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
  });

  test("Game page: layout stability", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");

    // Wait for initial layout
    await page1.waitForSelector(Locators.DRAW_PILE_COUNT);

    // Locators for areas
    // The green table area (Col md=9)
    const tableArea = page1.locator("div[style*='background-color: rgb(34, 139, 34)']");
    // The fixed height message container
    const messageArea = utils.findLogArea(page1).locator("xpath=..");
    // The hand container (bg-light, fixed height)
    const handArea = page1.locator(Headers.YOUR_HAND).locator("xpath=..");

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

  test("Players leave game", async ({ browser }) => {
    // Setup 4 players
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await utils.joinGame(page3, "P3", code);

    const ctx4 = await browser.newContext();
    const page4 = await ctx4.newPage();
    await utils.joinGame(page4, "P4", code);

    // Start Game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");
    await utils.waitForURL(page4, "/game");

    // Verify P1 starts
    await expect(page1.locator(".list-group-item:has-text('P1')")).toHaveClass(/bg-success-subtle/);
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page2)).toContainText("It's P1's turn, your turn is next");
    await expect(utils.findTurnArea(page3)).toContainText("It's P1's turn");

    // P1 (current) disconnects
    await page1.goto("about:blank");

    // Verify disconnected player disappears from list
    await expect(page2.locator(".list-group-item:has-text('P1')")).not.toBeVisible();
    await expect(page3.locator(".list-group-item:has-text('P1')")).not.toBeVisible();
    await expect(page4.locator(".list-group-item:has-text('P1')")).not.toBeVisible();

    // Verify "abandoned turn" message
    await expect(utils.findLogArea(page2)).toContainText("P1 has abandoned their turn");
    await expect(utils.findLogArea(page3)).toContainText("P1 has abandoned their turn");
    await expect(utils.findLogArea(page4)).toContainText("P1 has abandoned their turn");

    // Verify turn passes to next player
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page3)).toContainText("It's P2's turn, your turn is next");
    await expect(utils.findTurnArea(page4)).toContainText("It's P2's turn");

    // Reconnect attempt by disconnected player
    await page1.goBack();
    await page1.waitForLoadState("networkidle");

    // Verify Rejoin Fails (Error Modal)
    const modal = utils.findModal(page1, "rejoin-error");
    await expect(modal).toBeVisible();

    // Verify player does NOT reappear in list
    await expect(page2.locator(".list-group-item:has-text('P1')")).not.toBeVisible();
    await expect(page3.locator(".list-group-item:has-text('P1')")).not.toBeVisible();
    await expect(page4.locator(".list-group-item:has-text('P1')")).not.toBeVisible();

    // P3 (not current) disconnects
    await page3.goto("about:blank");

    // Verify disconnected player disappears from list
    await expect(page2.locator(".list-group-item:has-text('P3')")).not.toBeVisible();
    await expect(page4.locator(".list-group-item:has-text('P3')")).not.toBeVisible();

    // Verify "disconnected" message
    await expect(utils.findLogArea(page2)).toContainText("P3 has disconnected");
    await expect(utils.findLogArea(page4)).toContainText("P3 has disconnected");

    // Verify turn does not change, but next does
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page4)).toContainText("It's P2's turn, your turn is next");

    // Reconnect attempt by disconnected player
    await page3.goBack();
    await page3.waitForLoadState("networkidle");

    // Verify player reappears in list
    await expect(page2.locator(".list-group-item:has-text('P3')")).toBeVisible();
    await expect(page3.locator(".list-group-item:has-text('P3')")).toBeVisible();
    await expect(page4.locator(".list-group-item:has-text('P3')")).toBeVisible();

    // Verify "rejoined" message
    await expect(utils.findLogArea(page2)).toContainText("P3 has rejoined the game");
    await expect(utils.findLogArea(page4)).toContainText("P3 has rejoined the game");

    // Verify hand layout is correct (not 1 column)
    // We expect 8 cards. If layout is broken (width 0), we get 8 rows.
    // If layout is working, we get 1 or 2 rows.
    await expect(utils.findHand(page3)).toBeVisible();
    await expect(utils.findAllHandCards(page3)).toHaveCount(8);
    const rowCount = await page3.locator("div[data-areaname='hand'] > div[data-rfd-droppable-id]").count();
    expect(rowCount).toBeLessThan(8);
    expect(rowCount).toBeGreaterThan(0);

    // Verify turn changes
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page3)).toContainText("It's P2's turn, your turn is next");
    await expect(utils.findTurnArea(page4)).toContainText("It's P2's turn");

    // P2 (current) leaves game voluntarily
    await utils.leaveGame(page2);

    // Verify turn changes
    await expect(utils.findTurnArea(page3)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page4)).toContainText("It's P3's turn, your turn is next");

    // P4 (not current) leaves game voluntarily
    await utils.leaveGame(page4);

    // Winner should see win dialog
    const winModal = utils.findModal(page3, "game-end");
    await expect(winModal).toBeVisible();
    await expect(winModal.locator(" .modal-title")).toContainText("You win!");
    await page3.click(Buttons.OK);
    await utils.waitForURL(page3, "/");
  });

  test("Draw: regular card", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Ensure it's P1's turn
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page2)).toContainText("your turn is next");
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);

    // Click draw pile
    await utils.findDrawPile(page1).click();

    // Verify Animation on P1
    const p1AnimatedHandCard = page1.locator(Locators.HAND_ANIMATION_CARD);
    await expect(p1AnimatedHandCard).toBeVisible();
    await expect(p1AnimatedHandCard).toHaveAttribute("src", /back\.png/);

    // Verify Animation on P2
    const p2AnimatedHandCard = page2.locator(Locators.HAND_ANIMATION_CARD);
    await expect(p2AnimatedHandCard).toBeVisible();
    await expect(p2AnimatedHandCard).toHaveAttribute("src", /back\.png/);

    // Verify overlay on P1
    await expect(utils.findOverlay(page1, "inspect-card")).toBeVisible();
    await page1.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page1, "inspect-card")).toBeHidden();

    // Verify hand count +1
    await expect(utils.findAllHandCards(page1)).toHaveCount(9);

    // Verify log message indicating turn advancement
    await expect(utils.findLogArea(page1)).toContainText("P1 drew a card");
    await expect(utils.findLogArea(page2)).toContainText("P1 drew a card");

    // Verify turn passed to P2
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
  });

  test("Draw: dismiss drawn-card overlay", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const code = await utils.createGame(page1, "P1");

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // P1 draws a card
    await utils.findDrawPile(page1).click();

    // Verify overlay appears
    const p1Overlay = utils.findOverlay(page1, "inspect-card");
    await expect(p1Overlay).toBeVisible();

    // Click to dismiss (should disappear immediately)
    await p1Overlay.click();
    await expect(p1Overlay).toBeHidden();

    // Verify turn passes to P2
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");

    // P2 draws a card
    await utils.findDrawPile(page2).click();

    // Verify overlay appears
    const p2Overlay = utils.findOverlay(page2, "inspect-card");
    await expect(p2Overlay).toBeVisible();

    // Press <escape> to dismiss
    await page2.keyboard.press("Escape");
    await expect(p2Overlay).toBeHidden();

    // Verify turn passes to P1
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // P1 draws a card
    await utils.findDrawPile(page1).click();

    // Verify overlay appears
    await expect(p1Overlay).toBeVisible();

    // Do nothing to dismiss (should disappear automatically in time)
    await expect(p1Overlay).toBeHidden();
  });

  // This test proves the basic game play loop - action/reaction/resolution -
  // works.  It uses NAK because NAK is the simplest card and has no effect
  // when played as an action.
  test("Play: NAK action, NAK reaction", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify P1's NAK cards are playable
    const p1Naks = utils.findHandCardsByClass(page1, CardClass.Nak);
    await expect(p1Naks).toHaveCount(2);
    await expect(p1Naks.nth(0)).toHaveAttribute("data-playable", "true");
    await expect(p1Naks.nth(1)).toHaveAttribute("data-playable", "true");

    // Verify P2's NAK card is not playable
    const p2Naks = utils.findHandCardsByClass(page2, CardClass.Nak);
    await expect(p2Naks).toHaveCount(1);
    await expect(p2Naks.nth(0)).toHaveAttribute("data-playable", "false");

    let lastNak = "";

    // 1. P1 plays NAK, start reaction phase
    await utils.playCard(page1, p1Naks.nth(1));

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(utils.findLogArea(page1)).toContainText("P1 played NAK");
    await expect(utils.findLogArea(page2)).toContainText("P1 played NAK");
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator("img")).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator("img").getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify that P2's NAK is playable
    await expect(p2Naks.nth(0)).toHaveAttribute("data-playable", "true");

    // 2. P2 plays NAK, restart reaction phase
    await utils.playCard(page2, p2Naks.nth(0));

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(utils.findLogArea(page1)).toContainText("P2 played NAK");
    await expect(utils.findLogArea(page2)).toContainText("P2 played NAK");
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator("img")).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator("img").getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Want to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Waiting for other players to react");

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify that P1's NAK is playable
    await expect(p1Naks.nth(0)).toHaveAttribute("data-playable", "true");

    // 3. P1 plays NAK, restart reaction phase
    await utils.playCard(page1, p1Naks.nth(0));

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(6);
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(utils.findLogArea(page1)).toContainText("P1 played NAK");
    await expect(utils.findLogArea(page2)).toContainText("P1 played NAK");
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("alt");
    await expect(p1DiscardPile.locator("img")).not.toHaveAttribute("alt", lastNak);
    lastNak = await p1DiscardPile.locator("img").getAttribute("alt");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing NAK played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing NAK played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("P1 NAKed P2's NAK");
    await expect(utils.findLogArea(page2)).toContainText("P1 NAKed P2's NAK");
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[1]: Executing NAK played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[1]: Executing NAK played by "P1"');
  });

  test("Play: SHUFFLE", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Find P1's SHUFFLE card
    const p1Card = utils.findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Card).toBeVisible();

    // P1 plays SHUFFLE, start reaction phase
    await utils.playCard(page1, p1Card);

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(utils.findLogArea(page1)).toContainText("P1 played SHUFFLE");
    await expect(utils.findLogArea(page2)).toContainText("P1 played SHUFFLE");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("The deck was shuffled");
    await expect(utils.findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test("Play: SHUFFLE NOW", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Find P2's SHUFFLE_NOW card
    const p2Card = utils.findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2Card).toBeVisible();

    // P1 draws (P2 has the card we want)
    await utils.drawCard(page1);
    await expect(utils.findAllHandCards(page1)).toHaveCount(9);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Verify turn advance
    await expect(utils.findTurnArea(page1)).toContainText("It's P2's turn");
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");

    // P2 plays SHUFFLE_NOW, start reaction phase
    await utils.playCard(page2, p2Card);

    // Verify UI
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(utils.findLogArea(page1)).toContainText("P2 played SHUFFLE_NOW");
    await expect(utils.findLogArea(page2)).toContainText("P2 played SHUFFLE_NOW");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Want to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Waiting for other players to react");

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(utils.findLogArea(page1)).toContainText("The deck was shuffled");
    await expect(utils.findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test("Play: SHUFFLE NOW by non-current player", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Find P2's SHUFFLE_NOW card
    const p2Card = utils.findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2Card).toBeVisible();

    // P2 plays SHUFFLE_NOW, start reaction phase
    await utils.playCard(page2, p2Card);

    // Verify UI
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ShuffleNow);
    await expect(utils.findLogArea(page1)).toContainText("P2 played SHUFFLE_NOW");
    await expect(utils.findLogArea(page2)).toContainText("P2 played SHUFFLE_NOW");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Want to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Waiting for other players to react");

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing SHUFFLE_NOW played by "P2"');
    await expect(utils.findLogArea(page2)).toContainText("The deck was shuffled");
  });

  test("Play: racing NAKs", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Find the important elements of the page
    const p1Shuffle = utils.findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Shuffle).toBeVisible();
    await expect(p1Shuffle).toHaveAttribute("data-playable", "true");

    const p2Nak = utils.findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Nak).toBeVisible();
    await expect(p2Nak).toHaveAttribute("data-playable", "false");

    const p2Discard = utils.findDiscardPileDropTarget(page2);
    await expect(p2Discard).toBeVisible();

    const p3Nak = utils.findHandCardsByClass(page3, CardClass.Nak).first();
    await expect(p3Nak).toBeVisible();
    await expect(p3Nak).toHaveAttribute("data-playable", "false");

    // P1 plays SHUFFLE, enter reaction phase
    await utils.playCard(page1, p1Shuffle);
    await expect(utils.findLogArea(page2)).toContainText("P1 played SHUFFLE");

    // Verify reaction phase
    const timerArea = utils.findTimerArea(page1);
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2Nak).toHaveAttribute("data-playable", "true");
    await expect(p3Nak).toHaveAttribute("data-playable", "true");

    // P2 starts to play NAK, but does not finish yet
    await p2Nak.scrollIntoViewIfNeeded();
    const p2SrcBox = await p2Nak.boundingBox();
    const p2DstBox = await p2Discard.boundingBox();
    if (!p2SrcBox) throw new Error("Bounding box not found for card");
    if (!p2DstBox) throw new Error("Bounding box not found for pile");
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2, p2SrcBox.y + p2SrcBox.height / 2);
    await page2.mouse.down();
    // Move a bit to start drag
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2 + 20, p2SrcBox.y + p2SrcBox.height / 2 + 20);

    // P3 plays NAK, restart reaction phase, updates nonce to N2
    await utils.playCard(page3, p3Nak);
    await expect(utils.findLogArea(page2)).toContainText("P3 played NAK");

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);

    // P2 finishes their play, drops NAK, but sends nonce N1
    await page2.mouse.move(p2DstBox.x + p2DstBox.width / 2, p2DstBox.y + p2DstBox.height / 2, { steps: 20 });
    await page2.mouse.up();

    // Verify rejection dialog on P2
    const conflictModal = utils.findModal(page2, "operation-conflict");
    await expect(conflictModal).toBeVisible();

    // P2 acknowledges
    await conflictModal.getByRole("button", { name: "OK" }).click();

    // Verify P2 did not play
    await expect(utils.findLogArea(page1)).not.toContainText("P2 played NAK");
  });

  test("Play: exhaustive action, reaction", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const timerArea = utils.findTimerArea(page1);
    await expect(timerArea).toBeHidden();

    // Verify P1's lone DEVELOPER is not playable but others are.
    const p1Shuffle = utils.findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Shuffle).toHaveAttribute("data-playable", "true");
    const p1Nak = utils.findHandCardsByClass(page1, CardClass.Nak).first();
    await expect(p1Nak).toHaveAttribute("data-playable", "true");

    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3)
    let foundPlayable = false;
    let foundUnplayable = false;
    for (const card of await devCards.all()) {
      const playable = await card.getAttribute("data-playable");
      if (playable === "true") {
        foundPlayable = true;
      } else if (playable === "false") {
        foundUnplayable = true;
      } else {
        throw new Error(`Unexpected data-playable value: ${playable} (${typeof playable})`);
      }
    }
    expect(foundPlayable).toBe(true);
    expect(foundUnplayable).toBe(true);

    // Verify P2's SHUFFLE_NOW is playable and not others.
    const p2ShuffleNow = utils.findHandCardsByClass(page2, CardClass.ShuffleNow).first();
    await expect(p2ShuffleNow).toHaveAttribute("data-playable", "true");
    const p2Debug = utils.findHandCardsByClass(page2, CardClass.Debug).first();
    await expect(p2Debug).toHaveAttribute("data-playable", "false");
    const p2Nak = utils.findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Nak).toHaveAttribute("data-playable", "false");
    const p2Skip = utils.findHandCardsByClass(page2, CardClass.Skip).first();
    await expect(p2Skip).toHaveAttribute("data-playable", "false");

    // P1 plays SHUFFLE, restart reaction phase
    await utils.playCard(page1, p1Shuffle);
    await expect(utils.findLogArea(page2)).toContainText("P1 played SHUFFLE");

    // Verify reaction phase
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(timerArea).toBeVisible();
    await expect(page1.getByText("Waiting for other players to react")).toBeVisible();
    await expect(page2.getByText("Want to react")).toBeVisible();

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify that P2's NAK and SHUFFLE_NOW cards are playable
    await expect(p2Nak).toHaveAttribute("data-playable", "true");
    await expect(p2ShuffleNow).toHaveAttribute("data-playable", "true");

    // P2 plays NAK, restart reaction phase
    await utils.playCard(page2, p2Nak);
    await expect(utils.findLogArea(page1)).toContainText("P2 played NAK");

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(page1.getByText("Want to react")).toBeVisible();
    await expect(page2.getByText("Waiting for other players to react")).toBeVisible();

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify that P1's NAK is playable
    await expect(p1Nak).toHaveAttribute("data-playable", "true");

    // P1 plays NAK, restart reaction phase
    await utils.playCard(page1, p1Nak);
    await expect(utils.findLogArea(page2)).toContainText("P1 played NAK");

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(page1.getByText("Waiting for other players to react")).toBeVisible();
    await expect(page2.getByText("Want to react")).toBeVisible();

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify that P2's SHUFFLE_NOW card is playable
    await expect(p2ShuffleNow).toHaveAttribute("data-playable", "true");

    // P2 plays SHUFFLE_NOW, restart reaction phase
    await utils.playCard(page2, p2ShuffleNow);
    await expect(utils.findLogArea(page1)).toContainText("P2 played SHUFFLE_NOW");

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(page1.getByText("Want to react")).toBeVisible();
    await expect(page2.getByText("Waiting for other players to react")).toBeVisible();

    // P1 plays another NAK, restart reaction phase
    const p1Nak2 = utils.findHandCardsByClass(page1, CardClass.Nak).first();
    await utils.playCard(page1, p1Nak2);
    await expect(utils.findLogArea(page2)).toContainText("P1 played NAK");

    // Verify reaction phase
    await expect(timerArea).toBeVisible();
    await expect(timerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(page1.getByText("Waiting for other players to react")).toBeVisible();
    await expect(page2.getByText("Want to react")).toBeVisible();

    // Verify that none of P1's or P2's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }
  });

  test("Play: SHUFFLE action, NAK reaction", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Find P1's SHUFFLE card
    const p1Card = utils.findHandCardsByClass(page1, CardClass.Shuffle).first();
    await expect(p1Card).toBeVisible();

    // Find P2's NAK card
    const p2Card = utils.findHandCardsByClass(page2, CardClass.Nak).first();
    await expect(p2Card).toBeVisible();

    // 1. P1 plays SHUFFLE, start reaction phase
    await utils.playCard(page1, p1Card);

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Shuffle);
    await expect(utils.findLogArea(page1)).toContainText("P1 played SHUFFLE");
    await expect(utils.findLogArea(page2)).toContainText("P1 played SHUFFLE");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // 2. P2 plays NAK (negating SHUFFLE)
    await utils.playCard(page2, p2Card);

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.NAK);
    await expect(utils.findLogArea(page1)).toContainText("P2 played NAK");
    await expect(utils.findLogArea(page2)).toContainText("P2 played NAK");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Want to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Waiting for other players to react");

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing NAK played by "P2"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing NAK played by "P2"');
    await expect(utils.findLogArea(page1)).toContainText("P2 NAKed P1's SHUFFLE");
    await expect(utils.findLogArea(page2)).toContainText("P2 NAKed P1's SHUFFLE");
  });

  test("Play: FAVOR (2 players)", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await page1.waitForLoadState("networkidle"); // Wait for page to fully load
    await page2.waitForLoadState("networkidle"); // Wait for page to fully load

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Verify P1 has a FAVOR
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();
    await expect(favorCard).toBeVisible();

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // Verify the choose-victim modal DOES NOT appear
    const chooseVictimModal = utils.findModal(page1, "favor-choose-victim");
    await expect(chooseVictimModal).not.toBeVisible();

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(utils.findLogArea(page1)).toContainText("P1 asked P2 for a FAVOR");
    await expect(utils.findLogArea(page2)).toContainText("P1 asked P2 for a FAVOR");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify card choice modal on P2
    const chooseCardModal = utils.findModal(page2, "favor-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify P2 hand is shown
    await expect(page2.locator(".modal-body img")).toHaveCount(8); // P2 had 8 cards

    // P2 chooses first card
    await page2.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify P1 sees overlay
    await expect(utils.findOverlay(page1, "favor-result")).toBeVisible();
    await expect(utils.findOverlay(page1, "favor-result")).toContainText("You received:");
    await expect(page1.locator("h2")).toContainText("You received:");
    await page1.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page1, "favor-result")).toBeHidden();

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("P2 gave P1 a card.");
    await expect(utils.findLogArea(page2)).toContainText("P2 gave P1 a card.");

    // Verify Counts
    await expect(utils.findAllHandCards(page1)).toHaveCount(8); // 8 start - 1 played + 1 received
    await expect(utils.findAllHandCards(page2)).toHaveCount(7); // 8 - 1
  });

  test("Play: FAVOR (4 players)", async ({ browser }) => {
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
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);
    await utils.joinGame(page4, "P4", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");
    await utils.waitForURL(page4, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findAllHandCards(page3)).toHaveCount(8);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);

    // Verify P1 has a FAVOR
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();
    await expect(favorCard).toBeVisible();

    // Make sure P3 has no cards
    for (let i = 0; i < 8; i++) {
      await page3.click(Buttons.DEV_PUT_CARD_BACK);
      await expect(utils.findAllHandCards(page3)).toHaveCount(8-(i+1));
    }
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // Verify the choose-victim modal appears
    const chooseVictimModal = utils.findModal(page1, "favor-choose-victim");
    await expect(chooseVictimModal).toBeVisible();
    // Verify player list: P2 should be present, P3 (empty hand) and P1 (self) should not.
    const modalBody = chooseVictimModal.locator(".modal-body");
    await expect(modalBody.locator(".list-group-item", { hasText: "P1" })).not.toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P2" })).toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P3" })).not.toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P4" })).toBeVisible();

    // Select P2
    await page1.click("text=P2 (8 cards)");
    await page1.click("button:has-text('Ask Favor')");

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(7);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Favor);
    await expect(utils.findLogArea(page1)).toContainText("P1 asked P2 for a FAVOR");
    await expect(utils.findLogArea(page2)).toContainText("P1 asked P2 for a FAVOR");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify card choice modal on P2
    const chooseCardModal = utils.findModal(page2, "favor-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify P2 hand is shown
    await expect(page2.locator(".modal-body img")).toHaveCount(8); // P2 had 8 cards

    // P2 chooses first card
    await page2.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify P1 sees overlay
    await expect(utils.findOverlay(page1, "favor-result")).toBeVisible();
    await expect(utils.findOverlay(page1, "favor-result")).toContainText("You received:");
    await expect(page1.locator("h2")).toContainText("You received:");
    await page1.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page1, "favor-result")).toBeHidden();

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page3)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page4)).toContainText('DEV: op[0]: Executing FAVOR played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("P2 gave P1 a card.");
    await expect(utils.findLogArea(page2)).toContainText("P2 gave P1 a card.");
    await expect(utils.findLogArea(page3)).toContainText("P2 gave P1 a card.");
    await expect(utils.findLogArea(page4)).toContainText("P2 gave P1 a card.");

    // Verify Counts
    await expect(utils.findAllHandCards(page1)).toHaveCount(8); // 8 start - 1 played + 1 received
    await expect(utils.findAllHandCards(page2)).toHaveCount(7); // 8 - 1
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);
  });

  test("Play: DEVELOPER 2x Combo (2 players)", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Verify P1 hand
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [ card1, card2 ] = await utils.findPair(devCards);

    // Select Pair
    await card2.scrollIntoViewIfNeeded();
    await card2.click();
    await page1.keyboard.down("Shift");
    await card1.scrollIntoViewIfNeeded();
    await card1.click();
    await page1.keyboard.up("Shift");

    // Drag to Discard
    const discardPile = utils.findDiscardPile(page1);
    const srcBox = await card1.boundingBox();
    const dstBox = await discardPile.boundingBox();
    if (!srcBox || !dstBox) throw new Error("Missing bounding box");

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // Verify victim modal DOES NOT appear
    const chooseVictimModal = utils.findModal(page1, "steal-choose-victim");
    await expect(chooseVictimModal).not.toBeVisible();

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(6);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(utils.findLogArea(page1)).toContainText("P1 wants to steal a card from P2");
    await expect(utils.findLogArea(page2)).toContainText("P1 wants to steal a card from P2");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify Card Choice Modal on P1
    const chooseCardModal = utils.findModal(page1, "steal-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify card backs (P2 has 8 cards)
    await expect(page1.locator(".modal-body img")).toHaveCount(8);

    // Pick first card
    await chooseCardModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify overlays
    await expect(utils.findOverlay(page1, "combo-result")).toBeVisible();
    await expect(utils.findOverlay(page1, "combo-result")).toContainText("You stole:");
    await expect(utils.findOverlay(page2, "combo-result")).toBeVisible();
    await expect(utils.findOverlay(page2, "combo-result")).toContainText("P1 stole your:");
    await page1.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page1, "combo-result")).toBeHidden();
    await page2.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page2, "combo-result")).toBeHidden();

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P2");
    await expect(utils.findLogArea(page2)).toContainText("P1 stole a card from P2");

    // Verify Counts
    await expect(utils.findAllHandCards(page1)).toHaveCount(7); // 8 start - 2 played + 1 received
    await expect(utils.findAllHandCards(page2)).toHaveCount(7); // 8 - 1
  });

  test("Play: DEVELOPER 2x Combo (4 players)", async ({ browser }) => {
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
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);
    await utils.joinGame(page4, "P4", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");
    await utils.waitForURL(page4, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findAllHandCards(page3)).toHaveCount(8);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);

    // Verify P1 hand
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [ card1, card2 ] = await utils.findPair(devCards);

    // Make sure P3 has no cards
    for (let i = 0; i < 8; i++) {
      await page3.click(Buttons.DEV_PUT_CARD_BACK);
      await expect(utils.findAllHandCards(page3)).toHaveCount(8-(i+1));
    }
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);

    // Select Pair
    await card2.scrollIntoViewIfNeeded();
    await card2.click();
    await page1.keyboard.down("Shift");
    await card1.scrollIntoViewIfNeeded();
    await card1.click();
    await page1.keyboard.up("Shift");

    // Drag to Discard
    const discardPile = utils.findDiscardPile(page1);
    const srcBox = await card1.boundingBox();
    const dstBox = await discardPile.boundingBox();
    if (!srcBox || !dstBox) throw new Error("Missing bounding box");

    await page1.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page1.mouse.down();
    await page1.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 20 });
    await page1.mouse.up();

    // Verify Victim Modal appears
    const chooseVictimModal = utils.findModal(page1, "steal-choose-victim");
    await expect(chooseVictimModal).toBeVisible();
    // Verify player list: P2 should be present, P3 (empty hand) and P1 (self) should not.
    const modalBody = chooseVictimModal.locator(".modal-body");
    await expect(modalBody.locator(".list-group-item", { hasText: "P1" })).not.toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P2" })).toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P3" })).not.toBeVisible();
    await expect(modalBody.locator(".list-group-item", { hasText: "P4" })).toBeVisible();

    // Select P2
    await page1.click("text=P2 (8 cards)");
    await page1.click("button:has-text('Steal Card')");

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(6);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Developer);
    await expect(utils.findLogArea(page1)).toContainText("P1 wants to steal a card from P2");
    await expect(utils.findLogArea(page2)).toContainText("P1 wants to steal a card from P2");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Want to react");

    // Verify that none of P1's cards are playable
    for (const card of await utils.findAllHandCards(page1).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // Verify Card Choice Modal on P1
    const chooseCardModal = utils.findModal(page1, "steal-choose-card");
    await expect(chooseCardModal).toBeVisible();
    // Verify card backs (P2 has 8 cards)
    await expect(page1.locator(".modal-body img")).toHaveCount(8);

    // Pick first card
    await chooseCardModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(chooseCardModal).toBeHidden();

    // Verify overlays
    await expect(utils.findOverlay(page1, "combo-result")).toBeVisible();
    await expect(utils.findOverlay(page1, "combo-result")).toContainText("You stole:");
    await expect(utils.findOverlay(page2, "combo-result")).toBeVisible();
    await expect(utils.findOverlay(page2, "combo-result")).toContainText("P1 stole your:");
    await page1.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page1, "combo-result")).toBeHidden();
    await page2.keyboard.press("Escape"); // dismiss
    await expect(utils.findOverlay(page2, "combo-result")).toBeHidden();

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page3)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page4)).toContainText('DEV: op[0]: Executing DEVELOPER played by "P1"');
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P2");
    await expect(utils.findLogArea(page2)).toContainText("P1 stole a card from P2");
    await expect(utils.findLogArea(page3)).toContainText("P1 stole a card from P2");
    await expect(utils.findLogArea(page4)).toContainText("P1 stole a card from P2");

    // Verify Counts
    await expect(utils.findAllHandCards(page1)).toHaveCount(7); // 8 start - 2 played + 1 received
    await expect(utils.findAllHandCards(page2)).toHaveCount(7); // 8 - 1
    await expect(utils.findAllHandCards(page3)).toHaveCount(0);
    await expect(utils.findAllHandCards(page4)).toHaveCount(8);
  });

  test("Play: SEE THE FUTURE", async ({ browser }) => {
    // Make pages large to avoid any need to scroll the hand area.
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup game
    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();
    const p2TimerArea = utils.findTimerArea(page2);
    await expect(p2TimerArea).toBeHidden();

    const p1DiscardPile = utils.findDiscardPile(page1);
    await expect(p1DiscardPile.locator("img")).not.toBeVisible();
    const p2DiscardPile = utils.findDiscardPile(page2);
    await expect(p2DiscardPile.locator("img")).not.toBeVisible();

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // P2 has the SEE THE FUTURE card
    await utils.drawCard(page1);
    await expect(utils.findTurnArea(page1)).toContainText("your turn is next");
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");

    // Show the deck to get top 3 cards
    await page2.click(Buttons.DEV_SHOW_DECK);
    const deckOverlay = utils.findOverlay(page2, "show-deck");
    await expect(deckOverlay).toBeVisible();
    const deckCards = await deckOverlay.locator("img").all();
    const top3CardClasses = await Promise.all(deckCards.slice(0, 3).map(async (img) => await img.getAttribute("alt")));
    await page2.keyboard.press("Escape"); // Dismiss deck view

    // P2 plays SEE THE FUTURE
    const card = utils.findHandCardsByClass(page2, CardClass.SeeTheFuture);
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await utils.playCard(page2, card);

    // Verify UI
    await expect(utils.findAllHandCards(page1)).toHaveCount(9);
    await expect(utils.findAllHandCards(page2)).toHaveCount(7);
    await expect(p1DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.SeeTheFuture);
    await expect(p2DiscardPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.SeeTheFuture);
    await expect(utils.findLogArea(page1)).toContainText("P2 played SEE_THE_FUTURE");
    await expect(utils.findLogArea(page2)).toContainText("P2 played SEE_THE_FUTURE");

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Want to react");
    await expect(p2TimerArea).toBeVisible();
    await expect(p2TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p2TimerArea).toContainText("Waiting for other players to react");

    // Verify that none of P2's cards are playable
    for (const card of await utils.findAllHandCards(page2).all()) {
      await expect(card).toHaveAttribute("data-playable", "false");
    }

    // P1 should NOT see the overlay
    await expect(utils.findOverlay(page1, "see-the-future")).not.toBeVisible();

    // Verify P2 sees See The Future overlay
    const p2SeeTheFutureOverlay = utils.findOverlay(page2, "see-the-future");
    await expect(p2SeeTheFutureOverlay).toBeVisible();
    await expect(p2SeeTheFutureOverlay.locator("h2")).toContainText("See The Future");
    const cardsInOverlay = p2SeeTheFutureOverlay.locator("img");
    await expect(cardsInOverlay).toHaveCount(3);

    // Verify the cards in the overlay are the top 3 from the deck
    const allCardsInOverlay = await cardsInOverlay.all();
    const overlayCardAlts = await Promise.all(allCardsInOverlay.map(async (img) => await img.getAttribute("alt")));
    expect(overlayCardAlts[0]).toContain(top3CardClasses[0]);
    expect(overlayCardAlts[1]).toContain(top3CardClasses[1]);
    expect(overlayCardAlts[2]).toContain(top3CardClasses[2]);

    // P2 dismisses overlay
    await page2.keyboard.press("Escape");

    // Verify P2 overlay is gone
    await expect(utils.findOverlay(page2, "see-the-future")).toBeHidden();

    // Verify execution
    await expect(utils.findLogArea(page1)).toContainText('DEV: op[0]: Executing SEE_THE_FUTURE played by "P2"');
    await expect(utils.findLogArea(page2)).toContainText('DEV: op[0]: Executing SEE_THE_FUTURE played by "P2"');
    await expect(utils.findLogArea(page1)).toContainText("P2 saw the future");
    await expect(utils.findLogArea(page2)).toContainText("P2 saw the future");
  });

  test("Play: SKIP", async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);

    // P2 plays SKIP
    const p2Skip = utils.findHandCardsByClass(page2, CardClass.Skip);
    await expect(p2Skip).toHaveCount(1);
    await utils.playCard(page2, p2Skip);

    // Turn should change to P1 without a draw.
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("Play: ATTACK", async ({ browser }) => {
    test.setTimeout(60000);

    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);

    // P2 plays ATTACK
    const p2Attack = utils.findHandCardsByClass(page2, CardClass.Attack);
    await expect(p2Attack).toHaveCount(1);
    await utils.playCard(page2, p2Attack);

    // Wait for P1 turn and verify 2 turns
    await expect(utils.findTurnArea(page1)).toContainText("You have been attacked! You must take 2 turns");

    // P1 plays ATTACK, stacking
    const p1Attack = utils.findHandCardsByClass(page1, CardClass.Attack);
    await expect(p1Attack).toHaveCount(1);
    await utils.playCard(page1, p1Attack);

    // Wait for P2 turn and verify 4 turns
    await expect(utils.findTurnArea(page2)).toContainText("You have been attacked! You must take 4 turns");

    // P2 plays SKIP, consuming 1 turn
    const p2Skip = utils.findHandCardsByClass(page2, CardClass.Skip);
    await expect(p2Skip).toHaveCount(1);
    await utils.playCard(page2, p2Skip);

    // Wait for reaction/execution and verify 3 turns remaining
    // Since it's still P2's turn, we wait for the text update
    await expect(utils.findTurnArea(page2)).toContainText("You have been attacked! You must take 3 more turns");

    // P2 Draws
    await utils.drawCard(page2);

    // Verify 2 turns remaining
    await expect(utils.findTurnArea(page2)).toContainText("You have been attacked! You must take 2 more turns");
  });

  test("Play: ATTACK vs. EXPLODING and UPGRADE CLUSTER", async ({ browser }) => {
    test.setTimeout(60000);

    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Verify hands
    await expect(utils.findAllHandCards(page1)).toHaveCount(8);
    await expect(utils.findAllHandCards(page2)).toHaveCount(8);
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // Safe draws to get past the first part of the fixed DEVMODE deck
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);

    // P1 plays ATTACK
    const p1Attack = utils.findHandCardsByClass(page1, CardClass.Attack);
    await expect(p1Attack).toHaveCount(1);
    await utils.playCard(page1, p1Attack);

    // Verify P2 turn bar says "2 turns"
    await expect(utils.findTurnArea(page2)).toContainText("You have been attacked! You must take 2 turns");

    // P2 draws, explodes, debugs, inserts at 20
    const p2DrawPile = utils.findDrawPile(page2);
    await p2DrawPile.click();

    // Handle Exploding Cluster
    const p2Overlay = utils.findOverlay(page2, "inspect-card");
    await expect(p2Overlay).toBeVisible();
    await p2Overlay.click(); // Dismiss
    await expect(p2Overlay).toBeHidden();

    // P2 plays DEBUG
    const p2Debug = utils.findHandCardsByClass(page2, CardClass.Debug).first();
    await utils.playCard(page2, p2Debug);

    // Verify insertion modal
    const p2InsertModal = utils.findModal(page2, "exploding-reinsert");
    await expect(p2InsertModal).toBeVisible();
    await p2InsertModal.locator("input[type='number']").fill("20");
    await p2InsertModal.getByRole("button", { name: "OK", exact: true }).click();

    // Verify P2 turn bar says "1 more turn"
    await expect(utils.findTurnArea(page2)).toContainText("You have been attacked! You must take 1 more turn");

    // P2 draws second turn
    await utils.drawCard(page2);

    // P1 turn
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // Sequence of safe draws
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);

    // P2 plays ATTACK
    const p2Attack = utils.findHandCardsByClass(page2, CardClass.Attack);
    await expect(p2Attack).toHaveCount(1);
    await utils.playCard(page2, p2Attack);

    // Verify P1 turn bar says "2 turns"
    await expect(utils.findTurnArea(page1)).toContainText("You have been attacked! You must take 2 turns");

    // P1 draws, safe
    await utils.drawCard(page1);
    await expect(utils.findTurnArea(page1)).toContainText("You have been attacked! You must take 1 more turn");

    // P1 draws UPGRADE CLUSTER, insert at 1
    const p1DrawPile = utils.findDrawPile(page1);
    await p1DrawPile.click();

    // Handle Upgrade Cluster
    const p1Overlay = utils.findOverlay(page1, "inspect-card");
    await expect(p1Overlay).toBeVisible();
    await p1Overlay.click(); // Dismiss
    await expect(p1Overlay).toBeHidden();

    const p1UpgradeModal = utils.findModal(page1, "upgrade-reinsert");
    await expect(p1UpgradeModal).toBeVisible();
    await p1UpgradeModal.locator("input[type='number']").fill("0");
    await p1UpgradeModal.getByRole("button", { name: "OK", exact: true }).click();

    // Verify P2 turn
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(p2DrawPile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
  });

  test("Draw: EXPLODING CLUSTER", async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (p1: string, page1: Page, p2: string, page2: Page, p3: string, page3: Page, hide: number) => {
      const p1Overlay = utils.findOverlay(page1, "inspect-card");
      const p2Overlay = utils.findOverlay(page2, "inspect-card");
      const p3Overlay = utils.findOverlay(page3, "inspect-card");

      // P1 draws a card
      await utils.drawCard(page1);

      // Verify overlays
      await expect(p1Overlay).toBeHidden();
      await expect(p2Overlay).toBeVisible();
      await expect(p3Overlay).toBeVisible();
      await expect(utils.findLogArea(page1)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(utils.findLogArea(page2)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);
      await expect(utils.findLogArea(page3)).toContainText(`${p1} drew an EXPLODING CLUSTER!`);

      // Discard piles should show EXPLODING CLUSTER
      const p1Pile = utils.findDiscardPile(page1);
      const p2Pile = utils.findDiscardPile(page2);
      const p3Pile = utils.findDiscardPile(page3);
      await expect(p1Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);
      await expect(p2Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);
      await expect(p3Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify P1 messages
      await expect(utils.findTimerArea(page1)).toContainText("PLAY A DEBUG CARD");
      await expect(utils.findTurnArea(page1)).toContainText("Your cluster is exploding");

      // Verify P2 messages
      await expect(utils.findTimerArea(page2)).toContainText(`Waiting for ${p1} to debug`);
      await expect(utils.findTurnArea(page2)).toContainText("your turn is next");

      // Verify P3 messages
      await expect(utils.findTimerArea(page3)).toContainText(`Waiting for ${p1} to debug`);
      await expect(utils.findTurnArea(page3)).toContainText(`It's ${p1}'s turn`);

      // Verify EXPLODING CLUSTER is NOT in anyone's hand
      await expect(utils.findHandCardsByClass(page1, CardClass.ExplodingCluster)).toHaveCount(0);
      await expect(utils.findHandCardsByClass(page2, CardClass.ExplodingCluster)).toHaveCount(0);
      await expect(utils.findHandCardsByClass(page3, CardClass.ExplodingCluster)).toHaveCount(0);

      // Verify P1 can play DEBUG and P2, P3 cannot (or don't have one)
      const p1Debug = utils.findHandCardsByClass(page1, CardClass.Debug);
      await expect(p1Debug.first()).toBeVisible();
      await expect(p1Debug.first()).toHaveAttribute("data-playable", "true");
      const p2Debug = utils.findHandCardsByClass(page2, CardClass.Debug);
      if (await p2Debug.count() > 0) {
        await expect(p2Debug.first()).toHaveAttribute("data-playable", "false");
      }
      const p3Debug = utils.findHandCardsByClass(page3, CardClass.Debug);
      if (await p3Debug.count() > 0) {
        await expect(p3Debug.first()).toHaveAttribute("data-playable", "false");
      }

      // Verify no messages have been sent yet
      await expect(utils.findLogArea(page1)).not.toContainText(`${p1}'s cluster almost exploded`);
      await expect(utils.findLogArea(page2)).not.toContainText(`${p1}'s cluster almost exploded`);
      await expect(utils.findLogArea(page3)).not.toContainText(`${p1}'s cluster almost exploded`);

      // P1 plays DEBUG card
      await utils.playCard(page1, p1Debug);

      // Verify it was played and messages sent
      await expect(p1Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(p2Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(p3Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Debug);
      await expect(utils.findLogArea(page1)).toContainText(`${p1} played DEBUG`);
      await expect(utils.findLogArea(page2)).toContainText(`${p1} played DEBUG`);
      await expect(utils.findLogArea(page3)).toContainText(`${p1} played DEBUG`);
      await expect(utils.findLogArea(page1)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(utils.findLogArea(page2)).toContainText(`${p1}'s cluster almost exploded`);
      await expect(utils.findLogArea(page3)).toContainText(`${p1}'s cluster almost exploded`);

      // Verify the insertion dialog
      const insertModal = utils.findModal(page1, "exploding-reinsert");
      await expect(insertModal).toBeVisible();
      const input = insertModal.locator("input[type='number']");
      await expect(input).toBeVisible();

      // Re-insert it
      await input.fill(hide.toString());
      await insertModal.getByRole("button", { name: "OK", exact: true }).click();

      // Verify turn advance
      await expect(utils.findTurnArea(page1)).toContainText(`It's ${p2}'s turn`);
      await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
      await expect(utils.findTurnArea(page3)).toContainText("your turn is next");
    }

    // Setup game
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const code = await utils.createGame(page1, "P1");

    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page2 = await context2.newPage();
    await utils.joinGame(page2, "P2", code);

    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page3 = await context3.newPage();
    await utils.joinGame(page3, "P3", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Play begins - we have a fixed deck for DEVMODE, so we need to get past
    // initial safe draws
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // Verify everyone starts with 1 DEBUG
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await expect(utils.findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
    await expect(utils.findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P1 draws, explodes, and debugs
    await almostExplode("P1", page1, "P2", page2, "P3", page3, 0);
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(utils.findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(1);
    await expect(utils.findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P2 draws, explodes, and debugs
    await almostExplode("P2", page2, "P3", page3, "P1", page1, 0);
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(utils.findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(0);
    await expect(utils.findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(1);

    // P3 draws, explodes, and debugs
    await almostExplode("P3", page3, "P1", page1, "P2", page2, 3);
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(0);
    await expect(utils.findHandCardsByClass(page2, CardClass.Debug)).toHaveCount(0);
    await expect(utils.findHandCardsByClass(page3, CardClass.Debug)).toHaveCount(0);

    // Play continues - some more safe draws
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // P1 draws and explodes
    await utils.drawCard(page1)

    // Verify P1 is out
    await expect(utils.findLogArea(page1)).toContainText("P1's cluster has exploded");
    await expect(utils.findLogArea(page2)).toContainText("P1's cluster has exploded");
    await expect(utils.findLogArea(page3)).toContainText("P1's cluster has exploded");

    // Verify turn advance
    await expect(utils.findTurnArea(page1)).toContainText("You are OUT");
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page3)).toContainText("your turn is next");

    // Play continues (we have a fixed deck for DEVMODE)
    await utils.drawCard(page2);
    await expect(utils.findTurnArea(page2)).toContainText("your turn is next");
    await expect(utils.findTurnArea(page3)).toContainText("It's your turn");
    await utils.drawCard(page3);
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
    await expect(utils.findTurnArea(page3)).toContainText("your turn is next");

    // P2 draws and explodes
    await utils.drawCard(page2)

    // Verify P3 sees "You win!"
    const p3Modal = utils.findModal(page3, "game-end");
    await expect(p3Modal).toBeVisible();
    await expect(p3Modal).toContainText("You win!");

    // Verify other players' end of game messages
    const p1Modal = utils.findModal(page1, "game-end");
    await expect(p1Modal).toBeVisible();
    await expect(p1Modal).toContainText("P3 wins!");

    const p2Modal = utils.findModal(page2, "game-end");
    await expect(p2Modal).toBeVisible();
    await expect(p2Modal).toContainText("P3 wins!");
  });

  test("Draw: UPGRADE CLUSTER", async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (page: Page, hide: number) => {
      // Draw a card
      await utils.drawCard(page);
      const overlay = utils.findOverlay(page, "inspect-card");
      await expect(overlay).toBeHidden();

      // Discard pile should show EXPLODING CLUSTER
      const pile = utils.findDiscardPile(page);
      await expect(pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify we can play DEBUG
      const debug = utils.findHandCardsByClass(page, CardClass.Debug);
      await expect(debug.first()).toBeVisible();
      await expect(debug.first()).toHaveAttribute("data-playable", "true");

      // Play DEBUG card
      await utils.playCard(page, debug);

      // Verify it was played and messages sent
      await expect(pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Debug);

      // Verify the insertion dialog
      const insertModal = utils.findModal(page, "exploding-reinsert");
      await expect(insertModal).toBeVisible();
      const input = insertModal.locator("input[type='number']");
      await expect(input).toBeVisible();

      // Re-insert it
      await input.fill(hide.toString());
      await insertModal.getByRole("button", { name: "OK", exact: true }).click();
      await expect(utils.findTurnArea(page3)).toContainText("your turn is next");
    }

    // Setup game
    const context1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await context1.newPage();
    const code = await utils.createGame(page1, "P1");

    const context2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page2 = await context2.newPage();
    await utils.joinGame(page2, "P2", code);

    const context3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page3 = await context3.newPage();
    await utils.joinGame(page3, "P3", code);

    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Play begins - we have a fixed deck for DEVMODE, so we need to get past
    // initial draws
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    // More safe draws
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // Give P1 another DEBUG card to test multiple DEBUGs
    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();
    await debugBtn.click();
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    const p1Overlay = utils.findOverlay(page1, "inspect-card");
    const p2Overlay = utils.findOverlay(page2, "inspect-card");
    const p3Overlay = utils.findOverlay(page3, "inspect-card");

    const p1Pile = utils.findDiscardPile(page1);
    const p2Pile = utils.findDiscardPile(page2);
    const p3Pile = utils.findDiscardPile(page3);

    // P2 gets UPGRADE CLUSTER face-down
    await utils.drawCard(page2);

    // Verify overlays
    await expect(p1Overlay).toBeVisible();
    await expect(p2Overlay).toBeHidden();
    await expect(p3Overlay).toBeVisible();

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify the insertion dialog
    const p2InsertModal = utils.findModal(page2, "upgrade-reinsert");
    await expect(p2InsertModal).toBeVisible();
    const p2Input = p2InsertModal.locator("input[type='number']");
    await expect(p2Input).toBeVisible();

    // Re-insert it
    await p2Input.fill("2");
    await p2InsertModal.getByRole("button", { name: "OK", exact: true }).click();

    // Safe draws
    await utils.drawCard(page3);
    await utils.drawCard(page1);

    // P2 gets UPGRADE CLUSTER face-up
    await expect(utils.findDrawPile(page2).locator("img").first()).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await utils.drawCard(page2);

    // Verify P2 is out
    await expect(utils.findLogArea(page1)).toContainText("P2's cluster was upgraded out of existence");
    await expect(utils.findLogArea(page2)).toContainText("P2's cluster was upgraded out of existence");
    await expect(utils.findLogArea(page3)).toContainText("P2's cluster was upgraded out of existence");

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify turn advance
    await expect(utils.findTurnArea(page1)).toContainText("your turn is next");
    await expect(utils.findTurnArea(page2)).toContainText("You are OUT");
    await expect(utils.findTurnArea(page3)).toContainText("It's your turn");

    // P3 gets UPGRADE CLUSTER face-down
    await utils.drawCard(page3);

    // Verify overlays
    await expect(p1Overlay).toBeVisible();
    await expect(p2Overlay).toBeVisible();
    await expect(p3Overlay).toBeHidden();

    // Discard pile should show UPGRADE CLUSTER
    await expect(p1Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p2Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await expect(p3Pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify the insertion dialog
    const p3InsertModal = utils.findModal(page3, "upgrade-reinsert");
    await expect(p3InsertModal).toBeVisible();
    const p3Input = p3InsertModal.locator("input[type='number']");
    await expect(p3Input).toBeVisible();

    // Re-insert it
    await p3Input.fill("0");
    await p3InsertModal.getByRole("button", { name: "OK", exact: true }).click();

    // P1 gets UPGRADE CLUSTER face-up
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
    await expect(utils.findDrawPile(page1).locator("img").first()).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);
    await utils.drawCard(page1);

    // Verify P3 sees "You win!"
    const p3Modal = utils.findModal(page3, "game-end");
    await expect(p3Modal).toBeVisible();
    await expect(p3Modal).toContainText("You win!");

    // Verify other players' end of game messages
    const p1Modal = utils.findModal(page1, "game-end");
    await expect(p1Modal).toBeVisible();
    await expect(p1Modal).toContainText("P3 wins!");

    const p2Modal = utils.findModal(page2, "game-end");
    await expect(p2Modal).toBeVisible();
    await expect(p2Modal).toContainText("P3 wins!");
  });

  test("Play: NOW mid-draw", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Find P2's SHUFFLE NOW card
    const p2ShuffleNow = utils.findHandCardsByClass(page2, CardClass.ShuffleNow);
    await expect(p2ShuffleNow).toHaveCount(1);

    // P2 starts to play SHUFFLE_NOW, but does not finish yet
    await p2ShuffleNow.scrollIntoViewIfNeeded();
    const p2SrcBox = await p2ShuffleNow.boundingBox();
    const p2DstBox = await utils.findDiscardPileDropTarget(page2).boundingBox();
    if (!p2SrcBox) throw new Error("Bounding box not found for card");
    if (!p2DstBox) throw new Error("Bounding box not found for pile");
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2, p2SrcBox.y + p2SrcBox.height / 2);
    await page2.mouse.down();
    // Move to be over discard pile, but do not drop yet, saves the nonce
    await page2.mouse.move(p2DstBox.x + p2DstBox.width / 2, p2DstBox.y + p2DstBox.height / 2, {steps: 20});

    // P1 clicks draw pile
    await utils.findDrawPile(page1).click();
    await page1.waitForTimeout(10);

    // P2 finishes their play, drops SHUFFLE_NOW, but sends old nonce
    await page2.mouse.up();

    // Verify rejection dialog on P2
    const conflictModal = utils.findModal(page2, "operation-conflict");
    await expect(conflictModal).toBeVisible();
  });

  test("Play: NOW mid-draw EXPLODING CLUSTER", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Safe draws
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page1);
    await utils.drawCard(page2);

    // Find P2's SHUFFLE NOW card
    const p2ShuffleNow = utils.findHandCardsByClass(page2, CardClass.ShuffleNow);
    await expect(p2ShuffleNow).toHaveCount(1);

    // P2 starts to play SHUFFLE_NOW, but does not finish yet
    await p2ShuffleNow.scrollIntoViewIfNeeded();
    const p2SrcBox = await p2ShuffleNow.boundingBox();
    const p2DstBox = await utils.findDiscardPileDropTarget(page2).boundingBox();
    if (!p2SrcBox) throw new Error("Bounding box not found for card");
    if (!p2DstBox) throw new Error("Bounding box not found for pile");
    await page2.mouse.move(p2SrcBox.x + p2SrcBox.width / 2, p2SrcBox.y + p2SrcBox.height / 2);
    await page2.mouse.down();
    // Move to be over discard pile, but do not drop yet, saves the nonce
    await page2.mouse.move(p2DstBox.x + p2DstBox.width / 2, p2DstBox.y + p2DstBox.height / 2, {steps: 20});

    // P1 clicks draw pile
    await utils.findDrawPile(page1).click();
    await page1.waitForTimeout(10);

    // P2 finishes their play, drops SHUFFLE_NOW, but sends old nonce
    await page2.mouse.up();

    // Dismiss the overlay
    const p1Overlay = utils.findOverlay(page1, "inspect-card");
    await expect(p1Overlay).toBeVisible();
    await p1Overlay.click(); // Dismiss
    await expect(p1Overlay).toBeHidden();

    // P1 plays DEBUG
    const p1Debug = utils.findHandCardsByClass(page1, CardClass.Debug).first();
    await utils.playCard(page1, p1Debug);

    // Verify rejection dialog on P2
    const conflictModal = utils.findModal(page2, "operation-conflict");
    await expect(conflictModal).toBeVisible();

    // P2 retries (Click OK)
    await conflictModal.getByRole("button", { name: "OK" }).click();

    // Reinsert
    const p1InsertModal = utils.findModal(page1, "exploding-reinsert");
    await expect(p1InsertModal).toBeVisible();
    await p1InsertModal.locator("input[type='number']").fill("20");
    await p1InsertModal.getByRole("button", { name: "OK", exact: true }).click();

    // Shuffle was cancelled, still in hand
    await expect(utils.findLogArea(page1)).not.toContainText("The deck was shuffled");
    await expect(utils.findHandCardsByClass(page2, CardClass.ShuffleNow)).toHaveCount(1);
  });

  test("FAVOR: victim disconnects during reaction", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has FAVOR (DEVMODE fixed hand)
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // P1 chooses P2 as victim
    const favorModal = utils.findModal(page1, "favor-choose-victim");
    await expect(favorModal).toBeVisible();
    await favorModal.locator("button", { hasText: "P2" }).click();
    await favorModal.locator("button.btn-primary", { hasText: "Ask Favor" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // P2 navigates away (disconnects) before seeing choice modal
    await page2.goto("about:blank");

    // Verify P1 gets a card
    await expect(utils.findLogArea(page1)).toContainText("P2's estate gave P1 a card");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("FAVOR: victim disconnects during card choice", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has FAVOR (DEVMODE fixed hand)
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // P1 chooses P2 as victim
    const favorModal = utils.findModal(page1, "favor-choose-victim");
    await expect(favorModal).toBeVisible();
    await favorModal.locator("button", { hasText: "P2" }).click();
    await favorModal.locator("button.btn-primary", { hasText: "Ask Favor" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // Verify P2 sees choice modal
    const p2ChoiceModal = utils.findModal(page2, "favor-choose-card");
    await expect(p2ChoiceModal).toBeVisible();

    // P2 navigates away (disconnects)
    await page2.goto("about:blank");

    // Verify P1 IMMEDIATELY gets a card, without waiting for timeout
    await expect(utils.findLogArea(page1)).toContainText("P2 gave P1 a card", { timeout: 3000 }); // Fast timeout to prove speed

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("FAVOR: victim leaves during reaction", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has FAVOR (DEVMODE fixed hand)
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // P1 chooses P2 as victim
    const favorModal = utils.findModal(page1, "favor-choose-victim");
    await expect(favorModal).toBeVisible();
    await favorModal.locator("button", { hasText: "P2" }).click();
    await favorModal.locator("button.btn-primary", { hasText: "Ask Favor" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // P2 leaves the game
    await utils.leaveGame(page2);

    // Verify P1 gets a card
    await expect(utils.findLogArea(page1)).toContainText("P2's estate gave P1 a card");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("FAVOR: victim leaves during card choice", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has FAVOR (DEVMODE fixed hand)
    const favorCard = utils.findHandCardsByClass(page1, CardClass.Favor).first();

    // P1 plays FAVOR
    await utils.playCard(page1, favorCard);

    // P1 chooses P2 as victim
    const favorModal = utils.findModal(page1, "favor-choose-victim");
    await expect(favorModal).toBeVisible();
    await favorModal.locator("button", { hasText: "P2" }).click();
    await favorModal.locator("button.btn-primary", { hasText: "Ask Favor" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // Verify P2 sees choice modal
    const p2ChoiceModal = utils.findModal(page2, "favor-choose-card");
    await expect(p2ChoiceModal).toBeVisible();

    // P2 leaves the game
    await utils.leaveGame(page2);

    // Verify P1 IMMEDIATELY gets a card, without waiting for timeout
    await expect(utils.findLogArea(page1)).toContainText("P2 gave P1 a card", { timeout: 1500 }); // Fast timeout to prove speed

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("DEVELOPER 2x combo: victim disconnects during reaction", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has DEVELOPER (DEVMODE fixed hand)
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [devCard1, devCard2] = await utils.findPair(devCards);

    // P1 plays DEVELOPER combo targeting P3
    await devCard2.scrollIntoViewIfNeeded();
    await devCard2.click();
    await devCard1.scrollIntoViewIfNeeded();
    await page1.keyboard.down("Shift");
    await devCard1.click();
    await page1.keyboard.up("Shift");
    await utils.playCard(page1, devCard1);

    // P1 chooses P3 as victim
    const stealModal = utils.findModal(page1, "steal-choose-victim");
    await expect(stealModal).toBeVisible();
    await stealModal.locator("button", { hasText: "P3" }).click();
    await stealModal.locator("button.btn-primary", { hasText: "Steal Card" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // P3 navigates away (disconnects)
    await page3.goto("about:blank");

    // Now P1 should see "Choose a Card to Steal" modal
    const p1ChoiceModal = utils.findModal(page1, "steal-choose-card");
    await expect(p1ChoiceModal).toBeVisible();

    // Verify card backs (P3 has 8 cards)
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // Verify P3 is gone from player list, but still P1's turn
    await expect(page1.locator(".list-group-item:has-text('P3')")).not.toBeVisible();
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // P1 chooses a card (click index 0)
    await p1ChoiceModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(p1ChoiceModal).toBeHidden();

    // Verify P1 gets the card
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P3");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("DEVELOPER 2x combo: victim disconnects during card choice", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has DEVELOPER (DEVMODE fixed hand)
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [devCard1, devCard2] = await utils.findPair(devCards);

    // P1 plays DEVELOPER combo targeting P3
    await devCard2.scrollIntoViewIfNeeded();
    await devCard2.click();
    await devCard1.scrollIntoViewIfNeeded();
    await page1.keyboard.down("Shift");
    await devCard1.click();
    await page1.keyboard.up("Shift");
    await utils.playCard(page1, devCard1);

    // P1 chooses P3 as victim
    const stealModal = utils.findModal(page1, "steal-choose-victim");
    await expect(stealModal).toBeVisible();
    await stealModal.locator("button", { hasText: "P3" }).click();
    await stealModal.locator("button.btn-primary", { hasText: "Steal Card" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // Now P1 should see "Choose a Card to Steal" modal
    const p1ChoiceModal = utils.findModal(page1, "steal-choose-card");
    await expect(p1ChoiceModal).toBeVisible();

    // Verify card backs (P3 has 8 cards)
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // P3 navigates away (disconnects)
    await page3.goto("about:blank");

    // Verify P3 is gone from player list, but still P1's turn
    await expect(page1.locator(".list-group-item:has-text('P3')")).not.toBeVisible();
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // P1 should STILL see the choice modal and be able to choose
    await expect(p1ChoiceModal).toBeVisible();
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // P1 chooses a card (click index 0)
    await p1ChoiceModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(p1ChoiceModal).toBeHidden();

    // Verify P1 gets the card
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P3");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("DEVELOPER 2x combo: victim leaves during reaction", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has DEVELOPER (DEVMODE fixed hand)
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [devCard1, devCard2] = await utils.findPair(devCards);

    // P1 plays DEVELOPER combo targeting P3
    await devCard2.scrollIntoViewIfNeeded();
    await devCard2.click();
    await devCard1.scrollIntoViewIfNeeded();
    await page1.keyboard.down("Shift");
    await devCard1.click();
    await page1.keyboard.up("Shift");
    await utils.playCard(page1, devCard1);

    // P1 chooses P3 as victim
    const stealModal = utils.findModal(page1, "steal-choose-victim");
    await expect(stealModal).toBeVisible();
    await stealModal.locator("button", { hasText: "P3" }).click();
    await stealModal.locator("button.btn-primary", { hasText: "Steal Card" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // P3 leaves the game
    await utils.leaveGame(page3);

    // Now P1 should see "Choose a Card to Steal" modal
    const p1ChoiceModal = utils.findModal(page1, "steal-choose-card");
    await expect(p1ChoiceModal).toBeVisible();

    // Verify card backs (P3 has 8 cards)
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // Verify P3 is gone from player list, but still P1's turn
    await expect(page1.locator(".list-group-item:has-text('P3')")).not.toBeVisible();
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // P1 chooses a card (click index 0)
    await p1ChoiceModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(p1ChoiceModal).toBeHidden();

    // Verify P1 gets the card
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P3");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("DEVELOPER 2x combo: victim leaves during card choice", async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page3, "/game");

    // Timer
    const p1TimerArea = utils.findTimerArea(page1);
    await expect(p1TimerArea).toBeHidden();

    // Verify P1 has DEVELOPER (DEVMODE fixed hand)
    const devCards = utils.findHandCardsByClass(page1, CardClass.Developer);
    await expect(devCards).toHaveCount(3);
    const [devCard1, devCard2] = await utils.findPair(devCards);

    // P1 plays DEVELOPER combo targeting P3
    await devCard2.scrollIntoViewIfNeeded();
    await devCard2.click();
    await devCard1.scrollIntoViewIfNeeded();
    await page1.keyboard.down("Shift");
    await devCard1.click();
    await page1.keyboard.up("Shift");
    await utils.playCard(page1, devCard1);

    // P1 chooses P3 as victim
    const stealModal = utils.findModal(page1, "steal-choose-victim");
    await expect(stealModal).toBeVisible();
    await stealModal.locator("button", { hasText: "P3" }).click();
    await stealModal.locator("button.btn-primary", { hasText: "Steal Card" }).click();

    // Verify reaction phase
    await expect(p1TimerArea).toBeVisible();
    await expect(p1TimerArea).toHaveAttribute("data-turnphase", TurnPhase.Reaction);
    await expect(p1TimerArea).toContainText("Waiting for other players to react");

    // Now P1 should see "Choose a Card to Steal" modal
    const p1ChoiceModal = utils.findModal(page1, "steal-choose-card");
    await expect(p1ChoiceModal).toBeVisible();

    // Verify card backs (P3 has 8 cards)
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // P3 leaves the game
    await utils.leaveGame(page3);

    // Verify P3 is gone from player list, but still P1's turn
    await expect(page1.locator(".list-group-item:has-text('P3')")).not.toBeVisible();
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");

    // P1 should STILL see the choice modal and be able to choose
    await expect(p1ChoiceModal).toBeVisible();
    await expect(p1ChoiceModal.locator("img")).toHaveCount(8);

    // P1 chooses a card (click index 0)
    await p1ChoiceModal.locator(".modal-body div[style*='cursor: pointer']").first().click();
    await expect(p1ChoiceModal).toBeHidden();

    // Verify P1 gets the card
    await expect(utils.findLogArea(page1)).toContainText("P1 stole a card from P3");

    // Verify turn is still P1 (Action phase resumes after Favor)
    await expect(utils.findTurnArea(page1)).toContainText("It's your turn");
  });

  test("Disconnect during EXPLODING CLUSTER", async ({ browser }) => {
    // Setup game with 2 players
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page2, "/game");

    // Draw safe cards
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // P1 draws EXPLODING CLUSTER
    await utils.drawCard(page1);

    // Verify
    await expect(utils.findLogArea(page1)).toContainText("P1 drew an EXPLODING CLUSTER!");
    await expect(utils.findDiscardPile(page1).locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

    // P1 navigates away (disconnects)
    await page1.goto("about:blank");

    // P1 should be marked disconnected/gone
    await expect(page2.locator(".list-group-item:has-text('P1')")).not.toBeVisible();

    // Message about reinsertion
    await expect(utils.findLogArea(page2)).toContainText("The EXPLODING CLUSTER card was hidden");

    // Turn should advance to P2 (since P1 is gone)
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
  });

  test("Leave during EXPLODING CLUSTER", async ({ browser }) => {
    // Setup game with 2 players
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page2, "/game");

    // Draw safe cards
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // P1 draws EXPLODING CLUSTER
    await utils.drawCard(page1);

    // Verify
    await expect(utils.findLogArea(page1)).toContainText("P1 drew an EXPLODING CLUSTER!");
    await expect(utils.findDiscardPile(page1).locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

    // P1 leaves the game
    await utils.leaveGame(page1);

    // P1 should be marked disconnected/gone
    await expect(page2.locator(".list-group-item:has-text('P1')")).not.toBeVisible();

    // Message about reinsertion
    await expect(utils.findLogArea(page2)).toContainText("The EXPLODING CLUSTER card was hidden");

    // Turn should advance to P2 (since P1 is gone)
    await expect(utils.findTurnArea(page2)).toContainText("It's your turn");
  });

  test("Disconnect during UPGRADE CLUSTER", async ({ browser }) => {
    test.setTimeout(60000);

    // Define a helper to use below
    const almostExplode = async (page: Page, hide: number) => {
      // Draw a card
      await utils.drawCard(page);
      const overlay = utils.findOverlay(page, "inspect-card");
      await expect(overlay).toBeHidden();

      // Discard pile should show EXPLODING CLUSTER
      const pile = utils.findDiscardPile(page);
      await expect(pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.ExplodingCluster);

      // Verify we can play DEBUG
      const debug = utils.findHandCardsByClass(page, CardClass.Debug);
      await expect(debug.first()).toBeVisible();
      await expect(debug.first()).toHaveAttribute("data-playable", "true");

      // Play DEBUG card
      await utils.playCard(page, debug);

      // Verify it was played and messages sent
      await expect(pile.locator("img")).toHaveAttribute("data-cardclass", CardClass.Debug);

      // Verify the insertion dialog
      const insertModal = utils.findModal(page, "exploding-reinsert");
      await expect(insertModal).toBeVisible();
      const input = insertModal.locator("input[type='number']");
      await expect(input).toBeVisible();

      // Re-insert it
      await input.fill(hide.toString());
      await insertModal.getByRole("button", { name: "OK", exact: true }).click();
      await expect(utils.findTurnArea(page3)).toContainText("your turn is next");
    }

    // Setup game with 2 players
    const ctx1 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx2 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const ctx3 = await browser.newContext({ viewport: { width: 850, height: 1200 } });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const page3 = await ctx3.newPage();

    const code = await utils.createGame(page1, "P1");
    await utils.joinGame(page2, "P2", code);
    await utils.joinGame(page3, "P3", code);

    // Start game
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");
    await utils.waitForURL(page2, "/game");

    // Draw safe cards
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    // More safe draws
    await utils.drawCard(page2);
    await utils.drawCard(page3);
    await utils.drawCard(page1);
    await utils.drawCard(page2);
    await utils.drawCard(page3);

    // Give P1 another DEBUG card to test multiple DEBUGs
    const debugBtn = page1.locator(Buttons.DEV_GIVE_DEBUG_CARD);
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toBeEnabled();
    await debugBtn.click();
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);

    // P1 draws, explodes, and debugs, puts card back near the bottom
    await expect(utils.findHandCardsByClass(page1, CardClass.Debug)).toHaveCount(1);
    await almostExplode(page1, 20);

    // P2 gets UPGRADE CLUSTER face-down
    await utils.drawCard(page2);

    // Verify
    await expect(utils.findLogArea(page1)).toContainText("P2 drew an UPGRADE CLUSTER!");
    await expect(utils.findDiscardPile(page1).locator("img")).toHaveAttribute("data-cardclass", CardClass.UpgradeCluster);

    // Verify the insertion dialog
    const p2InsertModal = utils.findModal(page2, "upgrade-reinsert");
    await expect(p2InsertModal).toBeVisible();
    const p2Input = p2InsertModal.locator("input[type='number']");
    await expect(p2Input).toBeVisible();

    // P2 navigates away (disconnects)
    await page2.goto("about:blank");

    // P2 should be marked disconnected/gone
    await expect(page1.locator(".list-group-item:has-text('P2')")).not.toBeVisible();

    // Message about reinsertion
    await expect(utils.findLogArea(page1)).toContainText("The UPGRADE CLUSTER card was hidden");

    // Turn should advance to P3 (since P2 is gone)
    await expect(utils.findTurnArea(page3)).toContainText("It's your turn");
  });

  test("Message log: cleared between games", async ({ browser }) => {
    // P1 Creates Game 1
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const code1 = await utils.createGame(page1, "P1");

    // P2 Joins Game 1
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await utils.joinGame(page2, "P2", code1);

    // Start Game 1
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // P1 plays a card to generate a log
    utils.drawCard(page1);
    // Wait for log
    await expect(utils.findLogArea(page1)).toContainText("P1 drew a card");
    await expect(utils.findLogArea(page2)).toContainText("P1 drew a card");

    // P1 Leaves Game
    await utils.leaveGame(page1);

    // P2 sees win
    await page2.click(Buttons.MODAL_OK);
    await utils.waitForURL(page2, "/");

    // P1 Creates Game 2
    const code2 = await utils.createGame(page1, "P1");
    expect(code2).not.toEqual(code1);

    // P2 Joins Game 2
    await utils.joinGame(page2, "P2", code2);

    // Start Game 2 to see the logs
    await page1.click(Buttons.START_GAME);
    await utils.waitForURL(page1, "/game");
    await utils.waitForURL(page2, "/game");

    // Verify logs are clean.
    // Game 1 had "P1 drew a card".
    // Game 2 should be empty initially.
    await expect(utils.findLogArea(page1)).toHaveText("It's P1's turn first!");
    await expect(utils.findLogArea(page2)).toHaveText("It's P1's turn first!");
  });

});
