export enum CardClass {
  ExplodingCluster = 'EXPLODING_CLUSTER',
  UpgradeCluster = 'UPGRADE_CLUSTER',
  Attack = 'ATTACK',
  Debug = 'DEBUG',
  Favor = 'FAVOR',
  Nak = 'NAK',
  SeeTheFuture = 'SEE_THE_FUTURE',
  Shuffle = 'SHUFFLE',
  ShuffleNow = 'SHUFFLE_NOW',
  Skip = 'SKIP',
  Developer = 'DEVELOPER'
}

export interface Card {
  id: string;
  name: string;
  cardClass: CardClass;
  imageUrl: string;
  now?: boolean;
  combo?: boolean;
}

export enum GameState {
  Lobby = 'LOBBY',
  Started = 'STARTED',
  Ended = 'ENDED',
}

export enum SocketEvent {
  // client -> server
  CreateGame = 'createGame',
  JoinGame = 'joinGame',
  WatchGame = 'watchGame',
  StartGame = 'startGame',
  GiveDebugCard = 'giveDebugCard',
  GiveSafeCard = 'giveSafeCard',
  ShowDeck = 'showDeck',
  ShowRemovedPile = 'showRemovedPile',
  ReorderHand = 'reorderHand',
  PlayCard = 'playCard',
  PlayCombo = 'playCombo',
  DrawCard = 'drawCard',
  LeaveGame = 'leaveGame',

  // server -> client
  GameUpdate = 'gameUpdate',
  GameMessage = 'gameMessage',
  HandUpdate = 'handUpdate',
  PlayerJoined = 'playerJoined',
  PlayerDisconnected = 'playerDisconnected',
  GameStarted = 'gameStarted',
  GameEnded = 'gameEnded',
  DeckData = 'deckData',
  RemovedData = 'removedData',
  PlayerExploding = 'playerExploding',
  DrawCardAnimation = 'drawCardAnimation'
}

export interface PlayerInfo {
  id: string;
  name: string;
  cards: number; // number of cards in hand
  isOut?: boolean;
  isDisconnected?: boolean;
}

export interface SpectatorInfo {
  id: string;
  name?: string; // Optional name if we add it later
}

export interface GameUpdatePayload {
  gameCode: string;
  nonce: string;
  players: PlayerInfo[];
  state: GameState;
  gameOwnerId: string;
  spectators: SpectatorInfo[]; 
  devMode: boolean;
  turnOrder: string[];
  currentTurnIndex: number;
  drawPileCount?: number;    // optional, devMode only
  discardPile?: Card[];      // optional, devMode only
  topDiscardCard?: Card;     // optional (may be no discarded cards)
  removedPileCount?: number; // optional, devMode only
  debugCardsCount?: number;  // optional, devMode only
  safeCardsCount?: number;   // optional, devMode only
}
