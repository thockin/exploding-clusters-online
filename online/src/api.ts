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
  class: CardClass;
  imageUrl: string;
  now?: boolean;
  combo?: boolean;
}

export enum GameState {
  Lobby = 'LOBBY',
  Started = 'STARTED',
  Ended = 'ENDED',
}

export enum TurnPhase {
  Action = 'ACTION',
  Reaction = 'REACTION',
  Rereaction = 'REREACTION',
  Executing = 'EXECUTING',
  Exploding = 'EXPLODING' // For Phase 3.3
}

export enum SocketEvent {
  // client -> server
  CreateGame = 'createGame',
  JoinGame = 'joinGame',
  WatchGame = 'watchGame',
  StartGame = 'startGame',
  GiveDebugCard = 'giveDebugCard',
  GiveSafeCard = 'giveSafeCard',
  PutCardBack = 'putCardBack',
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
  DrawCardAnimation = 'drawCardAnimation',
  TimerUpdate = 'timerUpdate',
  PlayError = 'playError'
}

export interface Player {
  id: string;
  name: string;
  cards: number; // number of cards in hand
  isOut?: boolean;
  isDisconnected?: boolean;
}

export interface Spectator {
  id: string;
  name?: string; // Optional name if we add it later
}

export interface GameUpdatePayload {
  gameCode: string;
  nonce: string;
  players: Player[];
  state: GameState;
  gameOwnerId: string;
  spectators: Spectator[]; 
  devMode: boolean;
  turnOrder: string[];
  currentTurnIndex: number;
  turnPhase: TurnPhase;
  lastActorName?: string;
  timerDuration?: number;    // Seconds remaining (or total duration for animation)
  topDiscardCard?: Card;     // optional (may be no discarded cards)
  drawPileCount?: number;    // optional, devMode only
  discardPileCount?: number; // optional, devMode only
  removedPileCount?: number; // optional, devMode only
  debugCardsCount?: number;  // optional, devMode only
  safeCardsCount?: number;   // optional, devMode only
}
