
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { fullDeck, shuffleDeck } from './app/game/deck';
import { PseudoRandom } from './utils/PseudoRandom';
import { Card, CardClass, GameState, GameUpdatePayload, SocketEvent, TurnPhase } from './api';
import { validatePlayerName, sanitizePlayerName, normalizeNameForComparison, escapeHtml } from './utils/nameValidation';
import { config } from './config';

// Define Operation interface for the operations stack
interface Operation {
  cardClass: CardClass;
  action: (game: Game) => void | Promise<void>;
}

// Define interfaces for game and player states
interface Player {
  id: string;
  name: string;
  socketId: string;
  hand: Card[]; 
  isOut: boolean;
  isDisconnected: boolean;
  turnsToTake: number;
  isPlaying: boolean; // Flag to prevent concurrent card plays from the same player
}

interface Game {
  code: string;
  players: Player[];
  spectators: { id: string; socketId: string }[];
  state: GameState;
  turnOrder: string[]; // Array of player IDs
  currentTurnIndex: number;
  turnPhase: TurnPhase;
  timerDuration?: number; // active timer duration
  drawPile: Card[]; 
  discardPile: Card[]; 
  removedPile: Card[]; // New: cards removed from the game
  pendingOperations: Operation[];
  gameOwnerId: string;
  nonce: string; // For reconnection logic
  lastActorName?: string; // Name of the player who caused the last nonce update
  timer: NodeJS.Timeout | null;
  devMode: boolean;
}

// GameManager handles game state and socket events
export class GameManager {
  private games: Map<string, Game> = new Map();
  private playerToGameMap: Map<string, string> = new Map(); // socketId -> gameCode
  private verbose: boolean = config.verbose;
  private prng: PseudoRandom;
  private maxGames: number;
  private maxSpectators: number;
  private reactionTimerDuration: number;

  constructor(private io: Server) {
    const devMode = config.devMode;
    this.prng = new PseudoRandom(devMode ? 0 : undefined);
    
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

      socket.on(SocketEvent.PlayCard, (data: { gameCode: string; cardId: string; nonce?: string }) => {
        this.playCard(socket, data.gameCode, data.cardId, data.nonce);
      });

      socket.on(SocketEvent.PlayCombo, (data: { gameCode: string; cardIds: string[]; nonce?: string }) => {
        this.playCombo(socket, data.gameCode, data.cardIds, data.nonce);
      });

      socket.on(SocketEvent.DrawCard, (gameCode: string) => {
        this.drawCard(socket, gameCode);
      });

      // Handle voluntary leave
      socket.on(SocketEvent.LeaveGame, (gameCode: string) => {
        // Validate gameCode matches the socket's actual game (prevents leaving games you're not in)
        const actualGameCode = this.playerToGameMap.get(socket.id);
        if (!actualGameCode || actualGameCode !== gameCode) {
          this.log(null, `socket ${socket.id} attempted to leave game ${gameCode} but is in game ${actualGameCode || 'none'}`);
          return; // Silently ignore invalid leave attempts
        }

        const game = this.games.get(gameCode);
        if (!game) {
          // Game doesn't exist, but clean up the map entry anyway
          this.playerToGameMap.delete(socket.id);
          return;
        }

        // Idempotency check: If socket is already removed from both players and spectators, ignore
        const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
        const spectatorIndex = game.spectators.findIndex(s => s.socketId === socket.id);
        
        if (playerIndex === -1 && spectatorIndex === -1) {
          // Already processed, just clean up map entry
          this.playerToGameMap.delete(socket.id);
          return;
        }

        // Prevent concurrent processing: Check if player is already disconnected/being processed
        if (playerIndex !== -1) {
          const player = game.players[playerIndex];
          if (player.isDisconnected) {
            // Already being handled by disconnect handler, skip to avoid double-processing
            this.log(game, `player "${player.name}" already disconnected, skipping leave processing`);
            this.playerToGameMap.delete(socket.id);
            return;
          }
        }

        this.log(game, `player ${socket.id} voluntarily left the game`);
        socket.leave(gameCode);

        let playerRemoved = false;
        // Remove player completely
        if (playerIndex !== -1) {
          playerRemoved = true;
          const player = game.players[playerIndex];

          // If game started, remove from turnOrder
          if (game.state === GameState.Started) {
            const turnIndex = game.turnOrder.indexOf(player.id);
            if (turnIndex !== -1) {
              game.turnOrder.splice(turnIndex, 1);
              // Adjust currentTurnIndex to prevent out-of-bounds access
              if (game.turnOrder.length === 0) {
                // No players left, game should end (handled elsewhere)
                game.currentTurnIndex = 0;
              } else if (turnIndex < game.currentTurnIndex) {
                // Removed player was before current turn, decrement index
                game.currentTurnIndex--;
              } else if (turnIndex === game.currentTurnIndex) {
                // Current player left - next player shifts into this index
                // If we were at the last position, wrap to 0
                if (game.currentTurnIndex >= game.turnOrder.length) {
                  game.currentTurnIndex = 0;
                }
                // Note: Turn advancement logic will be handled by game flow
              }
              // Ensure index is always valid
              if (game.currentTurnIndex < 0) {
                game.currentTurnIndex = 0;
              }
              if (game.currentTurnIndex >= game.turnOrder.length && game.turnOrder.length > 0) {
                game.currentTurnIndex = game.turnOrder.length - 1;
              }
            }
          }

          // Move player's hand to removedPile
          game.removedPile.push(...player.hand);
          player.hand = []; // Clear hand

          game.players.splice(playerIndex, 1); // Remove from array
          this.emitToGame(game.code, SocketEvent.GameMessage, { message: `${player.name} has left the game, what a chicken!` });

          // Handle owner migration if needed
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

        // Remove from spectators
        if (spectatorIndex !== -1) {
          game.spectators.splice(spectatorIndex, 1);
        }

        // Clean up map entry before game end checks to prevent re-processing
        this.playerToGameMap.delete(socket.id);

        // Atomic game end check: Only end game if it's actually empty and hasn't already ended
        if (game.state !== GameState.Ended) {
          if (game.players.length === 0 && game.spectators.length === 0) {
            this.log(game, `game is empty, purging`);
            this.endGame(gameCode);
            return; // endGame handles cleanup, don't continue
          } else if (game.state === GameState.Started && game.players.length < 2) {
            const winner = game.players[0];
            this.log(game, `game ended due to insufficient players, winner: ${winner.name}`);
            this.endGame(gameCode, { winner: winner.name, reason: 'attrition' });
            return; // endGame handles cleanup, don't continue
          }
        }

        // Update game state if game hasn't ended
        if (game.state !== GameState.Ended) {
          if (playerRemoved) {
            this.updateGameNonce(game); // Triggers update for everyone else
          } else {
            this.emitGameUpdate(game); // Just update list (spectator left)
          }
        }
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

  private emitToGame(game: string, event: string, data?: unknown) {
    if (this.verbose) {
      this.log(null, `game ${game}: sending event "${event}" to all players: ${JSON.stringify(data as string)}`);
    }
    this.io.to(game).emit(event, data);
  }

  private emitToSocket(socketId: string, event: string, data?: unknown) {
    if (this.verbose) {
      this.log(null, `sending event "${event}" to socket ${socketId}: ${JSON.stringify(data as string)}`);
    }
    this.io.to(socketId).emit(event, data);
  }

  private getGameUpdateData(game: Game): GameUpdatePayload {
    const topDiscardCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : undefined;

    const baseData: GameUpdatePayload = {
      gameCode: game.code,
      nonce: game.nonce,
      players: game.players
        .filter(p => !p.isDisconnected)
        .map(p => ({ id: p.id, name: p.name, cards: p.hand.length, isOut: p.isOut, isDisconnected: p.isDisconnected })),
      state: game.state,
      gameOwnerId: game.gameOwnerId,
      spectators: game.spectators.map(s => ({ id: s.id })),
      devMode: game.devMode,
      turnOrder: game.turnOrder,
      currentTurnIndex: game.currentTurnIndex,
      turnPhase: game.turnPhase,
      timerDuration: game.timerDuration,
      topDiscardCard: topDiscardCard, // Always send top card for rendering
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
    // Purge disconnected players whenever nonce changes
    const initialPlayers = game.players; // Keep a reference to original players
    game.players = game.players.filter(p => {
      if (p.isDisconnected) {
        game.removedPile.push(...p.hand);
        p.hand = []; // Clear hand
        this.log(game, `purged disconnected player "${p.name}" and removed their hand`);
        return false; // Exclude disconnected player
      }
      return true; // Keep connected player
    });
    if (game.players.length < initialPlayers.length) {
      this.log(game, `purged ${initialPlayers.length - game.players.length} disconnected players`);
    }

    // Check for attrition win after purge
    if (game.state === GameState.Started && game.players.length === 1) {
      const winner = game.players[0];
      this.log(game, `game won by attrition: winner ${winner.name}`);
      this.endGame(game.code, { winner: winner.name, reason: 'attrition' });
      return; // Stop further updates
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

    // Transition Phase logic
    // If the triggering player is the current turn player, it's a "Reaction" phase (others react to them).
    // If someone else played (interrupting), it's a "Rereaction" phase.
    const currentTurnPlayerId = game.turnOrder[game.currentTurnIndex];
    if (triggeringPlayerId === currentTurnPlayerId) {
      game.turnPhase = TurnPhase.Reaction;
    } else {
      game.turnPhase = TurnPhase.Rereaction;
    }

    this.emitToGame(game.code, SocketEvent.TimerUpdate, { duration: this.reactionTimerDuration, phase: game.turnPhase });
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
    game.turnPhase = TurnPhase.Executing;
    this.updateGameNonce(game); // Notify clients of phase change

    // Pop and execute all operations with timeout protection
    const OPERATION_TIMEOUT_MS = 5000; // 5 second timeout per operation
    while (game.pendingOperations.length > 0) {
      // Check game state again before each operation (refresh from map to avoid type narrowing issues)
      const currentGame = this.games.get(game.code);
      if (!currentGame || currentGame.state === GameState.Ended) {
        this.log(game, `executePlayedCards: game ended during execution, aborting remaining operations`);
        break;
      }

      const op = game.pendingOperations.pop();
      if (op) {
        try {
          this.log(game, `executing operation for ${op.cardClass}`);
          // Wrap operation in timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), OPERATION_TIMEOUT_MS);
          });
          await Promise.race([op.action(game), timeoutPromise]);
        } catch (e) {
          this.log(game, `error executing pending operation: ${e}`);
          // Continue with next operation even if one fails
        }
      }
    }

    // Only reset phase if game hasn't ended (refresh from map to avoid type narrowing issues)
    const finalGame = this.games.get(game.code);
    if (finalGame && finalGame.state !== GameState.Ended) {
      // Reset Phase to Action
      finalGame.turnPhase = TurnPhase.Action;
      this.emitToGame(finalGame.code, SocketEvent.TimerUpdate, { duration: 0, phase: finalGame.turnPhase });
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
    const player: Player = { id: playerId, name: sanitizedName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, turnsToTake: 0, isPlaying: false };
    const devMode = config.devMode;

    const newGame: Game = {
      code: gameCode,
      players: [player],
      spectators: [],
      state: GameState.Lobby,
      turnOrder: [],
      currentTurnIndex: -1,
      turnPhase: TurnPhase.Action, // Default phase
      drawPile: [],
      discardPile: [],
      removedPile: [], // Initialize new removed pile
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
        // If they were marked out, mark them back in?
        // Logic says "isOut" means they are out of the game (exploded). 
        // But "disconnected" logic marks them isOut?
        // "For now, we will mark them as out..." in handleDisconnect.
        // If they reconnect, we should probably unmark them isOut IF they weren't really out?
        // But we don't know if they were out due to game rules or disconnect.
        // Use a separate flag? Or just assume if they reconnect they are back.
        // But if they exploded, isOut is true.
        // We need 'isConnected' vs 'isOut'.
        // For now, leaving isOut logic as is, assuming isOut=true means "exploded".
        // But handleDisconnect sets isOut=true. This is problematic for reconnection.

        // Reverting handleDisconnect isOut logic might be needed later. 
        // For now, just fixing the lookup.

        this.log(game, `player "${sanitizedName}" (${existingPlayer.socketId}) rejoined the game`);
        this.emitToGame(game.code, SocketEvent.GameMessage, { message: `${sanitizedName} has rejoined the game, hoorah!` });
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
    const player: Player = { id: playerId, name: sanitizedName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, turnsToTake: 0, isPlaying: false };
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
    let deck = [...fullDeck];
    const explodingClusters = deck.filter(c => c.class === CardClass.ExplodingCluster);
    const upgradeClusters = deck.filter(c => c.class === CardClass.UpgradeCluster);
    // "The full deck is comprised of... 6 DEBUG cards".
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
    // Design doc says: "Put 2 DEBUG cards back into the deck, or 1 DEBUG card if that is all that is left. Any extra DEBUG cards are removed from the game."
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
      // Deal random to remaining players (P3+)
      for (let i = 2; i < game.players.length; i++) {
        game.players[i].hand.push(...deck.splice(0, 7));
      }
    } else {
      // Deal 7 cards to each player
      for (const p of game.players) {
        p.hand.push(...deck.splice(0, 7));
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
    const numPlayers = game.players.length;
    // "If there are 3 or 4 players put 1 "UPGRADE CLUSTER" card into the deck. If there are 5 players, put 2 "UPGRADE CLUSTER" cards in."
    // What about 2 players? Implied 0?
    let upgradeCount = 0;
    if (numPlayers >= 3 && numPlayers <= 4) upgradeCount = 1;
    else if (numPlayers === 5) upgradeCount = 2;

    for (let i = 0; i < upgradeCount; i++) {
      if (upgradeClusters.length > 0) deck.push(upgradeClusters.pop()!);
    }
    // Move any remaining upgradeClusters (excess) to the removedPile
    game.removedPile.push(...upgradeClusters);

    game.drawPile = shuffleDeck(deck, this.prng.random.bind(this.prng));

    // DEVMODE: Move Exploding Cluster to top
    if (game.devMode) {
      const explodingIndex = game.drawPile.findIndex(c => c.class === CardClass.ExplodingCluster);
      if (explodingIndex > -1) {
        const [explodingCard] = game.drawPile.splice(explodingIndex, 1);
        game.drawPile.push(explodingCard); // Push to end (which is the top for pop())
        this.log(game, `DEVMODE: moved EXPLODING_CLUSTER to top of deck`);
      }
    }

    // Set turn order
    game.turnOrder = game.players.map(p => p.id);
    if (!game.devMode) {
      for (let i = game.turnOrder.length - 1; i > 0; i--) {
        const j = Math.floor(this.prng.random() * (i + 1));
        [game.turnOrder[i], game.turnOrder[j]] = [game.turnOrder[j], game.turnOrder[i]];
      }
    }
    game.currentTurnIndex = 0;

    this.log(game, `game started`);
    this.updateGameNonce(game);
    this.emitToGame(game.code, SocketEvent.GameStarted);
    callback({ success: true });
  }

  private dealDevModeHands(game: Game, deck: Card[]) {
    // P1: 2 identical DEVELOPER, 1 other DEVELOPER, 2 NAK, 1 SHUFFLE, 1 FAVOR
    // P2: 2 NAK, 1 SHUFFLE_NOW, 1 ATTACK, 1 SEE FUTURE, 2 DEVELOPER (one identical to P1's pair, one not)

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

    // Identify a developer card name that has at least 3 copies in deck
    // (deck is shuffled, but fullDeck has 4 of each)
    // We need 3 copies of Type A, 1 copy of Type B, 1 copy of Type C (or just different from A)
    // Actually: P1 has 2x A, 1x B. P2 has 1x A, 1x C.

    // Just pick first developer card found as Type A
    const devCardA = deck.find(c => c.class === CardClass.Developer);
    if (!devCardA) return; // Should not happen
    const nameA = devCardA.name;

    // Pick Type B (different from A)
    const devCardB = deck.find(c => c.class === CardClass.Developer && c.name !== nameA);
    if (!devCardB) return;
    const nameB = devCardB.name;

    // Pick Type C (different from A and B, or just different from A? "one not [identical to P1's pair]")
    // P2 needs 2 DEVELOPER cards: one identical to P1's pair (A), one not.
    // "one not" could be B or C. Let's pick C to be safe/diverse.
    const devCardC = deck.find(c => c.class === CardClass.Developer && c.name !== nameA && c.name !== nameB);
    if (!devCardC) return; // Should not happen
    // If we are unlucky and only A and B are left (unlikely with 28 cards), we can use B.
    const nameC = devCardC ? devCardC.name : nameB; 

    const p1 = game.players[0];
    const p2 = game.players.length > 1 ? game.players[1] : null;

    // P1 Hand
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameA, 2));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameB, 1));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Nak, 2));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Shuffle, 1));
    p1.hand.push(...findAndRemove(c => c.class === CardClass.Favor, 1));

    if (p2) {
      // P2 Hand (1 NAK, 1 SKIP, 1 SHUFFLE_NOW, 1 ATTACK, 1 SEE FUTURE, 2 DEVELOPER) = 7 cards
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Nak, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Skip, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.ShuffleNow, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Attack, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.SeeTheFuture, 1));
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameB, 1)); // Matches P1's solo DEVELOPER
      p2.hand.push(...findAndRemove(c => c.class === CardClass.Developer && c.name === nameC, 1)); // Different DEVELOPER
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
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Game has ended." });
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
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Please wait for your current operation to complete." });
      return;
    }

    // Validation
    if (game.state !== GameState.Started) {
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Game not started." });
      return;
    }

    if (game.turnOrder[game.currentTurnIndex] !== player.id) {
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "It's not your turn!" });
      return;
    }

    if (game.turnPhase !== TurnPhase.Action) {
      this.log(game, `player "${player.name}" tried to draw in phase ${game.turnPhase} (expected Action)`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "You cannot draw right now (wait for reactions)." });
      return;
    }

    if (game.drawPile.length === 0) {
      this.log(game, `draw pile empty, cannot draw`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "The deck is empty!" });
      return;
    }

    // Set playing flag to prevent concurrent operations
    // This flag will be cleared when the draw animation completes (after 3 seconds)
    player.isPlaying = true;

    let card: Card | undefined;
    try {
      card = game.drawPile.pop()!;
      if (!card) {
        // This shouldn't happen due to earlier check, but handle it defensively
        this.log(game, `drawCard: draw pile was empty when trying to pop`);
        this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "The deck is empty!" });
        return;
      }
      this.log(game, `player "${player.name}" is drawing a card. Card is ${card.class} (${card.name})`);

      // Start animation phase
      // Current player sees the card
      this.emitToSocket(socket.id, SocketEvent.DrawCardAnimation, { 
        drawingPlayerId: player.id,
        card: card, // They see the card
        duration: 3000 
      });

      // Others see "someone drew" (no card info)
      for (const p of game.players) {
        if (p.id !== player.id && p.socketId) {
          this.emitToSocket(p.socketId, SocketEvent.DrawCardAnimation, {
            drawingPlayerId: player.id,
            duration: 3000
          });
        }
      }
      // Spectators
      for (const s of game.spectators) {
        this.emitToSocket(s.socketId, SocketEvent.DrawCardAnimation, {
          drawingPlayerId: player.id,
          duration: 3000
        });
      }

      // Notify "X drew a card" is now inside setTimeout to include next player's turn.

      // Set timer to finalize
      game.timer = setTimeout(() => {
      game.timer = null;

      try {
        // Ensure card was successfully popped
        if (!card) {
          this.log(null, `drawCard timer callback: card was undefined`);
          // Clear isPlaying flag - try to find player in any existing game
          const tempGame = this.games.get(gameCode);
          if (tempGame) {
            const tempPlayer = tempGame.players.find(p => p.id === player.id);
            if (tempPlayer) {
              tempPlayer.isPlaying = false;
            }
          }
          return;
        }

        // Race condition protection: Check if game still exists and player is still in game
        const currentGame = this.games.get(gameCode);
        if (!currentGame) {
          this.log(null, `drawCard timer callback: game ${gameCode} no longer exists`);
          // Cannot clear isPlaying flag if game doesn't exist - this is handled in finally block
          return; // Game was ended/deleted, abort
        }

        // Check if player still exists and is still connected
        const currentPlayer = currentGame.players.find(p => p.id === player.id);
        if (!currentPlayer || currentPlayer.isDisconnected) {
          this.log(currentGame, `drawCard timer callback: player "${player.name}" no longer in game or disconnected`);
          // Card was already popped from deck, need to put it back or discard it
          // Put it back at a random position to maintain game integrity
          const insertIndex = Math.floor(this.prng.random() * (currentGame.drawPile.length + 1));
          currentGame.drawPile.splice(insertIndex, 0, card);
          // Clear isPlaying flag before returning (player exists in game even if disconnected)
          if (currentPlayer) {
            currentPlayer.isPlaying = false;
          }
          return;
        }

        // Verify it's still this player's turn (game state might have changed)
        if (currentGame.state !== GameState.Started || 
            currentGame.turnOrder[currentGame.currentTurnIndex] !== player.id) {
          this.log(currentGame, `drawCard timer callback: turn changed, player "${player.name}" no longer has turn`);
          // Put card back in deck
          const insertIndex = Math.floor(this.prng.random() * (currentGame.drawPile.length + 1));
          currentGame.drawPile.splice(insertIndex, 0, card);
          // Clear isPlaying flag before returning
          currentPlayer.isPlaying = false;
          return;
        }

        // Add to hand
        currentPlayer.hand.push(card);

        // Phase 3.1.2: Timer resolution handles ops. Action phase implies empty stack.
        
        // Handle Exploding/Upgrade logic later (Phase 3). 
        // For Phase 2.4: "If it is a regular card... that card goes into their hand... and their turn is over."
        // We treat ALL cards as regular for now.

        // Advance turn
        currentGame.currentTurnIndex = (currentGame.currentTurnIndex + 1) % currentGame.turnOrder.length;
        const nextPlayerId = currentGame.turnOrder[currentGame.currentTurnIndex];
        const nextPlayer = currentGame.players.find(p => p.id === nextPlayerId);

        if (nextPlayer) {
          this.emitToGame(currentGame.code, SocketEvent.GameMessage, { message: `${currentPlayer.name} drew a card, it's ${nextPlayer.name}'s turn.` });
        }

        this.log(currentGame, `draw animation finished. Turn advanced to ${currentGame.turnOrder[currentGame.currentTurnIndex]}`);
        this.updateGameNonce(currentGame, currentPlayer.name); // Sends updated state (hand, turn, etc)
      } catch (error) {
        this.log(null, `drawCard timer callback error: ${error}`);
      } finally {
        // Always clear the playing flag, even if an error occurred
        // But only if player still exists
        const currentGame = this.games.get(gameCode);
        if (currentGame) {
          const currentPlayer = currentGame.players.find(p => p.id === player.id);
          if (currentPlayer) {
            currentPlayer.isPlaying = false;
          }
        }
      }
    }, 3000);
    } catch (error) {
      // Handle any errors that occur before or during setTimeout setup
      this.log(game, `drawCard error: ${error}`);
      // Clear the playing flag immediately on error
      player.isPlaying = false;
      // Put card back in deck if it was popped
      if (card) {
        game.drawPile.push(card);
      }
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "An error occurred while drawing a card." });
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
    const isMyTurn = game.turnOrder[game.currentTurnIndex] === player.id;
    const isNowCard = !!card.now;

    switch (game.turnPhase) {
      case TurnPhase.Action:
        if (isMyTurn) return { allowed: true };
        if (isNowCard) return { allowed: true };
        return { allowed: false, reason: "It's not your turn!" };

      case TurnPhase.Reaction:
        if (isMyTurn) return { allowed: false, reason: "You must wait for reactions." };
        if (isNowCard) return { allowed: true };
        return { allowed: false, reason: "You can only play 'NOW' cards during a reaction." };

      case TurnPhase.Rereaction:
        if (isNowCard) return { allowed: true };
        return { allowed: false, reason: "You can only play 'NOW' cards during a re-reaction." };

      case TurnPhase.Executing:
        return { allowed: false, reason: "You can't play cards while the previous play is in progress." };

      default:
        return { allowed: false, reason: "BUG: Can't play cards in phase ${game.turnPhase}." };
    }
  }

  private playCard(socket: Socket, gameCode: string, cardId: string, nonce?: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `playCard failed: game ${gameCode} not found`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Error: Game not found." });
      return;
    }

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.log(game, `playCard failed: game has ended`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Game has ended." });
      return;
    }
    
    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to play card in game ${gameCode}`);
      return; // Silently ignore spectator actions
    }
    
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
    
    if (player.isPlaying) {
      this.log(game, `player "${player.name}" tried to play a card while another play is in progress`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Please wait for your current play to complete." });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Revert optimistic update
      return;
    }

    // Validate cardId is a string
    if (cardId.length === 0) {
      this.log(game, `player "${player.name}" tried to play card with no cardId`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Invalid card selection." });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    // Check permissions using Phase 3.1.3 logic
    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) {
      this.log(game, `player "${player.name}" tried to play card they don't have (id: ${cardId})`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "You don't have that card!" });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); 
      return;
    }


    const { allowed, reason } = this.canPlayCard(game, player, cardInHand);

    if (!allowed) {
      this.log(game, `player "${player.name}" tried to play a card (${cardInHand.class}) rejected: ${reason} (phase=${game.turnPhase})`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: reason || "You can't play that card right now!" });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); // Revert optimistic update
      return;
    }

    // Set playing flag to prevent concurrent plays
    player.isPlaying = true;
    
    try {
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) {
        // Should catch above, but strictly safe
        return;
      }

      const [card] = player.hand.splice(cardIndex, 1);
      game.discardPile.push(card);

      // Phase 3.1.1: Push a do-nothing operation
      game.pendingOperations.push({
        cardClass: card.class,
        action: async (_g: Game) => { 
          // Sleep for 3 seconds
          if (this.verbose) {
            this.log(_g, `executing do-nothing operation for card ${card.class} (sleeping 3s)`);
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      });

      this.log(game, `player "${player.name}" played "${card.class}: ${card.name}"`);
      this.emitToGame(game.code, SocketEvent.GameMessage, { message: `${player.name} played ${card.class}.` });

      // Phase 3.1.2: Trigger Timer if NOT Debug card
      if (card.class !== CardClass.Debug) {
        this.startReactionTimer(game, player.id);
      } else {
        // Debug executes immediately? Or just no timer?
        // Doc: "DEBUG cards cannot be NAKed... no reaction allowed."
        // We probably shouldn't even push it to the stack if it executes immediately, 
        // BUT Phase 4 is "card actions". For now, we just don't start the timer.
        // We should explicitly resolve immediately if it's a debug card to keep flow moving?
        // Or wait for next action? 
        // Logic says "If the player plays a card... except for a DEBUG card, a timer is set".
        // It implies DEBUG resolves immediately.
        // Let's call executePlayedCards immediately for DEBUG.
        this.executePlayedCards(game);
      }

      this.updateGameNonce(game, player.name);
    } finally {
      // Always clear the playing flag, even if an error occurred
      player.isPlaying = false;
    }
  }

  private playCombo(socket: Socket, gameCode: string, cardIds: string[], nonce?: string) {
    const game = this.games.get(gameCode);
    if (!game) {
      this.log(null, `playCombo failed: game ${gameCode} not found`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Error: Game not found." });
      return;
    }

    // Check if game has ended
    if (game.state === GameState.Ended) {
      this.log(game, `playCombo failed: game has ended`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Game has ended." });
      return;
    }

    // Reject if caller is a spectator (not a player)
    const isSpectator = game.spectators.some(s => s.socketId === socket.id);
    const player = game.players.find(p => p.socketId === socket.id);
    if (isSpectator || !player) {
      this.log(game, `spectator or non-player ${socket.id} attempted to play combo in game ${gameCode}`);
      return; // Silently ignore spectator actions
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
    if (player.isPlaying) {
      this.log(game, `player "${player.name}" tried to play a combo while another play is in progress`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Please wait for your current play to complete." });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    const isMyTurn = game.turnOrder[game.currentTurnIndex] === player.id;
    if (!isMyTurn) {
      this.log(game, `player "${player.name}" tried to play a combo out of turn`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "It's not your turn!" });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
      return;
    }

    if (game.turnPhase !== TurnPhase.Action) {
       this.log(game, `player "${player.name}" tried to play a combo in wrong phase: ${game.turnPhase}`);
       this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "You can only play combos in your Action phase." });
       this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
       return;
    }

    if (!cardIds || cardIds.length !== 2) {
      this.log(game, `player "${player.name}" tried to play invalid combo length: ${cardIds?.length}`);
      this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Invalid combo selection." });
      this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand }); 
      return;
    }

    // Set playing flag to prevent concurrent plays
    player.isPlaying = true;

    try {
      const cardsToPlay: Card[] = [];
      const indicesToRemove: number[] = [];

      // Find cards in hand
      // We need to handle the case where we look for two indices. 
      // findIndex returns the first match. If we splice one by one, indices shift.
      // Better to find indices first, ensure they are distinct and valid.
      // BUT the incoming IDs are unique (card-1, card-2). So simple find is safe.

      for (const id of cardIds) {
        const idx = player.hand.findIndex(c => c.id === id);
        if (idx === -1) {
          // Card already played or doesn't exist - could be a race condition
          this.log(game, `player "${player.name}" tried to play combo with card they don't have (id: ${id})`);
          this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "You don't have those cards!" });
          this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
          return;
        }
        cardsToPlay.push(player.hand[idx]);
        indicesToRemove.push(idx);
      }

      // Verify they are distinct indices (should be guaranteed by unique IDs if client is behaving, but check)
      if (indicesToRemove[0] === indicesToRemove[1]) {
        // This implies duplicates in cardIds or same ID found twice?
        // Unique IDs should prevent this unless client sent same ID twice.
        this.log(game, `player "${player.name}" tried to play combo with same card twice`);
        this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Invalid combo." });
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }

      // Validate Combo logic: 2 identical DEVELOPER cards
      const c1 = cardsToPlay[0];
      const c2 = cardsToPlay[1];

      if (c1.class !== CardClass.Developer || c2.class !== CardClass.Developer) {
        this.log(game, `player "${player.name}" tried to play invalid combo types: ${c1.class}, ${c2.class}`);
        this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Invalid combo. Must be DEVELOPER cards." });
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }

      if (c1.name !== c2.name) {
        this.log(game, `player "${player.name}" tried to play mismatched developer combo: ${c1.name} vs ${c2.name}`);
        this.emitToSocket(socket.id, SocketEvent.GameMessage, { message: "Invalid combo. Cards must match." });
        this.emitToSocket(socket.id, SocketEvent.HandUpdate, { hand: player.hand });
        return;
      }

      // Remove cards from hand. Sort indices descending to splice safely.
      indicesToRemove.sort((a, b) => b - a);
      for (const idx of indicesToRemove) {
        player.hand.splice(idx, 1);
      }

      // Add to discard pile
      game.discardPile.push(...cardsToPlay);

      // Phase 3.1.1: Push a do-nothing operation
      game.pendingOperations.push({
        cardClass: c1.class,
        action: async (g: Game) => { 
          // Sleep for 3 seconds
          if (this.verbose) {
             this.log(g, `executing do-nothing operation for combo (sleeping 3s)`);
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      });

      this.log(game, `player "${player.name}" played 2x combo "${c1.class}: ${c1.name}"`);
      this.emitToGame(game.code, SocketEvent.GameMessage, { message: `${player.name} played a pair of ${c1.class}.` });

      // Phase 3.1.2: Start Timer
      this.startReactionTimer(game, player.id);

      this.updateGameNonce(game, player?.name);
    } finally {
      // Always clear the playing flag, even if an error occurred
      player.isPlaying = false;
    }
  }

  private handleDisconnect(socket: Socket) {
    const gameCode = this.playerToGameMap.get(socket.id);

    if (!gameCode) {
      this.log(null, `socket ${socket.id} disconnected, not in any game`);
      return;
    }

    const game = this.games.get(gameCode);
    if (!game) {
      // Game doesn't exist, clean up map entry
      this.playerToGameMap.delete(socket.id);
      return;
    }

    // Remove from players
    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
      const player = game.players[playerIndex];
      
      // Idempotency check: If already marked as disconnected, skip to avoid double-processing
      if (player.isDisconnected) {
        this.log(game, `handleDisconnect: player "${player.name}" already marked as disconnected, skipping`);
        return;
      }
      
      this.log(game, `player "${player.name}" (${player.socketId}) disconnected`);

      const oldSocketId = player.socketId;
      player.isDisconnected = true;
      player.socketId = ''; // Clear socketId so this socket can't be reused directly
      this.emitToGame(game.code, SocketEvent.GameMessage, { message: `${player.name} has disconnected, maybe they will be right back?` });

      // If current player disconnected, handle turn progression
      if (game.state === GameState.Started && game.turnOrder[game.currentTurnIndex] === player.id) {
        this.log(game, `current player "${player.name}" has left, advancing turn`);

        // Check for pending Exploding/Upgrade Cluster cards in hand (just drawn)
        // "If the player has just drawn an EXPLODING CLUSTER card, it is re-inserted at a random position..."
        const specialCards = player.hand.filter(c => c.class === CardClass.ExplodingCluster || c.class === CardClass.UpgradeCluster);
        const remainingHand = player.hand.filter(c => c.class !== CardClass.ExplodingCluster && c.class !== CardClass.UpgradeCluster);

        specialCards.forEach(card => {
          const insertIndex = Math.floor(this.prng.random() * (game.drawPile.length + 1));
          game.drawPile.splice(insertIndex, 0, card);
          this.log(game, `re-inserted ${card.name} (${card.class}) at index ${insertIndex} due to disconnect`);
        });

        // Move remaining hand to removedPile
        game.removedPile.push(...remainingHand);
        player.hand = [];

        // "Any pending operations for that player are discarded."
        game.pendingOperations = [];

        // Remove from turnOrder
        const turnIndex = game.turnOrder.indexOf(player.id);
        if (turnIndex !== -1) {
          game.turnOrder.splice(turnIndex, 1);
          // Adjust currentTurnIndex to prevent out-of-bounds access
          if (game.turnOrder.length === 0) {
            // No players left, game should end (handled elsewhere)
            game.currentTurnIndex = 0;
          } else if (turnIndex < game.currentTurnIndex) {
            // Removed player was before current turn, decrement index
            game.currentTurnIndex--;
          } else if (turnIndex === game.currentTurnIndex) {
            // Current player disconnected - next player shifts into this index
            // If we were at the last position, wrap to 0
            if (game.currentTurnIndex >= game.turnOrder.length) {
              game.currentTurnIndex = 0;
            }
          }
          // Ensure index is always valid
          if (game.currentTurnIndex < 0) {
            game.currentTurnIndex = 0;
          }
          if (game.currentTurnIndex >= game.turnOrder.length && game.turnOrder.length > 0) {
            game.currentTurnIndex = game.turnOrder.length - 1;
          }
        }

        // Remove from players list so they cannot rejoin
        // We must use the index we found earlier, but verify it hasn't shifted?
        // No, we haven't mutated players array yet in this function.
        game.players.splice(playerIndex, 1);

        const nextPlayerId = game.turnOrder[game.currentTurnIndex];
        const nextPlayer = game.players.find(p => p.id === nextPlayerId);
        if (nextPlayer) {
          this.emitToGame(game.code, SocketEvent.GameMessage, { 
            message: `${player.name} has abandoned their turn, it's ${nextPlayer.name}'s turn.` 
          });
        }
        // Ensure nonce is updated because game state changed significantly
        this.updateGameNonce(game);
        return; // updateGameNonce emits update, so we can return
      }

      // Check for attrition win (only 1 connected player left)
      const connectedPlayers = game.players.filter(p => !p.isDisconnected && !p.isOut);
      if (game.state === GameState.Started && connectedPlayers.length === 1) {
        const winner = connectedPlayers[0];
        this.log(game, `game won by attrition by ${winner.name} (others disconnected/out)`);
        this.endGame(game.code, { winner: winner.name, reason: 'attrition' });
        return;
      }

      // If game owner leaves the lobby, assign a new game owner IF game is in lobby
      if (game.state === GameState.Lobby && game.gameOwnerId === player.id && game.players.length > 1) {
        // Find all players *other than the disconnecting one* who are currently *connected*
        const potentialNewOwners = game.players.filter(p => p.id !== player.id && !p.isDisconnected);

        if (potentialNewOwners.length > 0) {
          // Assign to the first available connected player
          const newGameOwner = potentialNewOwners[0];
          game.gameOwnerId = newGameOwner.id;
          this.log(game, `game owner "${player.name}" (${oldSocketId}) disconnected. new game owner is "${newGameOwner.name}" (${newGameOwner.socketId})`);
        } else {
          // No other *connected* players to promote. The game will become empty of connected players soon.
          // No new owner is assigned; the game effectively ends (handled by final check below).
          this.log(game, `game owner "${player.name}" (${oldSocketId}) disconnected. no other connected players to promote to game owner. game will end.`);
        }
      }
      // Emit game update, which will trigger nonce change and purging of disconnected players
      // We do NOT check for attrition here to allow grace period for reconnection.
      // Attrition check happens in updateGameNonce (if nonce changes) or explicitly if desired later.
      this.emitGameUpdate(game);
    }

    // --- Spectator Disconnection Logic ---
    const spectatorIndex = game.spectators.findIndex(s => s.socketId === socket.id);
    if (spectatorIndex !== -1) {
      game.spectators.splice(spectatorIndex, 1);
      this.log(game, `spectator (${socket.id}) disconnected`);
      this.emitGameUpdate(game);
    }

    this.playerToGameMap.delete(socket.id); // Remove from map after all processing
  }

  private endGame(gameCode: string, result?: { winner: string, reason: string }) {
    const game = this.games.get(gameCode);
    if (!game) {
      // Game already ended/deleted, idempotent - just return
      return;
    }

    // Idempotency check: If game is already ended, don't process again
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

    this.emitToGame(gameCode, SocketEvent.GameEnded, result);

    // Directly emit to the winner's socket if result and winner are available
    if (result?.winner) {
      const winnerPlayer = game.players.find(p => p.name === result.winner && !p.isDisconnected);
      if (winnerPlayer && winnerPlayer.socketId) {
        this.emitToSocket(winnerPlayer.socketId, SocketEvent.GameEnded, result);
      }
    }

    this.games.delete(gameCode); // Delete game from map after emitting

    this.log(null, `game ${gameCode} purged`);
  }

  // Centralized logging
  private log(game: Game | null, message: string) {
    if (!game || game.devMode) {
      const timestamp = new Date().toISOString();
      const prefix = game ? `[${timestamp}] [game ${game.code}] ` : `[${timestamp}] [server] `;
      console.log(prefix + message);
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
        const isTurn = game.turnOrder[game.currentTurnIndex] === p.id;
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
