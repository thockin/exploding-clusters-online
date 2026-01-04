// Copyright 2025 Tim Hockin

import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { generateDeck, shuffleDeck } from './app/game/deck';
import { PseudoRandom, RandomSource, SecureRandom } from './utils/PseudoRandom';
import { Card, CardClass, GameState, GameUpdatePayload, SocketEvent, TurnPhase, WinType } from './api';
import { validatePlayerName, sanitizePlayerName, normalizeNameForComparison, escapeHtml } from './utils/nameValidation';
import { config } from './config';

// Define an action callback
type ActionCallback = (game: Game) => void | Promise<void>;

// Define Operation interface for the operations stack
interface Operation {
  cardClass: CardClass;
  playerName: string;
  action: ActionCallback;
}

// Define interfaces for game and player states
interface Player {
  id: string;
  name: string;
  socketId: string;
  hand: Card[];
  isOut: boolean;
  isDisconnected: boolean;
  isPlaying: boolean; // Flag to prevent concurrent card plays from the same player
}

interface Game {
  code: string;
  players: Player[];
  spectators: { id: string; socketId: string }[];
  state: GameState;
  currentPlayer: number;
  turnPhase: TurnPhase;
  prevTurnPhase?: TurnPhase;
  attackTurns: number; // Number of turns the current player must take (0 means normal 1 turn)
  attackTurnsTaken: number; // Number of turns already taken in this attack sequence
  timerDuration?: number; // active timer duration
  drawPile: Card[];
  drawCount: number; // Incremented on every draw
  discardPile: Card[];
  removedPile: Card[]; // New: cards removed from the game
  pendingOperations: Operation[];
  gameOwnerId: string;
  nonce: string; // For reconnection logic
  lastActorName?: string; // Name of the player who caused the last nonce update
  timer: NodeJS.Timeout | null;
  seeTheFutureResolver?: () => void;
  favorResolver?: (cardId: string) => void;
  favorVictimId?: string;
  developerResolver?: (index: number) => void;
  devMode: boolean;
}

// Used by FAVOR card and DEVELOPER combo plays. Most tests should very quickly
// make a choice, but some will wait for auto-timeout, so we need both fast and
// normal values.
const CHOOSE_CARD_TIMEOUT_MS = 15000;
const FAST_CHOOSE_CARD_TIMEOUT_MS = 3000;

// How long a player is able to SEE THE FUTURE. Most tests should very quickly
// dismiss the view, but some will wait for auto-timeout, so we need both fast
// and normal values.
const DELAY_TIMEOUT_MS = 10000;
const FAST_DELAY_TIMEOUT_MS = 3000;

// How long each card operation may take (must be greater than the above
// timeouts).
const OPERATION_TIMEOUT_MS = 20000;

// GameManager handles game state and socket events
export class GameManager {
  private games: Map<string, Game> = new Map();
  private playerToGameMap: Map<string, string> = new Map(); // socketId -> gameCode
  private verbose: boolean = config.verbose;
  private prng: RandomSource;
  private maxGames: number;
  private maxSpectators: number;
  private reactionTimerDuration: number;

  constructor(private io: Server) {
    const devMode = config.devMode;
    this.prng = devMode ? new PseudoRandom(0) : new SecureRandom();

    this.maxGames = config.maxGames;
    this.maxSpectators = config.maxSpectators;
    this.reactionTimerDuration = config.reactionTimer;

    // Setup Socket.IO event listeners
    this.io.on('connection', (socket: Socket) => {
      this.log(null, `socket connected: ${socket.id}`);

      if (this.verbose) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.onAny((eventName: string, ...args: any[]) => {
          this.log(null, `received event "${eventName}" from ${socket.id}: ${JSON.stringify(args)}`);
        });
      }

      socket.on(SocketEvent.CreateGame, (playerName: string, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => void) => {
        this.createGame(socket, playerName, callback);
      });

      socket.on(SocketEvent.JoinGame, (gameCode: string, playerName: string, nonce: string | undefined, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string; }) => void) => {
        this.joinGame(socket, gameCode, playerName, nonce, callback);
      });

      socket.on(SocketEvent.WatchGame, (gameCode: string, callback: (response: { success: boolean; gameCode?: string; error?: string }) => void) => {
        this.watchGame(socket, gameCode, callback);
      });

      socket.on(SocketEvent.StartGame, (gameCode: string, callback: (response: { success: boolean; error?: string }) => void) => {
        this.startGame(socket, gameCode, callback);
      });

      socket.on(SocketEvent.GiveDebugCard, (gameCode: string) => {
        if (!devMode) return;
        this.giveDebugCard(socket, gameCode);
      });

      socket.on(SocketEvent.GiveSafeCard, (gameCode: string) => {
        if (!devMode) return;
        this.giveSafeCard(socket, gameCode);
      });

      socket.on(SocketEvent.PutCardBack, (gameCode: string) => {
        if (!devMode) return;
        this.putCardBack(socket, gameCode);
      });

      socket.on(SocketEvent.ShowDeck, (gameCode: string) => {
        if (!devMode) return;
        this.showDeck(socket, gameCode);
      });

      socket.on(SocketEvent.ShowRemovedPile, (gameCode: string) => {
        if (!devMode) return;
        this.showRemovedPile(socket, gameCode);
      });

      socket.on(SocketEvent.ReorderHand, ({ gameCode, newHand }: { gameCode: string; newHand: Card[] }) => {
        this.reorderHand(socket, gameCode, newHand);
      });

      socket.on(SocketEvent.PlayCard, (data: { gameCode: string; cardId: string; nonce?: string; victimId?: string }) => {
        this.playCard(socket, data.gameCode, data.cardId, data.nonce, data.victimId);
      });

      socket.on(SocketEvent.PlayCombo, (data: { gameCode: string; cardIds: string[]; nonce?: string; victimId?: string }) => {
        this.playCombo(socket, data.gameCode, data.cardIds, data.nonce, data.victimId);
      });

      socket.on(SocketEvent.DrawCard, (gameCode: string) => {
        this.drawCard(socket, gameCode);
      });

      socket.on(SocketEvent.ReinsertExplodingCard, (data: { gameCode: string, index: number, nonce: string }) => {
        this.reinsertExplodingCard(socket, data.gameCode, data.index, data.nonce);
      });

      socket.on(SocketEvent.ReinsertUpgradeCard, (data: { gameCode: string, index: number, nonce: string }) => {
        this.reinsertUpgradeCard(socket, data.gameCode, data.index, data.nonce);
      });

      socket.on(SocketEvent.DismissSeeTheFuture, (gameCode: string) => {
        this.dismissSeeTheFuture(socket, gameCode);
      });

      socket.on(SocketEvent.GiveFavorCard, (data: { gameCode: string; cardId: string }) => {
        this.giveFavorCard(socket, data.gameCode, data.cardId);
      });

      socket.on(SocketEvent.StealCard, (data: { gameCode: string; index: number }) => {
        this.stealCard(socket, data.gameCode, data.index);
      });

      socket.on(SocketEvent.LeaveGame, (gameCode: string) => {
        this.leaveGame(socket, gameCode);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private firstGameCreated = false;

  private generateGameCode(): string {
    // In DEVMODE, the first game code is always XXXXX
    if (config.devMode && !this.firstGameCreated) {
      this.firstGameCreated = true;
      return 'XXXXX';
    }

    const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ'; // No vowels, uppercase
    let code = '';
    let unique = false;
    while (!unique) {
      code = Array.from({ length: 5 }, () => alphabet[Math.floor(this.prng.random() * alphabet.length)]).join('');
      if (!this.games.has(code)) {
        unique = true;
      }
    }
    return code;
  }

  private generateNonce(): string {
    return randomBytes(8).toString('hex');
  }

  private emitToGame(gameCode: string, event: string, data?: unknown) {
    if (this.verbose) {
      this.log(null, `game ${gameCode}: sending event "${event}" to all players: ${JSON.stringify(data as string)}`);
    }
    this.io.to(gameCode).emit(event, data);
  }

  private emitToSocket(socketId: string, event: string, data?: unknown) {
    if (this.verbose) {
      this.log(null, `sending event "${event}" to socket ${socketId}: ${JSON.stringify(data as string)}`);
    }
    this.io.to(socketId).emit(event, data);
  }

  private msgToAllPlayers(gameCode: string, msg: string) {
    this.emitToGame(gameCode, SocketEvent.GameMessage, { message: msg });
  }

  private msgToPlayer(socketId: string, msg: string) {
    this.emitToSocket(socketId, SocketEvent.GameMessage, { message: msg });
  }

  private setTurnPhase(game: Game, phase: TurnPhase) {
    if (game.turnPhase === phase) {
      // We should weed out redundant calls to this function
      return
    }
    game.prevTurnPhase = game.turnPhase;
    game.turnPhase = phase;
  }

  private getGameUpdateData(game: Game): GameUpdatePayload {
    const topDiscardCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : undefined;

    // Handle face-up cards in draw pile
    const topDrawCard = game.drawPile.length > 0 ? game.drawPile[game.drawPile.length - 1] : undefined;
    let drawPileImage = "/art/back.png";
    let topDrawPileCard: Card | undefined = undefined; // IFF face-up

    if (topDrawCard && topDrawCard.isFaceUp) {
      drawPileImage = topDrawCard.imageUrl;
      topDrawPileCard = topDrawCard;
    }

    let playBlockingCard: Card | undefined;
    if (game.turnPhase === TurnPhase.Exploding || game.turnPhase === TurnPhase.ExplodingReinserting) {
      // Find the most recent EXPLODING_CLUSTER in discard pile (it might be under a DEBUG card)
      // Search from end (top)
      for (let i = game.discardPile.length - 1; i >= 0; i--) {
        if (game.discardPile[i].class === CardClass.ExplodingCluster) {
          playBlockingCard = game.discardPile[i];
          break;
        }
      }
    } else if (game.turnPhase === TurnPhase.Upgrading) {
      // Find the most recent UPGRADE_CLUSTER in discard pile
      for (let i = game.discardPile.length - 1; i >= 0; i--) {
        if (game.discardPile[i].class === CardClass.UpgradeCluster) {
          playBlockingCard = game.discardPile[i];
          break;
        }
      }
    }

    const baseData: GameUpdatePayload = {
      gameCode: game.code,
      nonce: game.nonce,
      state: game.state,
      devMode: game.devMode,
      players: game.players
        .filter(p => !p.isDisconnected)
        .map(p => ({ id: p.id, name: p.name, cards: p.hand.length, isOut: p.isOut, isDisconnected: p.isDisconnected })),
      currentPlayer: this.getDensePlayerIndex(game, game.currentPlayer),
      gameOwnerId: game.gameOwnerId,
      spectators: game.spectators.map(s => ({ id: s.id })),
      turnPhase: game.turnPhase,
      attackTurns: game.attackTurns,
      attackTurnsTaken: game.attackTurnsTaken,
      lastActorName: game.lastActorName,
      playBlockingCard,
      timerDuration: game.timerDuration,
      topDiscardCard: topDiscardCard, // Always send top card for rendering
      drawPileImage: drawPileImage,
      topDrawPileCard: topDrawPileCard,
      drawCount: game.drawCount,
    };

    if (game.devMode) {
      const debugCount = game.drawPile.filter(c => c.class === CardClass.Debug).length;
      const safeCardsCount = game.drawPile.filter(c => c.class !== CardClass.ExplodingCluster && c.class !== CardClass.UpgradeCluster).length;

      return {
        ...baseData,
        drawPileCount: game.drawPile.length,
        discardPileCount: game.discardPile.length,
        removedPileCount: game.removedPile.length,
        debugCardsCount: debugCount,
        safeCardsCount: safeCardsCount
      };
    } else {
      return baseData;
    }
  }

  private emitGameUpdate(game: Game) {
    const data = this.getGameUpdateData(game);
    this.emitToGame(game.code, SocketEvent.GameUpdate, data);
  }

  private updateGameNonce(game: Game, actorName?: string) {
    if (actorName) {
      game.lastActorName = actorName;
    }
    // Mark disconnected players as permanently out
    for (const p of game.players) {
      if (p.isDisconnected && !p.isOut) {
        p.isOut = true;
        this.log(game, `marking disconnected player "${p.name}" as permanently OUT`);
      }
    }

    // Check for attrition win (count active players)
    const activePlayers = game.players.filter(p => !p.isOut && !p.isDisconnected);
    if (game.state === GameState.Started) {
      if (activePlayers.length === 0) {
        this.endGame(game.code, "Nobody", WinType.Attrition);
        return;
      }
      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        this.log(game, `game won by attrition: winner ${winner.name}`);
        this.handleWin(game, winner, WinType.Attrition);
        return;
      }
    }

    // New nonce, notify all clients
    game.nonce = this.generateNonce();
    this.emitGameUpdate(game);
    if (game.devMode) {
      this.log(game, `nonce updated to: ${game.nonce}`);
    }

    // Send individual hand updates
    for (const player of game.players) {
      if (player.socketId) {
        this.emitToSocket(player.socketId, SocketEvent.HandUpdate, { hand: player.hand });
      }
    }
  }

  private startReactionTimer(game: Game, triggeringPlayerId: string) {
    // Clear existing timer if any to prevent multiple executions
    if (game.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }

    game.timerDuration = this.reactionTimerDuration;
    this.setTurnPhase(game, TurnPhase.Reaction);

    this.emitToGame(game.code, SocketEvent.ReactionTimerUpdate, { duration: this.reactionTimerDuration, phase: game.turnPhase });
    if (this.verbose || game.devMode) {
      this.log(game, `starting ${game.turnPhase} phase (${this.reactionTimerDuration}s)`);
    }

    game.timer = setTimeout(() => {
      this.executePlayedCards(game);
    }, this.reactionTimerDuration * 1000);
  }

  private async executePlayedCards(game: Game) {
    // Prevent multiple concurrent executions
    if (game.turnPhase === TurnPhase.Executing) {
      this.log(game, `BUG: executePlayedCards: already executing, ignoring duplicate call`);
      return;
    }

    // Check if game has ended before executing
    if (game.state === GameState.Ended) {
      this.log(game, `BUG: executePlayedCards: game has ended, aborting`);
      game.timer = null;
      game.timerDuration = 0;
      return;
    }

    if (this.verbose || game.devMode) {
      this.log(game, `reaction timer expired, stack has ${game.pendingOperations.length} operations`);
    }

    // Clear timer reference
    game.timer = null;
    game.timerDuration = 0;

    // Transition to Executing phase to block further actions until operations are resolved.
    this.setTurnPhase(game, TurnPhase.Executing);
    this.updateGameNonce(game); // Notify clients of phase change

    // Pop and execute all operations with timeout protection
    let i: number = 0;
    while (game.pendingOperations.length > 0) {
      // Check game state again before each operation (refresh from map to avoid type narrowing issues)
      const currentGame = this.games.get(game.code);
      if (!currentGame || currentGame.state === GameState.Ended) {
        this.log(game, `executePlayedCards: game ended during execution, aborting remaining operations`);
        break;
      }

      const op = game.pendingOperations.pop();
      if (op) {
        this.log(game, `executing operation for ${op.cardClass} played by "${op.playerName}"`);
        try {
          if (game.devMode) {
            this.msgToAllPlayers(game.code, `DEV: op[${i}]: Executing ${op.cardClass} played by "${op.playerName}".`);
          }
          // Wrap operation in timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), OPERATION_TIMEOUT_MS);
          });
          await Promise.race([op.action(game), timeoutPromise]);
        } catch (e) {
          this.log(game, `error executing pending operation: ${e}`);
          // Continue with next operation even if one fails
        } finally {
          i++;
        }
      }
    }

    // Only reset phase if game hasn't ended (refresh from map to avoid type narrowing issues)
    const finalGame = this.games.get(game.code);
    if (finalGame && finalGame.state !== GameState.Ended) {
      // Reset Phase to Action
      this.setTurnPhase(finalGame, TurnPhase.Action);
      this.emitToGame(finalGame.code, SocketEvent.ReactionTimerUpdate, { duration: 0, phase: finalGame.turnPhase });
      this.updateGameNonce(finalGame); // Notify state change
    }
  }

  private createGame(socket: Socket, playerName: string, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => void) {
    // Check if server has reached maximum game limit
    if (this.games.size >= this.maxGames) {
      this.log(null, `createGame failed: server at capacity (${this.games.size}/${this.maxGames} games)`);
      return callback({ success: false, error: 'The server is full. Please try again later.' });
    }

    // Validate and sanitize player name
    const validation = validatePlayerName(playerName);
    if (!validation.isValid) {
      this.log(null, `createGame failed: invalid player name from ${socket.id}: ${validation.error}`);
      return callback({ success: false, error: validation.error || 'Invalid player name' });
    }

    const sanitizedName = sanitizePlayerName(validation.sanitized || playerName);
    const gameCode = this.generateGameCode();
    const playerId = uuidv4();
    const player: Player = { id: playerId, name: sanitizedName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, isPlaying: false };
    const devMode = config.devMode;

    const newGame: Game = {
      code: gameCode,
      players: [player],
      spectators: [],
      state: GameState.Lobby,
      currentPlayer: -1,
      turnPhase: TurnPhase.Action,
      attackTurns: 0,
      attackTurnsTaken: 0,
      drawPile: [],
      drawCount: 0,
      discardPile: [],
      removedPile: [],
      pendingOperations: [],
      gameOwnerId: playerId,
      nonce: this.generateNonce(),
      timer: null,
      devMode: devMode,
    };

    this.games.set(gameCode, newGame);
    this.playerToGameMap.set(socket.id, gameCode);
    socket.join(gameCode);

    this.log(newGame, `game created by player "${sanitizedName}" (${socket.id})`);
    this.updateGameNonce(newGame);
    callback({ success: true, gameCode, playerId });
  }

  private joinGame(socket: Socket, gameCode: string, playerName: string, clientNonce: string | undefined, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string; }) => void) {
    // Validate and sanitize player name
    const validation = validatePlayerName(playerName);
    if (!validation.isValid) {
      this.log(null, `joinGame failed: invalid player name from ${socket.id}: ${validation.error}`);
      return callback({ success: false, error: validation.error || 'Invalid player name' });
    }

    const sanitizedName = sanitizePlayerName(validation.sanitized || playerName);
    const game = this.games.get(gameCode);

    if (!game) {
      this.log(null, `attempted to join non-existent game: ${gameCode}`);
      return callback({ success: false, error: `Game ${gameCode} does not exist` });
    }

    if (game.devMode && clientNonce) {
      this.log(game, `player "${sanitizedName}" (${socket.id}) attempting to rejoin with nonce ${clientNonce}`);
    }
    // Reconnection logic
    if (clientNonce && clientNonce === game.nonce) {
      // Find player by NAME since socket ID changes on reconnect
      // Normalize both names for comparison (trim + lowercase)
      const normalizedNewName = normalizeNameForComparison(sanitizedName);
      const existingPlayer = game.players.find(p => normalizeNameForComparison(p.name) === normalizedNewName);
      if (existingPlayer) {
        // Ensure stored name is trimmed (in case it wasn't before)
        existingPlayer.name = sanitizePlayerName(existingPlayer.name);
        existingPlayer.socketId = socket.id;
        existingPlayer.isDisconnected = false; // Player is reconnected
        existingPlayer.isPlaying = false; // Reset playing flag on reconnect
        this.playerToGameMap.set(socket.id, gameCode);
        socket.join(gameCode);
        this.log(game, `player "${sanitizedName}" (${existingPlayer.socketId}) rejoined the game`);
        this.msgToAllPlayers(game.code, `${sanitizedName} has rejoined the game, hoorah!`);
        this.emitGameUpdate(game); // Rejoining player does not change nonce
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: existingPlayer.hand });
        return callback({ success: true, gameCode, nonce: game.nonce, playerId: existingPlayer.id });
      }
    } else if (clientNonce && clientNonce !== game.nonce) {
      this.log(game, `player "${playerName}" (${socket.id}) failed to rejoin due to nonce mismatch`);
      return callback({ success: false, error: 'Cannot rejoin, game state has changed.', nonce: game.nonce });
    }

    if (game.state !== GameState.Lobby) {
      this.log(game, `attempted to join when not in lobby state (state=${game.state})`);
      return callback({ success: false, error: 'Sorry, that game has already started' });
    }

    // Check full against CONNECTED players
    const connectedPlayers = game.players.filter(p => !p.isDisconnected);
    if (connectedPlayers.length >= 5) {
      this.log(game, `attempted to join full game`);
      return callback({ success: false, error: 'Sorry, that game is full' });
    }

    // Check name against CONNECTED players
    // Normalize both names for comparison (trim + lowercase)
    const normalizedNewName = normalizeNameForComparison(sanitizedName);
    const existingPlayerWithSameName = connectedPlayers.find(p => normalizeNameForComparison(p.name) === normalizedNewName);
    if (existingPlayerWithSameName) {
      this.log(game, `attempted to join with duplicate name: "${sanitizedName}", exists as ${existingPlayerWithSameName.socketId}`);
      return callback({ success: false, error: 'That name is already taken in this game. Please choose a different name.' });
    }

    const playerId = uuidv4(); // Generate a new ID for a new player
    const player: Player = { id: playerId, name: sanitizedName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, isPlaying: false };
    game.players.push(player);
    this.playerToGameMap.set(socket.id, gameCode);
    socket.join(gameCode);

    this.log(game, `player "${sanitizedName}" (${socket.id}) joined the game`);
    this.updateGameNonce(game);
    // Notify all players in the game about the new player
    this.emitToGame(game.code, SocketEvent.PlayerJoined, { playerId: player.id, playerName: player.name });
    callback({ success: true, gameCode, nonce: game.nonce, playerId: player.id });
  }

  private watchGame(socket: Socket, gameCode: string, callback: (response: { success: boolean; gameCode?: string; error?: string }) => void) {
    const game = this.games.get(gameCode);

    if (!game) {
      this.log(null, `attempted to watch non-existent game: ${gameCode}`);
      return callback({ success: false, error: `Game ${gameCode} does not exist` });
    }

    // Check if the game is full of spectators
    if (game.spectators.length >= this.maxSpectators) {
      this.log(game, `attempted to watch game ${gameCode} but spectator limit (${this.maxSpectators}) reached`);
      return callback({ success: false, error: 'Sorry, this game has reached its spectator limit.' });
    }

    game.spectators.push({ id: uuidv4(), socketId: socket.id });
    this.playerToGameMap.set(socket.id, gameCode); // Use playerToGameMap for spectators too for easy disconnect handling
    socket.join(gameCode);

    this.log(game, `spectator ${socket.id} joined the game`);
    this.emitGameUpdate(game); // Notify clients without changing nonce
    this.emitToSocket(socket.id, SocketEvent.GameUpdate, this.getGameUpdateData(game)); // Ensure delivery to joiner
    callback({ success: true, gameCode });
  }

  private startGame(socket: Socket, gameCode: string, callback: (response: { success: boolean; error?: string }) => void) {
    const game = this.games.get(gameCode);

    if (!game) {
      this.log(null, `attempted to start non-existent game: ${gameCode}`);
      return callback({ success: false, error: `Game ${gameCode} does not exist` });
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to start game ${gameCode}`);
      return callback({ success: false, error: 'Only players can start the game.' });
    }

    // Prevent race condition: check and set state atomically
    if (game.state !== GameState.Lobby) {
      this.log(game, `attempted to start game that is not in lobby state (state=${game.state})`);
      return callback({ success: false, error: 'Game has already been started or ended.' });
    }

    if (player.id !== game.gameOwnerId) {
      this.log(game, `non-game owner tried to start the game. player: ${player.name}`);
      return callback({ success: false, error: 'Only the game owner can start the game.' });
    }

    if (game.players.length < 2) {
      this.log(game, `game owner tried to start game with too few players`);
      return callback({ success: false, error: 'Cannot start game with less than 2 players.' });
    }

    // Set state immediately to prevent concurrent startGame calls
    game.state = GameState.Started;

    // Initialize deck
    let deck = generateDeck()
    const explodingClusters = deck.filter(c => c.class === CardClass.ExplodingCluster);
    const upgradeClusters = deck.filter(c => c.class === CardClass.UpgradeCluster);
    const debugCards = deck.filter(c => c.class === CardClass.Debug);

    // Remove them all first
    deck = deck.filter(c => c.class !== CardClass.Debug && c.class !== CardClass.ExplodingCluster && c.class !== CardClass.UpgradeCluster);

    // Give 1 DEBUG card to each player
    for (const p of game.players) {
      if (debugCards.length > 0) {
        const c = debugCards.pop()!;
        p.hand.push(c);
      }
    }

    // Put remaining DEBUG cards back (max 2 or whatever is left)
    const debugsToReturn = Math.min(debugCards.length, 2);
    for (let i = 0; i < debugsToReturn; i++) {
      deck.push(debugCards.pop()!);
    }
    // Move any remaining debugCards (excess) to the removedPile
    game.removedPile.push(...debugCards);

    deck = shuffleDeck(deck, this.prng.random.bind(this.prng));

    // Deal hands
    if (game.devMode && game.players.length >= 1) {
      this.dealDevModeHands(game, deck);
      // Deal random to remaining players (P4+)
      for (let i = 3; i < game.players.length; i++) {
        game.players[i].hand.push(...deck.splice(0, 7));
      }
    } else {
      // Deal 7 cards to each player and shuffle them
      for (const p of game.players) {
        p.hand.push(...deck.splice(0, 7));
        p.hand = shuffleDeck(p.hand, this.prng.random.bind(this.prng));
      }
    }

    // Insert Exploding Clusters (players - 1)
    const numExploding = game.players.length - 1;
    for (let i = 0; i < numExploding; i++) {
      if (explodingClusters.length > 0) deck.push(explodingClusters.pop()!);
    }
    // Move any remaining explodingClusters (excess) to the removedPile
    game.removedPile.push(...explodingClusters);

    // Insert Upgrade Clusters
    // 2 players = 0 UPGRADE CLUSTER
    // 3-4 players = 1 UPGRADE CLUSTER
    // 5 players = 2 UPGRADE CLUSTER
    const numPlayers = game.players.length;
    let upgradeCount = 0;
    if (numPlayers >= 3 && numPlayers <= 4) upgradeCount = 1;
    else if (numPlayers === 5) upgradeCount = 2;

    // DEVMODE: Always ensure at least two UPGRADE CLUSTER cards in the deck
    if (game.devMode && upgradeClusters.length > 0) { // Check if we actually have upgrade cards to add
      upgradeCount = Math.max(upgradeCount, 2);
    }

    for (let i = 0; i < upgradeCount; i++) {
      if (upgradeClusters.length > 0) deck.push(upgradeClusters.pop()!);
    }
    // Move any remaining upgradeClusters (excess) to the removedPile
    game.removedPile.push(...upgradeClusters);

    game.drawPile = shuffleDeck(deck, this.prng.random.bind(this.prng));

    // DEVMODE: Setup fixed deck order
    if (game.devMode) {
      this.setupDevModeDeck(game.drawPile);
    }

    // Shuffle players to set turn order
    if (!game.devMode) {
      for (let i = game.players.length - 1; i > 0; i--) {
        const j = Math.floor(this.prng.random() * (i + 1));
        [game.players[i], game.players[j]] = [game.players[j], game.players[i]];
      }
    }
    game.currentPlayer = 0;

    this.log(game, `game started`);
    this.updateGameNonce(game);
    this.emitToGame(game.code, SocketEvent.GameStarted);
    callback({ success: true });
  }

  // Helper to force specific cards to the top of the deck for DEVMODE.  This
  // allows predictable testing of card effects.
  public setupDevModeDeck(deck: Card[]) {
    // The desired sequence of cards to be drawn (popped), in order:
    const sequence: CardClass[] = [
      CardClass.Nak,                // 1st pop
      CardClass.Shuffle,            // 2nd pop
      CardClass.Favor,              // 3rd pop
      CardClass.SeeTheFuture,       // 4th pop
      CardClass.Attack,             // 5th pop
      CardClass.Skip,               // 6th pop
      CardClass.ExplodingCluster,   // 7th pop (1st instance)
      CardClass.Developer,          // 8th pop
      CardClass.Developer,          // 9th pop
      CardClass.Developer,          // 10th pop
      CardClass.Developer,          // 11th pop
      CardClass.Developer,          // 12th pop
      CardClass.ExplodingCluster,   // 13th pop (if a second one exists)
      CardClass.UpgradeCluster,     // 14th pop (if available)
      CardClass.Developer,          // 15th pop
      CardClass.Developer,          // 16th pop
      CardClass.UpgradeCluster,     // 17th pop (if available)
    ];

    const cardsToAdd: Card[] = [];

    for (const cardClass of sequence) {
      // Find a card of this class in the deck
      const index = deck.findIndex(c => c.class === cardClass);
      if (index !== -1) {
        const [card] = deck.splice(index, 1);
        cardsToAdd.push(card);
      }
    }

    // Push them onto the deck in REVERSE order so they are popped in the sequence order.
    for (let i = cardsToAdd.length - 1; i >= 0; i--) {
      deck.push(cardsToAdd[i]);
    }
  }

  private dealDevModeHands(game: Game, deck: Card[]) {
    const findAndRemove = (criteria: (c: Card) => boolean, count: number): Card[] => {
      const found: Card[] = [];
      for (let i = 0; i < count; i++) {
        const idx = deck.findIndex(criteria);
        if (idx !== -1) {
          found.push(deck.splice(idx, 1)[0]);
        }
      }
      return found;
    };

    // Collect distinct DEVELOPER card names
    const devCardNames: string[] = [];
    const allDeveloperCards = deck.filter(c => c.class === CardClass.Developer);
    for (const card of allDeveloperCards) {
      if (!devCardNames.includes(card.name)) {
        devCardNames.push(card.name);
      }
    }

    // Ensure we have enough distinct developer types for the scenario
    if (devCardNames.length < 4) {
      this.log(game, `DEVMODE: Not enough distinct DEVELOPER card types in deck for 3+ player setup. Found: ${devCardNames.length}`);
      // Fallback to default dealing if not enough distinct developer types, or simpler devmode hands.
      // For now, we proceed with available names, which might lead to non-ideal devmode hands.
    }

    const nameA = devCardNames[0] || 'firefighter';
    const nameB = devCardNames[1] || 'grumpy_greybeard';
    const nameC = devCardNames[2] || 'helper';
    const nameD = devCardNames[3] || 'intern';

    const p1 = game.players[0];
    const p2 = game.players.length > 1 ? game.players[1] : null;
    const p3 = game.players.length > 2 ? game.players[2] : null;
    // P1 Hand
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameA, 2));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameB, 1));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Nak, 2));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Shuffle, 1));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Favor, 1));

    if (p2) {
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Nak, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Skip, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.ShuffleNow, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Attack, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.SeeTheFuture, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameB, 1)); // Matches P1's solo DEVELOPER
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameC, 1)); // Different DEVELOPER
    }

    if (p3) {
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Nak, 1));
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Skip, 1));
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Favor, 1));
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Attack, 1));
      p3.hand.push(...findAndRemove(c => c.class === CardClass.SeeTheFuture, 1));
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameB, 1)); // Matches P1's solo DEVELOPER (nameB)
      p3.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameD, 1)); // Different DEVELOPER (nameD)
    }
  }

  private giveDebugCard(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to use DEVMODE giveDebugCard in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    const debugCardIndex = game.drawPile.findIndex(c => c.class === CardClass.Debug);
    if (debugCardIndex > -1) {
      const [debugCard] = game.drawPile.splice(debugCardIndex, 1);
      player.hand.push(debugCard);
      this.log(game, `DEVMODE: gave a DEBUG card to player "${player.name}"`);
      this.updateGameNonce(game); // This triggers gameUpdate and handUpdate
    } else {
      // Optionally create one if none exist?
      this.log(game, `DEVMODE: no DEBUG cards left in deck for player "${player.name}"`);
      this.emitGameUpdate(game); // Ensure client knows count is 0
    }
  }

  private giveSafeCard(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to use DEVMODE giveSafeCard in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    const cardIndex = game.drawPile.findIndex(c => c.class !== CardClass.ExplodingCluster && c.class !== CardClass.UpgradeCluster);
    if (cardIndex > -1) {
      const [card] = game.drawPile.splice(cardIndex, 1);
      player.hand.push(card);
      this.log(game, `DEVMODE: gave a "${card.class}" card to player "${player.name}"`);
      this.updateGameNonce(game);
    } else {
      this.log(game, `DEVMODE: no safe cards left in deck for player "${player.name}"`);
      this.emitGameUpdate(game);
    }
  }

  private putCardBack(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to use DEVMODE putCardBack in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    if (player.hand.length > 0) {
      const card = player.hand.shift(); // Remove first card
      if (card) {
        game.drawPile.push(card); // Put back on top (end of array)
        this.log(game, `DEVMODE: player "${player.name}" put back card "${card.name}" (${card.class})`);
        this.updateGameNonce(game);
      }
    }
  }

  private showDeck(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Reject if caller is a spectator (not a player)
    // Note: Spectators might be allowed to see deck in future, but for now restrict to players
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to use DEVMODE showDeck in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // Send the full deck to the requester, reversed so top is first
    this.emitToSocket(socket.id, SocketEvent.DeckData, { deck: [...game.drawPile].reverse() });
  }

  private showRemovedPile(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Reject if caller is a spectator (not a player)
    // Note: Spectators might be allowed to see removed pile in future, but for now restrict to players
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to use DEVMODE showRemovedPile in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // Send the removed pile to the requester
    this.emitToSocket(socket.id, SocketEvent.RemovedData, { removedPile: game.removedPile });
  }

  private drawCard(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.msgToPlayer(socket.id, "Game has ended.");
      return;
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to draw card in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // Prevent concurrent hand modifications (race condition protection)
    if (player.isPlaying) {
      this.log(game, `player "${player.name}" tried to draw a card while another operation is in progress`);
      this.msgToPlayer(socket.id, "Please wait for your current operation to complete.");
      return;
    }

    // Validation
    if (game.state !== GameState.Started) {
      this.msgToPlayer(socket.id, "Game not started.");
      return;
    }

    if (!this.isPlayerTurn(game, player)) {
      this.msgToPlayer(socket.id, "It's not your turn!");
      return;
    }

    if (game.turnPhase !== TurnPhase.Action) {
      this.log(game, `player "${player.name}" tried to draw in phase ${game.turnPhase} (expected Action)`);
      this.msgToPlayer(socket.id, "You cannot draw right now (wait for reactions).");
      return;
    }

    if (game.drawPile.length === 0) {
      this.log(game, `draw pile empty, cannot draw`);
      this.msgToPlayer(socket.id, "The deck is empty!");
      return;
    }

    // Set playing flag to prevent concurrent operations
    // This flag will be cleared when the draw operation completes
    player.isPlaying = true;

    let card: Card | undefined;
    try {
      card = game.drawPile.pop()!;
      if (!card) {
        // This shouldn't happen due to earlier check, but handle it defensively
        this.log(game, `drawCard: draw pile was empty when trying to pop`);
        this.msgToPlayer(socket.id, "The deck is empty!");
        return;
      }
      game.drawCount++;
      this.log(game, `player "${player.name}" drew ${card.class} ("${card.name}"), draw=${game.drawCount}`);

      // This duration gives clients a moment to do an animation before
      // updating the "whose turn is it" indicator.
      const duration = config.goFast ? 500 : 2000;

      // Determine next card image (for client-side use)
      const nextCard = game.drawPile.length > 0 ? game.drawPile[game.drawPile.length - 1] : undefined;
      const nextCardImageUrl = (nextCard && nextCard.isFaceUp) ? nextCard.imageUrl : "/art/back.png";

      // Current player gets to know the card being drawn
      this.emitToSocket(socket.id, SocketEvent.CardDrawn, {
        drawingPlayerId: player.id,
        card: card, // They see the card
        duration: duration,
        nextCardImageUrl
      });

      // Others see "someone drew" (no card info)
      for (const p of game.players) {
        if (p.id !== player.id && p.socketId) {
          this.emitToSocket(p.socketId, SocketEvent.CardDrawn, {
            drawingPlayerId: player.id,
            duration: duration,
            nextCardImageUrl
          });
        }
      }
      for (const s of game.spectators) {
        this.emitToSocket(s.socketId, SocketEvent.CardDrawn, {
          drawingPlayerId: player.id,
          duration: duration,
          nextCardImageUrl
        });
      }

      const finishDrawCard = () => {
        game.timer = null;

        try {
          // Race condition protection: Check if game still exists and player is still in game
          const currentGame = this.games.get(gameCode);
          if (!currentGame) {
            this.log(null, `finishDrawCard: game ${gameCode} no longer exists`);
            return;
          }

          // Check if player still exists and is still connected
          const currentPlayer = currentGame.players.find(p => p.id === player.id);
          if (!currentPlayer || currentPlayer.isDisconnected) {
            this.log(currentGame, `finishDrawCard: player "${player.name}" no longer in game or disconnected`);
            this.msgToAllPlayers(currentGame.code, `${player.name} left the game mid-draw, that card has been removed from the game.`);
            // Card was already popped from deck, need to remove it from the
            // game.  Why remove it rather than put it back? The number of
            // EXPLODING CLUSTER and DEBUG cards in the deck is critical to
            // game balance.
            game.removedPile.push(card!);
            if (currentPlayer) currentPlayer.isPlaying = false;
            return;
          }

          // Verify it's still this player's turn
          if (currentGame.state !== GameState.Started || !this.isPlayerTurn(currentGame, player)) {
            this.log(currentGame, `BUG: finishDrawCard: turn changed in the middle of draw`);
            this.msgToAllPlayers(currentGame.code, `BUG: turn changed in the middle of player "${player.name}"'s draw.`);
            // The player was already sent the card, but we can't remove it
            // from the game because that would alter deck balance (e.g. number
            // of EXPLODING CLUSTERS).  Randomly reinsert it.
            const insertIndex = Math.floor(this.prng.random() * (currentGame.drawPile.length + 1));
            currentGame.drawPile.splice(insertIndex, 0, card!);
            currentPlayer.isPlaying = false;
            return;
          }

          // Check for EXPLODING CLUSTER
          if (card!.class === CardClass.ExplodingCluster) {
            this.setTurnPhase(currentGame, TurnPhase.Exploding);
            currentGame.discardPile.push(card!); // Put on discard pile
            this.msgToAllPlayers(currentGame.code, `${currentPlayer.name} drew an EXPLODING CLUSTER!`);

            const debugCardIndex = currentPlayer.hand.findIndex(c => c.class === CardClass.Debug);
            if (debugCardIndex === -1) {
              // Eliminate player
              this.log(currentGame, `player "${currentPlayer.name}" exploded (no DEBUG card)`);
              this.msgToAllPlayers(currentGame.code, `${currentPlayer.name}'s cluster has exploded, they are out of the game.`);

              const hand = currentPlayer.hand;
              currentGame.removedPile.push(...hand);
              currentPlayer.hand = [];
              currentPlayer.isOut = true;

              // Move EXPLODING CLUSTER from discard to removed
              const popped = currentGame.discardPile.pop();
              if (popped) currentGame.removedPile.push(popped);

              // Reset phase for next player
              this.setTurnPhase(currentGame, TurnPhase.Action);

              // Determine the winner (the last remaining active player)
              const activePlayersAfterExplosion = currentGame.players.filter(p => !p.isOut && !p.isDisconnected && p.id !== currentPlayer.id);
              if (activePlayersAfterExplosion.length === 1) {
                this.handleWin(currentGame, activePlayersAfterExplosion[0], WinType.Explosion);
              } else if (activePlayersAfterExplosion.length === 0) {
                this.endGame(currentGame.code, "Nobody", WinType.Explosion); // All players exploded.
              } else {
                // Game continues if > 1 player remains after current player explodes and others didn't.
                this.advanceTurn(currentGame);
                this.updateGameNonce(currentGame, currentPlayer.name);
              }
            } else {
              // Has DEBUG card
              // Stay in turn, phase is Exploding
              this.updateGameNonce(currentGame, currentPlayer.name);
            }
          } else if (card!.class === CardClass.UpgradeCluster) {
            if (card!.isFaceUp) {
              // Face-up UPGRADE CLUSTER: Immediate Elimination
              this.log(currentGame, `player "${currentPlayer.name}" drew face-up UPGRADE CLUSTER and is OUT`);
              this.msgToAllPlayers(currentGame.code, `${currentPlayer.name}'s cluster was upgraded out of existence, they are out of the game.`);

              // Remove player hand
              const hand = currentPlayer.hand;
              currentGame.removedPile.push(...hand);
              currentPlayer.hand = [];
              currentPlayer.isOut = true;

              // Move UPGRADE CLUSTER to discard pile
              currentGame.discardPile.push(card!);

              this.setTurnPhase(currentGame, TurnPhase.Action); // Reset phase

              // Determine winner
              const activePlayersAfter = currentGame.players.filter(p => !p.isOut && !p.isDisconnected && p.id !== currentPlayer.id);
              if (activePlayersAfter.length === 1) {
                this.handleWin(currentGame, activePlayersAfter[0], WinType.Explosion);
              } else if (activePlayersAfter.length === 0) {
                this.endGame(currentGame.code, "Nobody", WinType.Explosion);
              } else {
                this.advanceTurn(currentGame);
                this.updateGameNonce(currentGame, currentPlayer.name);
              }
            } else {
              // Face-down UPGRADE CLUSTER: Upgrading Phase
              this.setTurnPhase(currentGame, TurnPhase.Upgrading);
              currentGame.discardPile.push(card!);
              this.msgToAllPlayers(currentGame.code, `${currentPlayer.name} drew an UPGRADE CLUSTER!`);
              this.updateGameNonce(currentGame, currentPlayer.name);
            }
          } else {
            // Regular card
            this.msgToAllPlayers(game.code, `${player.name} drew a card.`);
            currentPlayer.hand.push(card!);

            if (currentGame.attackTurns > 0) {
              currentGame.attackTurns--;
              currentGame.attackTurnsTaken++;
            }

            if (currentGame.attackTurns > 0) {
              // Player must take more turns
              this.updateGameNonce(currentGame, currentPlayer.name);
            } else {
              this.advanceTurn(currentGame);
              this.updateGameNonce(currentGame, currentPlayer.name);
            }
          }
        } catch (error) {
          this.log(null, `finishDrawCard error: ${error}`);
        } finally {
          const currentGame = this.games.get(gameCode);
          if (currentGame) {
            const currentPlayer = currentGame.players.find(p => p.id === player.id);
            if (currentPlayer) {
              currentPlayer.isPlaying = false;
            }
          }
        }
      };
      game.timer = setTimeout(finishDrawCard, duration);
    } catch (error) {
      // Handle any errors that occur before or during setTimeout setup
      this.log(game, `drawCard error: ${error}`);
      // Clear the playing flag immediately on error
      player.isPlaying = false;
      // Put card back in deck if it was popped
      if (card) {
        game.drawPile.push(card);
      }
      this.msgToPlayer(socket.id, "An error occurred while drawing a card.");
    }
  }

  private reorderHand(socket: Socket, gameCode: string, newHand: Card[]) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `attempted to reorder hand for non-existent game: ${gameCode}`);
      return;
    }

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: game.players.find(p => p.socketId === socket.id)?.hand || [] });
      return;
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to reorder hand in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // Prevent concurrent hand modifications (race condition protection)
    // This prevents reordering while playing cards, drawing cards, or during other reorders
    if (player.isPlaying) {
      this.log(game, `player "${player.name}" tried to reorder hand while another operation is in progress`);
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Revert client hand
      return;
    }

    // Set playing flag to prevent concurrent operations
    // Note: We reuse isPlaying for all hand-modifying operations (play, combo, reorder)
    // This is safe because reordering is a quick operation
    player.isPlaying = true;

    try {
      // Basic validation: ensure the newHand contains the same cards, just reordered.
      // Check 1: Same length
      if (player.hand.length !== newHand.length) {
        this.log(game, `invalid hand reorder attempt by player "${player.name}": length mismatch`);
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }

      // Optimized validation using Sets for O(n) complexity instead of O(n²)
      // Create Set of card IDs from player's current hand
      const currentHandIds = new Set(player.hand.map(card => card.id));
      const newHandIds = new Set<string>();

      // Check 2 & 3: Validate all cards exist in both directions and collect IDs
      for (const newCard of newHand) {
        // Validate card structure
        if (!newCard || newCard.id.length === 0) {
          this.log(game, `invalid hand reorder attempt by player "${player.name}": invalid card structure`);
          this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
          return;
        }

        // Check if card exists in current hand (prevents card injection)
        if (!currentHandIds.has(newCard.id)) {
          this.log(game, `invalid hand reorder attempt by player "${player.name}": extra cards`);
          this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
          return;
        }

        // Check for duplicates in new hand
        if (newHandIds.has(newCard.id)) {
          this.log(game, `player "${player.name}" tried to reorder hand with duplicate card IDs`);
          this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
          return;
        }

        newHandIds.add(newCard.id);
      }

      // Check 4: Ensure all cards from old hand exist in new hand (prevents card removal)
      if (currentHandIds.size !== newHandIds.size) {
        this.log(game, `invalid hand reorder attempt by player "${player.name}": missing cards`);
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }

      player.hand = newHand;
      if (this.verbose) {
        this.log(game, `player "${player.name}" reordered their hand.`);
      }
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Update only the reordering player
    } finally {
      // Always clear the playing flag, even if validation fails
      player.isPlaying = false;
    }
  }

  private canPlayCard(game: Game, player: Player, card: Card): { allowed: boolean; reason?: string } {
    const isMyTurn = this.isPlayerTurn(game, player);
    const isNowCard = !!card.now;
    const isReactionToMe = (game.lastActorName && player.name === game.lastActorName)

    // Regardless of whose turn it is, some rules apply
    if (game.turnPhase === TurnPhase.Reaction) {
      // You can't react to yourself
      if (isReactionToMe) {
        return { allowed: false, reason: "You must wait for reactions." };
      }
      // You can only play certain cards
      if (isNowCard || card.class === CardClass.Nak) {
        return { allowed: true }
      }
      return { allowed: false, reason: 'Only "NOW" or NAK cards can be played as a reaction.' };
    }

    // Depending on whose turn it is we want different errors
    if (!isMyTurn) {
      if (game.turnPhase === TurnPhase.Action) {
          if (isNowCard) return { allowed: true };
          return { allowed: false, reason: "It's not your turn!" };
      }
      return { allowed: false, reason: `You can't play cards right now (${game.turnPhase}).` };
    }

    // It's my turn.

    if (card.class === CardClass.Debug && game.turnPhase !== TurnPhase.Exploding) {
      return { allowed: false, reason: "DEBUG cards can only be played during an explosion." };
    }

    switch (game.turnPhase) {
      case TurnPhase.Action:
        if (card.class === CardClass.Nak && !game.devMode) {
          return { allowed: false, reason: "NAK can only be played as a reaction." };
        }
        if (card.class === CardClass.Developer) {
          return { allowed: false, reason: "DEVELOPER cards can only be played as combos." };
        }
        return { allowed: true };

      // case TurnPhase.Reaction:
      //   This is handled above

      case TurnPhase.Exploding:
        if (card.class === CardClass.Debug) return { allowed: true };
        return { allowed: false, reason: "You must play a DEBUG card!" };

      case TurnPhase.Executing:
        return { allowed: false, reason: "You can't play cards while the previous play is in progress." };
    }
    return { allowed: false, reason: `You can't play cards right now (${game.turnPhase}).` };
  }

  private isPlayerTurn(game: Game, player: Player): boolean {
    return game.currentPlayer !== -1 && game.players[game.currentPlayer] && game.players[game.currentPlayer].id === player.id;
  }

  private getDensePlayerIndex(game: Game, sparseIndex: number): number {
    let denseIndex = 0;
    for (let i = 0; i < sparseIndex; i++) {
      if (!game.players[i].isDisconnected) {
        denseIndex++;
      }
    }
    return denseIndex;
  }

  private playCard(socket: Socket, gameCode: string, cardId: string, nonce?: string, victimId?: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `playCard failed: game ${gameCode} not found`);
      this.msgToPlayer(socket.id, "Error: Game not found.");
      return;
    }

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.log(game, `playCard failed: game has ended`);
      this.msgToPlayer(socket.id, "Game has ended.");
      return;
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to play card in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // NOTE: do not check if this is the current player yet - reactions can be
    // played by others.  It will be checked in canPlayCard.

    // Nonce check
    if (nonce && nonce !== game.nonce) {
      this.log(game, `playCard rejected: nonce mismatch (client=${nonce}, server=${game.nonce})`);
      this.emitToSocket(socket.id, SocketEvent.PlayError, {
        reason: `${game.lastActorName || "Another player"} beat you to it, do you still want to play this card?`,
        cardId,
        nonce: game.nonce
      });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Prevent concurrent card plays from the same player (race condition protection)
    if (player!.isPlaying) {
      this.log(game, `player "${player.name}" tried to play a card while another play is in progress`);
      this.msgToPlayer(socket.id, "Please wait for your current play to complete.");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Revert optimistic update
      return;
    }

    // Check they actually hold this card
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      this.log(game, `player "${player.name}" tried to play a card they don't have (id: "${cardId}")`);
      this.msgToPlayer(socket.id, "You don't have that card!");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }
    const cardInHand = player.hand[cardIndex];

    // Verify that this card is allowed to be played by this player at this time
    const { allowed, reason } = this.canPlayCard(game, player, cardInHand);
    if (!allowed) {
      this.log(game, `player "${player.name}" tried to play ${cardId}, rejected: ${reason} (phase=${game.turnPhase})`);
      this.msgToPlayer(socket.id, reason || "You can't play that card right now!");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Revert optimistic update
      return;
    }

    // Set playing flag to prevent concurrent plays
    player.isPlaying = true;

    try {
      const [card] = player.hand.splice(cardIndex, 1);
      game.discardPile.push(card);

      this.log(game, `player "${player.name}" played "${card.class}: ${card.name}"`);
      this.msgToAllPlayers(game.code, `${player.name} played ${card.class}.`);

      let cb: ActionCallback | undefined;

      // All of these functions should:
      // * return a callback if they have work to do after reactions
      // * return undefined if no further action is needed
      // * send any specific messages to players or the game
      // * advance the turn if needed
      // * revert hand state if they need to cancel the play
      //
      // They should NOT update the nonce.
      if (card.class === CardClass.Debug) {
        cb = this.playDebugCard(game, player, card);
      } else if (card.class === CardClass.Nak) {
        cb = this.playNakCard(game, player, card);
      } else if (card.class === CardClass.Shuffle || card.class === CardClass.ShuffleNow) {
        cb = this.playShuffleCard(game, player, card);
      } else if (card.class === CardClass.Attack) {
        cb = this.playAttackCard(game, player, card);
      } else if (card.class === CardClass.Skip) {
        cb = this.playSkipCard(game, player, card);
      } else if (card.class === CardClass.Favor) {
        cb = this.playFavorCard(game, player, card, victimId);
      } else if (card.class === CardClass.SeeTheFuture) {
        cb = this.playSeeTheFutureCard(game, player, card);
      } else {
        this.log(game, `unhandled CardClass ${card.class}`);
        this.msgToPlayer(socket.id, `Error: Invalid card type ${card.class}.`);
        return
      }

      if (cb) {
        game.pendingOperations.push({
          cardClass: card.class,
          playerName: player.name,
          action: cb,
        });
        this.startReactionTimer(game, player.id);
      }
    } finally {
      // Always clear the playing flag, even if an error occurred
      player.isPlaying = false;
    }
    this.updateGameNonce(game, player.name);
  }

  private playDebugCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    this.setTurnPhase(game, TurnPhase.ExplodingReinserting);
    this.msgToAllPlayers(game.code, `${player.name}'s cluster almost exploded, but they debugged it!`);
    return undefined;
  }

  private playNakCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    return async (_g: Game) => {
      const negatedOp = _g.pendingOperations.pop(); // Pop the item below
      if (negatedOp) {
        this.log(_g, `NAK by player "${player.name}" negated operation ${negatedOp.cardClass} by ${negatedOp.playerName}`);
        this.msgToAllPlayers(_g.code, `${player.name} NAKed ${negatedOp.playerName}'s ${negatedOp.cardClass}.`);
      }
    }
  }

  private playShuffleCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    return async (_g: Game) => {
      _g.drawPile = shuffleDeck(_g.drawPile, this.prng.random.bind(this.prng));
      this.log(_g, "The deck was shuffled");
      this.msgToAllPlayers(_g.code, "The deck was shuffled.");
    }
  }

  private playAttackCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    return async (_g: Game) => {
      _g.attackTurns += 2; // attacks stack up

      // Current player's turn ends immediately, pass to next player
      this.advanceTurn(_g);
      const targetPlayer = _g.players[_g.currentPlayer];
      if (targetPlayer) {
        this.log(_g, `player "${player.name}" played ATTACK on "${targetPlayer.name}". attackTurns is now ${_g.attackTurns}.`);
        this.msgToAllPlayers(_g.code, `${player.name} attacked ${targetPlayer.name} for ${_g.attackTurns} turns!`);
      } else {
        this.log(_g, `playAttackCard failed: target player not found (index: ${_g.currentPlayer})`);
      }
    }
  }

  private playSkipCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    return async (_g: Game) => {
      if (_g.attackTurns > 0) {
        _g.attackTurns--;
        _g.attackTurnsTaken++;
        this.log(_g, `player "${player.name}" skipped one attack turn, ${_g.attackTurns} remaining`);
        if (_g.attackTurns > 0) {
          return; // still has turns to take, stay on current player
        }
      }
      this.advanceTurn(_g);
      this.msgToAllPlayers(_g.code, `${player.name} skipped their turn.`);
    }
  }

  private playFavorCard(game: Game, player: Player, card: Card, victimId?: string): ActionCallback | undefined {
    // Validate the victim
    const victim = victimId ? game.players.find(p => p.id === victimId) : undefined;
    if (!victim || victim.isOut || victim.id === player.id || victim.hand.length === 0) {
      this.log(game, `player "${player.name}" tried to play FAVOR with invalid victim`);
      this.msgToPlayer(player.socketId, "Invalid victim for FAVOR.");
      // Revert play
      game.discardPile.pop();
      player.hand.push(card);
      this.emitToSocket(player.socketId, SocketEvent.HandUpdate, { hand: player.hand });
      return undefined;
    }

    this.msgToAllPlayers(game.code, `${player.name} asked ${victim.name} for a favor.`);

    return async (_g: Game) => {
      // Re-fetch victim, since time has passed
      const currentVictim = _g.players.find(p => p.id === victimId);
      if (!currentVictim) {
        this.log(_g, `BUG: FAVOR victim "${victimId}" was not found`);
        this.msgToAllPlayers(_g.code, `BUG: FAVOR victim was not found!`);
        return;
      }
      if (currentVictim.hand.length === 0) {
        this.log(_g, `FAVOR failed: victim "${currentVictim?.name}" has empty hand`);
        this.msgToAllPlayers(_g.code, `${player.name} asked ${currentVictim.name} for a favor, but they have no cards left!`);
        return;
      }

      let stolenCardIndex = -1;
      let finalVictim: Player | undefined = undefined;
      if (currentVictim.isOut) {
        stolenCardIndex = Math.floor(this.prng.random() * currentVictim.hand.length);
        finalVictim = currentVictim;
      } else {
        this.setTurnPhase(_g, TurnPhase.ChoosingFavorCard);
        game.favorVictimId = victimId; // for reference in async resolution
        this.updateGameNonce(_g, player.name); // notify clients of phase change
        // This timeout defines how long the victim has to choose a card before
        // we choose one for them.
        const timeout = config.goFast ? FAST_CHOOSE_CARD_TIMEOUT_MS : CHOOSE_CARD_TIMEOUT_MS;
        this.emitToSocket(currentVictim.socketId, SocketEvent.ChooseFavorCard, {stealerName: player.name, timeout: timeout});

        // This might be resolved by the victim choosing a card, by a timeout
        // choosing a random card, or by the victim disconnecting.
        const cardId = await Promise.race([
          new Promise<string>(resolve => {
            _g.favorResolver = resolve;
          }),
          new Promise<string>(resolve => {
            setTimeout(() => {
              // Pick random card if timeout
              const v = _g.players.find(p => p.id === victimId);
              if (v && v.hand.length > 0) {
                const randIdx = Math.floor(this.prng.random() * v.hand.length);
                resolve(v.hand[randIdx].id);
                this.msgToPlayer(v.socketId, "Too slow! A random card was chosen for you.");
              } else {
                resolve("");
              }
            }, timeout);
          })
        ]);
        _g.favorResolver = undefined;
        _g.favorVictimId = undefined;

        // Re-fetch victim AGAIN
        const resolvedVictim = _g.players.find(p => p.id === victimId);
        if (!resolvedVictim) {
          this.log(_g, `BUG: FAVOR victim "${victimId}" was not found after resolution`);
          this.msgToAllPlayers(_g.code, `BUG: FAVOR victim was not found after resolution!`);
          return;
        }
        stolenCardIndex = resolvedVictim.hand.findIndex(c => c.id === cardId);
        finalVictim = resolvedVictim;
      }

      if (stolenCardIndex === -1) {
        this.log(_g, `BUG: FAVOR failed to find a card to steal`);
        this.msgToAllPlayers(_g.code, `BUG: FAVOR failed to find a card to steal!`);
        return;
      }

      const [stolenCard] = finalVictim.hand.splice(stolenCardIndex, 1);
      // Use ID to find fresh player object
      const requester = _g.players.find(p => p.id === player.id);
      if (!requester) {
        this.log(_g, `BUG: FAVOR player "${player.id}" was not found after resolution`);
        this.msgToAllPlayers(_g.code, `BUG: FAVOR player was not found after resolution!`);
      } else {
        requester.hand.push(stolenCard);
        this.emitToSocket(requester.socketId, SocketEvent.FavorResult, { card: stolenCard });
        this.emitToSocket(requester.socketId, SocketEvent.HandUpdate, { hand: requester.hand });
      }
      this.emitToSocket(finalVictim.socketId, SocketEvent.HandUpdate, { hand: finalVictim.hand });
      let victimName = finalVictim.name;
      if (finalVictim.isOut) {
        victimName = `${finalVictim.name}'s estate`;
      }
      this.log(_g, `player "${player.name}" received "${stolenCard.class}" from "${finalVictim.name}"`);
      this.msgToAllPlayers(_g.code, `${victimName} gave ${player.name} a card.`);
    }
  }

  private playSeeTheFutureCard(game: Game, player: Player, card: Card): ActionCallback | undefined {
    return async (_g: Game) => {
      // Retrieve top 3 cards without removing them
      const top3Cards = _g.drawPile.slice(Math.max(0, _g.drawPile.length - 3)).reverse();

      // This timeout is the max that the player can delay the game.
      const timeout = config.goFast ? FAST_DELAY_TIMEOUT_MS : DELAY_TIMEOUT_MS;

      // Send to player who played card
      this.emitToSocket(player.socketId, SocketEvent.SeeTheFutureData, { cards: top3Cards, timeout: timeout });
      this.log(_g, `player "${player.name}" saw the future`);
      this.msgToAllPlayers(_g.code, `${player.name} saw the future.`);

      // Set phase to SeeingTheFuture and block other players
      this.setTurnPhase(_g, TurnPhase.SeeingTheFuture);
      this.updateGameNonce(_g, player.name); // Notify clients of phase change

      // Wait for player to dismiss overlay or timeout
      await new Promise<void>(resolve => {
        _g.seeTheFutureResolver = resolve;
        _g.timer = setTimeout(() => {
          this.log(_g, `SeeTheFuture timer expired for player "${player.name}"`);
          if (_g.seeTheFutureResolver) {
            _g.seeTheFutureResolver(); // Resolve the promise to continue game flow
            _g.seeTheFutureResolver = undefined;
          }
          _g.timer = null;
        }, timeout);
      });
    }
  }

  private playCombo(socket: Socket, gameCode: string, cardIds: string[], nonce?: string, victimId?: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `playCombo failed: game ${gameCode} not found`);
      this.msgToPlayer(socket.id, "Error: Game not found.");
      return;
    }

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.log(game, `playCombo failed: game has ended`);
      this.msgToPlayer(socket.id, "Game has ended.");
      return;
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to play combo in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }

    // Unlike playCard, combos can only be played by the current player
    if (!this.isPlayerTurn(game, player)) {
      this.log(game, `player "${player.name}" tried to play a combo out of turn`);
      this.msgToPlayer(socket.id, "It's not your turn!");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Nonce check
    if (nonce && nonce !== game.nonce) {
      this.log(game, `playCombo rejected: nonce mismatch (client=${nonce}, server=${game.nonce})`);
      this.emitToSocket(socket.id, SocketEvent.PlayError, {
        reason: `${game.lastActorName || "Another player"} beat you to it, do you still want to play this combo?`,
        cardIds,
        nonce: game.nonce
      });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Prevent concurrent card plays from the same player (race condition protection)
    if (player!.isPlaying) {
      this.log(game, `player "${player.name}" tried to play a combo while another play is in progress`);
      this.msgToPlayer(socket.id, "Please wait for your current play to complete.");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Validate the combo: we only support 2x combos for now
    if (!cardIds || cardIds.length !== 2) {
      this.log(game, `player "${player.name}" tried to play a combo of ${cardIds?.length}`);
      this.msgToPlayer(socket.id, "Invalid combo.");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Check they actually hold these cards
    let idSet: Set<string> = new Set(cardIds);
    if (idSet.size !== cardIds.length) {
      this.log(game, `player "${player.name}" tried to play a combo with duplicate card IDs`);
      this.msgToPlayer(socket.id, "Invalid combo.");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }
    const cardIndices: number[] = [];
    const cardsInHand: Card[] = [];
    for (const id of cardIds) {
      const idx = player.hand.findIndex(c => c.id === id);
      if (idx === -1) {
        this.log(game, `player "${player.name}" tried to play combo with a card they don't have (id: ${id})`);
        this.msgToPlayer(socket.id, "You don't have that card!");
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }
      cardIndices.push(idx);
      cardsInHand.push(player.hand[idx]);
    }

    // Validate combo is all identical DEVELOPER cards
    const card = cardsInHand[0];
    for (const c of cardsInHand) {
      if (c.class !== card.class || c.name !== card.name) {
        this.log(game, `player "${player.name}" tried to play an invalid combo: ${cardsInHand.map(c => `${c.class}:${c.name}`).join(", ")}`);
        this.msgToPlayer(socket.id, "Invalid combo. Must be DEVELOPER cards.");
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }
    }

    // Combo can only be played in Action phase
    if (game.turnPhase !== TurnPhase.Action) {
      this.log(game, `player "${player.name}" tried to play a combo in wrong phase: ${game.turnPhase}`);
      this.msgToPlayer(socket.id, "You can only play combos in your Action phase.");
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Set playing flag to prevent concurrent plays
    player.isPlaying = true;

    try {
      // Remove cards from hand. Sort indices descending to splice safely.
      cardIndices.sort((a, b) => b - a);
      for (const idx of cardIndices) {
        player.hand.splice(idx, 1);
      }

      // Add to discard pile
      game.discardPile.push(...cardsInHand);

      let cb: ActionCallback | undefined;

      // All of these functions should:
      // * return a callback if they have work to do after reactions
      // * return undefined if no further action is needed
      // * send any specific messages to players or the game
      // * advance the turn if needed
      // * revert hand state if they need to cancel the play
      //
      // They should NOT update the nonce.
      if (card.class === CardClass.Developer) {
        cb = this.play2xCombo(game, player, cardsInHand, victimId);
      } else {
        this.log(game, `unhandled CardClass ${card.class}`);
        this.msgToPlayer(socket.id, `Error: Invalid card type for combo ${card.class}.`);
        return;
      }

      if (cb) {
        game.pendingOperations.push({
          cardClass: card.class,
          playerName: player.name,
          action: cb,
        });
        this.startReactionTimer(game, player.id);
      }
    } finally {
      // Always clear the playing flag, even if an error occurred
      player.isPlaying = false;
    }
    this.updateGameNonce(game, player?.name);
  }

  private play2xCombo(game: Game, player: Player, cards: Card[], victimId?: string): ActionCallback | undefined {
    // Validate victim
    const victim = victimId ? game.players.find(p => p.id === victimId) : undefined;
    if (!victim || victim.isOut || victim.id === player.id || victim.hand.length === 0) {
      this.log(game, `player "${player.name}" tried to play 2x combo with invalid victim`);
      this.msgToPlayer(player.socketId, "Invalid victim for DEVELOPER combo.");
      // Revert play
      for (let i = 0; i < cards.length; i++) game.discardPile.pop();
      player.hand.push(...cards);
      this.emitToSocket(player.socketId, SocketEvent.HandUpdate, { hand: player.hand });
      return undefined;
    }
    const card = cards[0];

    this.log(game, `player "${player.name}" played 2x combo "${card.class}: ${card.name}" targeting "${victim.name}"`);
    this.msgToAllPlayers(game.code, `${player.name} wants to steal a card from ${victim.name}.`);

    return async (_g: Game) => {
      // Re-fetch victim, since time has passed
      const currentVictim = _g.players.find(p => p.id === victimId);
      if (!currentVictim) {
        this.log(_g, `BUG: 2x combo victim "${victimId}" was not found`);
        this.msgToAllPlayers(_g.code, `BUG: 2x combo victim was not found!`);
        return;
      }
      if (currentVictim.hand.length === 0) {
        this.log(_g, `2x combo failed: victim "${currentVictim?.name}" has empty hand`);
        this.msgToAllPlayers(_g.code, `${player.name} asked ${currentVictim.name} for a favor, but they have no cards left!`);
        return;
      }

      this.setTurnPhase(_g, TurnPhase.ChoosingDeveloperCard);
      this.updateGameNonce(_g, player.name); // Notify clients of phase change

      // This timeout defines how long the requester has to choose a card before
      // we choose one for them.
      const timeout = config.goFast ? FAST_CHOOSE_CARD_TIMEOUT_MS : CHOOSE_CARD_TIMEOUT_MS;
      this.emitToSocket(player.socketId, SocketEvent.ChooseStealCard, { victimName: currentVictim.name, handCount: currentVictim.hand.length, timeout: timeout });

      // Wait for response (index)
      let timeoutHandle: NodeJS.Timeout;
      // This might be resolved by the requester choosing a card or by a
      // timeout choosing a random card.
      const chosenIndex = await Promise.race([
          new Promise<number>(resolve => { _g.developerResolver = resolve; }),
          new Promise<number>(resolve => {
              timeoutHandle = setTimeout(() => {
                const v = _g.players.find(p => p.id === victimId);
                if (v) {
                  resolve(Math.floor(this.prng.random() * v.hand.length));
                  this.msgToPlayer(v.socketId, "Too slow! A random card was chosen for you.");
                } else {
                  resolve(-1);
                }
              }, timeout);
          })
      ]);
      clearTimeout(timeoutHandle!);
      _g.developerResolver = undefined;

      // Re-fetch victim AGAIN
      const finalVictim = _g.players.find(p => p.id === victimId);
      if (!finalVictim) {
          this.log(_g, "DEVELOPER combo failed: victim not found after resolution");
          return;
      }

      const [stolenCard] = finalVictim.hand.splice(chosenIndex, 1);

      // Requester
      const requester = _g.players.find(p => p.id === player.id);
      if (requester) {
          requester.hand.push(stolenCard);
          this.emitToSocket(requester.socketId, SocketEvent.StealResult, { card: stolenCard });
          this.emitToSocket(requester.socketId, SocketEvent.HandUpdate, { hand: requester.hand });
      }
      this.emitToSocket(finalVictim.socketId, SocketEvent.StealResult, { card: stolenCard });
      this.emitToSocket(finalVictim.socketId, SocketEvent.HandUpdate, { hand: finalVictim.hand });
      this.log(_g, `player "${player.name}" stole "${stolenCard.class}" from "${finalVictim.name}"`);
      this.msgToAllPlayers(_g.code, `${player.name} stole a card from ${finalVictim.name}.`);
    }
  }

  private resolvePendingInteractions(game: Game, player: Player) {
    if (game.state === GameState.Started && this.isPlayerTurn(game, player)) {
      // Check for in-progress EXPLODING CLUSTER
      if (game.turnPhase === TurnPhase.Exploding || game.turnPhase === TurnPhase.ExplodingReinserting) {
        // Find from end (most recent)
        let explodingIndex = -1;
        for (let i = game.discardPile.length - 1; i >= 0; i--) {
          if (game.discardPile[i].class === CardClass.ExplodingCluster) {
            explodingIndex = i;
            break;
          }
        }
        if (explodingIndex !== -1) {
          const [card] = game.discardPile.splice(explodingIndex, 1);
          const insertIndex = Math.floor(this.prng.random() * (game.drawPile.length + 1));
          game.drawPile.splice(insertIndex, 0, card);
          this.log(game, `reinserted ${card.name} at index ${insertIndex}`);
          this.msgToAllPlayers(game.code, `The EXPLODING CLUSTER card was hidden at a random position in the deck.`);
        }
      }

      // Check for in-progress UPGRADE CLUSTER
      if (game.turnPhase === TurnPhase.Upgrading) {
        let upgradeIndex = -1;
        for (let i = game.discardPile.length - 1; i >= 0; i--) {
          if (game.discardPile[i].class === CardClass.UpgradeCluster) {
            upgradeIndex = i;
            break;
          }
        }
        if (upgradeIndex !== -1) {
          const [card] = game.discardPile.splice(upgradeIndex, 1);
          card.isFaceUp = true; // Re-insert face-up
          const insertIndex = Math.floor(this.prng.random() * (game.drawPile.length + 1));
          game.drawPile.splice(insertIndex, 0, card);
          this.log(game, `reinserted ${card.name} (face-up) at index ${insertIndex}`);
          this.msgToAllPlayers(game.code, `The UPGRADE CLUSTER card was hidden at a random position in the deck.`);
        }
      }
    }

    // Check for pending FAVOR interaction
    if (game.turnPhase === TurnPhase.ChoosingFavorCard && game.favorVictimId === player.id && game.favorResolver) {
      this.log(game, `FAVOR victim "${player.name}" disconnected, resolving immediately`);
      if (player.hand.length == 0) {
        this.msgToAllPlayers(game.code, `${player.name} left with no cards, so no card was given.`);
      }
      const randIdx = Math.floor(this.prng.random() * player.hand.length);
      game.favorResolver(player.hand[randIdx].id);
      return;
    }

    // No need to check for pending DEVELOPER interaction - that is handled in
    // the normal flow (with the developerResolver).

    // Handle game-owner migration if needed
    if (game.state === GameState.Lobby && game.gameOwnerId === player.id) {
      if (game.players.length > 0) {
        const connectedPlayers = game.players.filter(p => !p.isDisconnected);
        // Prefer connected players, otherwise take any
        const newGameOwner = connectedPlayers.length > 0 ? connectedPlayers[0] : game.players[0];
        game.gameOwnerId = newGameOwner.id;
        this.log(game, `game owner "${player.name}" left, new game owner is "${newGameOwner.name}"`);
      }
    }
  }

  // This is very similar to handleDisconnect() -- keep them in sync.
  private leaveGame(socket: Socket, gameCode: string) {
    // Validate gameCode matches the socket's actual game (prevents leaving games you're not in)
    const actualGameCode = this.playerToGameMap.get(socket.id);
    if (!actualGameCode) {
      this.log(null, `socket ${socket.id} attempted to leave game ${gameCode} but is in game ${actualGameCode || 'none'}`);
      return; // Silently ignore invalid leave attempts
    }
    if (actualGameCode !== gameCode) {
      this.log(null, `socket ${socket.id} attempted to leave game ${gameCode} but is in game ${actualGameCode}`);
      return; // Silently ignore invalid leave attempts
    }
    this.playerToGameMap.delete(socket.id);

    const game = this.games.get(gameCode);
    if (!game) {
      return;
    }

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const spectatorIndex = game.spectators.findIndex(s => s.socketId === socket.id);

    const player = playerIndex !== -1 ? game.players[playerIndex] : undefined;
    const spectator = spectatorIndex !== -1 ? game.spectators[spectatorIndex] : undefined;

    if (player || spectator) {
      if (player) {
        this.log(game, `player "${player.name}" (${player.socketId}) voluntarily left the game`);
      } else {
        this.log(game, `spectator ${socket.id} voluntarily left the game`);
      }
      socket.leave(gameCode);
    }

    // Handle player leave
    if (player) {
      player.isDisconnected = true;
      player.isOut = true; // they are out for good

      // Send first message
      if (game.state === GameState.Started && this.isPlayerTurn(game, player)) {
        this.msgToAllPlayers(game.code, `${player.name} has fled in the middle of their turn!`);
      } else {
        this.msgToAllPlayers(game.code, `${player.name} has left the game, what a chicken!`);
      }

      // Handle scenarios where the departing player was involved.
      this.resolvePendingInteractions(game, player);

      // If it was their turn, advance
      if (game.state === GameState.Started && this.isPlayerTurn(game, player)) {
        this.advanceTurn(game);
        this.updateGameNonce(game, player.name);
      } else {
        this.emitGameUpdate(game);
      }
    }

    // Handle spectator leave
    if (spectator) {
      game.spectators.splice(spectatorIndex, 1);
      this.emitGameUpdate(game);
    }

    // Check if the game is over
    this.checkEndConditions(game);
  }

  // This is very similar to leaveGame() -- keep them in sync.
  private handleDisconnect(socket: Socket) {
    const gameCode = this.playerToGameMap.get(socket.id);
    if (!gameCode) {
      this.log(null, `socket ${socket.id} disconnected, not in any game`);
      return;
    }
    this.playerToGameMap.delete(socket.id);

    const game = this.games.get(gameCode);
    if (!game) {
      return;
    }

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const spectatorIndex = game.spectators.findIndex(s => s.socketId === socket.id);

    const player = playerIndex !== -1 ? game.players[playerIndex] : undefined;
    const spectator = spectatorIndex !== -1 ? game.spectators[spectatorIndex] : undefined;

    if (player || spectator) {
      if (player) {
        this.log(game, `player "${player.name}" (${player.socketId}) disconnected`);
      } else {
        this.log(game, `spectator ${socket.id} disconnected`);
      }
    }

    // Handle player disconnection
    if (player) {
      const oldSocketId = player.socketId;
      player.isDisconnected = true;
      player.socketId = ''; // Clear socketId so this socket can't be reused directly

      // Send first message
      if (game.state === GameState.Started && this.isPlayerTurn(game, player)) {
        this.msgToAllPlayers(game.code, `${player.name} has abandoned their turn!`);
      } else {
        this.msgToAllPlayers(game.code, `${player.name} has disconnected, maybe they will be right back?`);
      }

      // Handle scenarios where the departing player was involved.
      this.resolvePendingInteractions(game, player);

      // If it was their turn, advance
      if (game.state === GameState.Started && this.isPlayerTurn(game, player)) {
        this.advanceTurn(game);
        this.updateGameNonce(game, player.name);
      } else {
        this.emitGameUpdate(game);
      }
    }

    // Handle spectator leave
    if (spectator) {
      game.spectators.splice(spectatorIndex, 1);
      this.emitGameUpdate(game);
    }

    // Check if the game is over
    this.checkEndConditions(game);
  }

  private checkEndConditions(game: Game) {
    if (game.state === GameState.Ended) {
      return
    }

    const activePlayers = game.players.filter(p => !p.isOut && !p.isDisconnected);
    if (activePlayers.length === 0) {
      this.log(game, `game is empty, purging`);
      this.endGame(game.code, "Nobody", WinType.Attrition);
      return;
    }
    if (activePlayers.length === 1 && game.state === GameState.Started) {
      this.handleWin(game, activePlayers[0], WinType.Attrition);
      return;
    }
  }

  private endGame(gameCode: string, winnerName: string, winType: WinType) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `endGame failed: game ${gameCode} not found`);
      return;
    }
    if (game.state === GameState.Ended) {
      this.log(null, `endGame called for already-ended game ${gameCode}, ignoring`);
      return;
    }

    // Clear any pending timers first to prevent callbacks from executing
    if (game.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }

    // Clear isPlaying flags for all players to prevent operations from completing after game ends
    for (const player of game.players) {
      player.isPlaying = false;
    }

    // Set game state to Ended to prevent new operations and make this idempotent
    game.state = GameState.Ended;
    this.emitGameUpdate(game);

    const gameEndData = { winner: winnerName, winType: winType };

    this.emitToGame(game.code, SocketEvent.GameEnded, gameEndData);

    this.games.delete(gameCode); // Delete game from map after emitting

    this.log(null, `game ${gameCode} purged`);
  }

  // Centralized logging
  private log(game: Game | null, message: string) {
    const timestamp = new Date().toISOString();
    const prefix = game ? `[${timestamp}] [game ${game.code}] ` : `[${timestamp}] [server] `;
    console.log(prefix + message);
  }
  private vlog(game: Game | null, message: string) {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const prefix = game ? `[${timestamp}] [game ${game.code}] ` : `[${timestamp}] [server] `;
      console.log(prefix + message);
    }
  }

  private advanceTurn(game: Game) {
    game.attackTurnsTaken = 0; // Reset attack turns counter when moving to next player
    let nextIndex = (game.currentPlayer + 1) % game.players.length;
    let attempts = 0;
    while (attempts < game.players.length) {
      const nextPlayer = game.players[nextIndex];
      if (nextPlayer && !nextPlayer.isOut && !nextPlayer.isDisconnected) {
        break;
      }
      nextIndex = (nextIndex + 1) % game.players.length;
      attempts++;
    }

    game.prevTurnPhase = undefined;
    game.turnPhase = TurnPhase.Action;
    game.currentPlayer = nextIndex;
  }

  private handleWin(game: Game, winner: Player, winType: WinType) {
    this.endGame(game.code, winner.name, winType);
  }

  private reinsertUpgradeCard(socket: Socket, gameCode: string, index: number, nonce: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `reinsertUpgradeCard event from ${socket.id}: no such game ${gameCode}`);
      return;
    }

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) {
      this.log(game, `reinsertUpgradeCard event from ${socket.id}: no such player`);
      return;
    }

    if (!this.isPlayerTurn(game, player)) {
      this.log(game, `reinsertUpgradeCard event from player "${player?.name}": not their turn`);
      this.msgToPlayer(socket.id, "It's not your turn!");
      return;
    }

    if (game.turnPhase !== TurnPhase.Upgrading) {
      this.log(game, `reinsertUpgradeCard event from player "${player?.name}": wrong phase (${game.turnPhase})`);
      this.msgToPlayer(socket.id, "Turn phase is not ${TurnPhase.Upgrading}!");
      return;
    }

    if (nonce !== game.nonce) {
      this.log(game, `reinsertUpgradeCard event from player "${player?.name}": wrong nonce (${nonce})`);
      this.msgToPlayer(socket.id, "Game state mismatch.");
      return;
    }

    if (index < 0 || index > game.drawPile.length) {
      this.log(game, `reinsertUpgradeCard event from player "${player?.name}": invalid insertion index (${index})`);
      this.msgToPlayer(socket.id, "Invalid insertion index.");
      return;
    }

    // Find UPGRADE CLUSTER in discard pile
    let cardIndex = -1;
    for (let i = game.discardPile.length - 1; i >= 0; i--) {
      if (game.discardPile[i].class === CardClass.UpgradeCluster) {
        cardIndex = i;
        break;
      }
    }

    if (cardIndex === -1) {
      this.log(game, "reinsertUpgradeCard: no UPGRADE CLUSTER in discard pile");
      return;
    }
    const [card] = game.discardPile.splice(cardIndex, 1);
    card.isFaceUp = true;

    // 0 is top (end of array), N is bottom (start of array)
    const insertIndex = game.drawPile.length - index;
    if (insertIndex < 0 || insertIndex > game.drawPile.length) {
      game.drawPile.push(card);
    } else {
      game.drawPile.splice(insertIndex, 0, card);
    }

    this.log(game, `player "${player.name}" reinserted UPGRADE CLUSTER (face-up) at index ${insertIndex} (user input ${index})`);
    this.msgToAllPlayers(game.code, `${player.name} has hidden the UPGRADE CLUSTER card back in the deck.`);

    // Reset phase to Action (for next player or current player if more turns)
    this.setTurnPhase(game, TurnPhase.Action);

    if (game.attackTurns > 0) {
      game.attackTurns--;
      game.attackTurnsTaken++;
    }

    if (game.attackTurns > 0) {
      // Player must take more turns
      this.updateGameNonce(game, player.name);
    } else {
      this.advanceTurn(game);
      this.updateGameNonce(game, player.name);
    }
  }

  private dismissSeeTheFuture(socket: Socket, gameCode: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return; // Only player who played card can dismiss

    if (!this.isPlayerTurn(game, player)) {
      this.log(game, `player "${player.name}" tried to dismiss SeeTheFuture out of turn`);
      return;
    }
    // Only allow dismissal if we are or were recently in SeeingTheFuture
    // phase. We track prevTurnPhase because time is involved and a client
    // might be delayed in sending the dismissal.
    let prev = game.turnPhase;
    if (game.prevTurnPhase) {
      prev = game.prevTurnPhase;
    }
    if (game.turnPhase !== TurnPhase.SeeingTheFuture && prev !== TurnPhase.SeeingTheFuture) {
      this.log(game, `player "${player.name}" tried to dismiss SeeTheFuture out of phase (${game.turnPhase})`);
      return;
    }

    if (game.seeTheFutureResolver) {
      this.log(game, `player "${player.name}" manually dismissed SeeTheFuture`);
      game.seeTheFutureResolver(); // Resolve the promise
      game.seeTheFutureResolver = undefined;
    }
    if (game.timer) { // Clear the timeout if it's still running
      clearTimeout(game.timer);
      game.timer = null;
    }
  }

  private giveFavorCard(socket: Socket, gameCode: string, cardId: string) {
    const game = this.games.get(gameCode);
    if (!game) return;

    if (game.turnPhase !== TurnPhase.ChoosingFavorCard) return;

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // Validate ownership
    if (!player.hand.some(c => c.id === cardId)) {
      this.msgToPlayer(socket.id, "You don't have that card.");
      return;
    }

    if (game.favorResolver) {
      game.favorResolver(cardId);
    }
  }

  private stealCard(socket: Socket, gameCode: string, index: number) {
    const game = this.games.get(gameCode);
    if (!game) return;

    if (game.turnPhase !== TurnPhase.ChoosingDeveloperCard) return;

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || !this.isPlayerTurn(game, player)) return;

    if (game.developerResolver) {
        game.developerResolver(index);
    }
  }

  private reinsertExplodingCard(socket: Socket, gameCode: string, index: number, nonce: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `reinsertExplodingCard event from ${socket.id}: no such game ${gameCode}`);
      return;
    }

    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) {
      this.log(game, `reinsertExplodingCard event from ${socket.id}: no such player`);
      return;
    }

    if (!this.isPlayerTurn(game, player)) {
      this.log(game, `reinsertExplodingCard event from player "${player?.name}": not their turn`);
      this.msgToPlayer(socket.id, "It's not your turn!");
      return;
    }

    if (game.turnPhase !== TurnPhase.ExplodingReinserting) {
      this.log(game, `reinsertExplodingCard event from player "${player?.name}": wrong phase (${game.turnPhase})`);
      this.msgToPlayer(socket.id, `Turn phase is not ${TurnPhase.ExplodingReinserting}!`);
      return;
    }

    if (nonce !== game.nonce) {
      this.log(game, `reinsertExplodingCard event from player "${player?.name}": wrong nonce (${nonce})`);
      this.msgToPlayer(socket.id, "Game state mismatch.");
      return;
    }

    if (index < 0 || index > game.drawPile.length) {
      this.log(game, `reinsertExplodingCard event from player "${player?.name}": invalid insertion index (${index})`);
      this.msgToPlayer(socket.id, "Invalid insertion index.");
      return;
    }

    // Find EXPLODING CLUSTER in discard pile
    let cardIndex = -1;
    for (let i = game.discardPile.length - 1; i >= 0; i--) {
      if (game.discardPile[i].class === CardClass.ExplodingCluster) {
        cardIndex = i;
        break;
      }
    }

    if (cardIndex === -1) {
      this.log(game, "reinsertExplodingCard: no EXPLODING CLUSTER in discard pile");
      return;
    }
    const [card] = game.discardPile.splice(cardIndex, 1);

    // 0 is top (end of array), N is bottom (start of array)
    const insertIndex = game.drawPile.length - index;
    if (insertIndex < 0 || insertIndex > game.drawPile.length) {
      game.drawPile.push(card);
    } else {
      game.drawPile.splice(insertIndex, 0, card);
    }

    this.log(game, `player "${player.name}" reinserted EXPLODING CLUSTER at index ${insertIndex} (user input ${index})`);
    this.msgToAllPlayers(game.code, `${player.name} has hidden the EXPLODING CLUSTER card back in the deck.`);

    // Reset phase to Action (for next player or current player if more turns)
    this.setTurnPhase(game, TurnPhase.Action);

    if (game.attackTurns > 0) {
      game.attackTurns--;
      game.attackTurnsTaken++;
    }

    if (game.attackTurns > 0) {
      // Player must take more turns
      this.updateGameNonce(game, player.name);
    } else {
      this.advanceTurn(game);
      this.updateGameNonce(game, player.name);
    }
  }

  // Cleanup method for tests - clears all timers
  public cleanup(): void {
    for (const game of this.games.values()) {
      if (game.timer) {
        clearTimeout(game.timer);
        game.timer = null;
      }
    }
  }

  public handleInfozRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ? req.url.split('?')[0] : '/';

    if (url === '/infoz') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      let html = '<html><body><h1>Current Games</h1><ul>';
      if (this.games.size === 0) {
        html += '<li>No active games.</li>';
      } else {
        this.games.forEach((game, code) => {
          html += `<li><a href="/infoz/game/${code}">${code}</a> - State: ${game.state}, Players: ${game.players.length}</li>`;
        });
      }
      html += '</ul></body></html>';
      res.end(html);
      return;
    }

    if (url.startsWith('/infoz/game/')) {
      const code = url.split('/')[3];
      const game = this.games.get(code);

      if (!game) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Game not found');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      let html = `<html><body><h1>Game ${code}</h1>`;
      html += `<p>State: ${game.state}</p>`;
      html += `<p>Timestamp: ${new Date().toISOString()}</p>`;
      html += `<p>Nonce: ${game.nonce}</p>`;

      html += `<h3>Players (${game.players.length})</h3><ul>`;
      game.players.forEach(p => {
        const isTurn = this.isPlayerTurn(game, p);
        const escapedName = escapeHtml(p.name);
        html += `<li>${escapedName} ${isTurn ? '<strong>(TURN)</strong>' : ''} - Hand: ${p.hand.map(c => c.class).join(', ')}</li>`;
      });
      html += '</ul>';

      html += `<h3>Draw Pile (${game.drawPile.length})</h3>`;
      html += `<textarea rows="10" cols="80" readonly>${game.drawPile.map(c => c.class).join('\n')}</textarea>`;

      html += `<h3>Discard Pile (${game.discardPile.length})</h3>`;
      html += `<textarea rows="10" cols="80" readonly>${game.discardPile.map(c => c.class).join('\n')}</textarea>`;

      html += `<h3>Removed Pile (${game.removedPile.length})</h3>`;
      html += `<textarea rows="10" cols="80" readonly>${game.removedPile.map(c => c.class).join('\n')}</textarea>`;

      html += '</body></html>';
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end();
  }
}
