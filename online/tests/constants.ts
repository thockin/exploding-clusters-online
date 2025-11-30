export const Buttons = {
  CREATE_NEW_GAME: 'button:has-text("Create a new game")',
  CREATE_GAME_CONFIRM: 'button:has-text("Create Game")',
  JOIN_GAME: 'button:has-text("Join a game")',
  JOIN_GAME_CONFIRM: 'button:has-text("Join Game")',
  WATCH_GAME: 'button:has-text("Watch a game")',
  WATCH_GAME_CONFIRM: 'button:has-text("Watch Game")',
  START_GAME: 'button:has-text("Start Game")',
  LEAVE_GAME: 'button:has-text("Leave Game")',
  OK: 'button:has-text("OK")',
  
  // DevMode
  DEV_GIVE_SAFE_CARD: 'button:has-text("Give me a safe card")',
  DEV_GIVE_DEBUG_CARD: 'button:has-text("Give me a DEBUG card")',
  DEV_PUT_CARD_BACK: 'button:has-text("Put a card back")',
  DEV_SHOW_DECK: 'button:has-text("Show the deck")',
  DEV_SHOW_REMOVED: 'button:has-text("Show removed cards")',
};

export const Inputs = {
  NAME: 'input[placeholder*="Enter your name"]',
  GAME_CODE: 'input[placeholder="Enter 5-letter game code"]',
};

export const Headers = {
  LOBBY_GAME_CODE: 'h2:has-text("Lobby - Game Code:")',
  YOUR_HAND: 'h5:has-text("Your Hand")',
};

export const Locators = {
  LOBBY_TEXT: 'text=Lobby - Game Code',
  DISCARD_PILE_TEXT: 'text=Discard Pile',
  DRAW_PILE_TEXT: 'text=Draw Pile',
  REMOVED_PILE_TEXT: 'text=Removed Pile',
  GAME_PILE: '.game-pile',
  HAND_ANIMATION_CARD: '.hand-animation .hand-card img',
  MODAL_SHOW: '.modal.show',
  TURN_MY_TURN: 'strong:has-text("It\'s your turn")',
  LOBBY_PLAYER_LIST: '[data-testid="lobby-player-list"]',
  PLAYER_LIST: '[data-testid="player-list"]',
};
