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
  isFaceUp?: boolean;
}

export enum GameState {
  Lobby = 'LOBBY',
  Started = 'STARTED',
  Ended = 'ENDED',
}

export enum TurnPhase {
  Action = 'ACTION',
  Reaction = 'REACTION',
  Executing = 'EXECUTING',
  Exploding = 'EXPLODING',
  ExplodingReinserting = 'EXPLODING_REINSERTING',
  Upgrading = 'UPGRADING',
  SeeingTheFuture = 'SEEING_THE_FUTURE',
  ChoosingFavorCard = 'CHOOSING_FAVOR_CARD',
  ChoosingDeveloperCard = 'CHOOSING_DEVELOPER_CARD',
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
  ReinsertExplodingCard = 'reinsertExplodingCard',
  ReinsertUpgradeCard = 'reinsertUpgradeCard',
  LeaveGame = 'leaveGame',
  DismissSeeTheFuture = 'dismissSeeTheFuture',
  GiveFavorCard = 'giveFavorCard',
  StealCard = 'stealCard',

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
  CardDrawn = 'cardDrawn',
  SeeTheFutureData = 'seeTheFutureData',
  ChooseFavorCard = 'chooseFavorCard',
  FavorResult = 'favorResult',
  ChooseStealCard = 'chooseStealCard',
  StealResult = 'stealResult',
  ReactionTimerUpdate = 'reactionTimerUpdate',
  PlayError = 'playError',
}

export interface Player {
  id: string;
  name: string;
  cards: number; // number of cards in hand
  isOut?: boolean;
  isDisconnected?: boolean;
}

export enum WinType {
  Attrition = 'Attrition',
  Explosion = 'Explosion',
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
  attackTurns: number;
  attackTurnsTaken: number;
  lastActorName?: string;
  overlayCard?: Card;        // If an overlay needs to be shown
  timerDuration?: number;    // Seconds remaining on the timer
  topDiscardCard?: Card;     // optional (may be no discarded cards)
  drawPileImage?: string;    // Image to show for the draw pile
  topDrawPileCard?: Card;    // If the top card is face-up, this is the card, else nothing
  drawCount?: number;        // Incremented on every draw
  drawPileCount?: number;    // optional, devMode only
  discardPileCount?: number; // optional, devMode only
  removedPileCount?: number; // optional, devMode only
  debugCardsCount?: number;  // optional, devMode only
  safeCardsCount?: number;   // optional, devMode only
}
