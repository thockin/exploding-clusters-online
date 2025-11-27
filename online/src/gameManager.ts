
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { Card, fullDeck, shuffleDeck } from './app/game/deck';
import { PseudoRandom } from './utils/PseudoRandom';

// Define interfaces for game and player states
interface Player {
    id: string;
    name: string;
    socketId: string;
    hand: Card[]; 
    isOut: boolean;
    isDisconnected: boolean;
    turnsToTake: number;
}

interface Game {
    code: string;
    players: Player[];
    spectators: { id: string; socketId: string }[];
    state: 'lobby' | 'started' | 'ended';
    turnOrder: string[]; // Array of player IDs
    currentTurnIndex: number;
    drawPile: Card[]; 
    discardPile: Card[]; 
    removedPile: Card[]; // New: cards removed from the game
    pendingOperations: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    gameOwnerId: string;
    nonce: string; // For reconnection logic
    timer: NodeJS.Timeout | null;
    devMode: boolean;
}

// GameManager handles game state and socket events
export class GameManager {
    private games: Map<string, Game> = new Map();
    private playerToGameMap: Map<string, string> = new Map(); // socketId -> gameCode
    private verbose: boolean = process.env.VERBOSE === '1';
    private prng: PseudoRandom;

    constructor(private io: Server) {
        const devMode = process.env.DEVMODE === '1';
        this.prng = new PseudoRandom(devMode ? 0 : undefined);

        // Setup Socket.IO event listeners
        this.io.on('connection', (socket: Socket) => {
            // console.log(`Socket connected: ${socket.id}`); // Use this.log inside handlers or just here if we can access this.log?
            // We can access this.log since we are in constructor closure/class.
            // But this.log is private. arrow function inside constructor captures 'this'.
            // Wait, verboseLogging check is inside log().
            // For raw socket connection, we don't have a game, so game=null.
            // And verboseLogging defaults to what? false?
            // game.devMode is used. if game is null, it checks... nothing?
            // The log function: if (!game || game.devMode)
            // So if game is null, it ALWAYS logs.
            // This is fine for server events.
            this.log(null, `socket connected: ${socket.id}`);

            if (this.verbose) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                socket.onAny((eventName: string, ...args: any[]) => {
                    this.log(null, `received event "${eventName}" from ${socket.id}: ${JSON.stringify(args)}`);
                });
            }

            socket.on('createGame', (playerName: string, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => void) => {
                this.createGame(socket, playerName, callback);
            });

            socket.on('joinGame', (gameCode: string, playerName: string, nonce: string | undefined, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string; }) => void) => {
                this.joinGame(socket, gameCode, playerName, nonce, callback);
            });

            socket.on('watchGame', (gameCode: string, callback: (response: { success: boolean; gameCode?: string; error?: string }) => void) => {
                this.watchGame(socket, gameCode, callback);
            });

            socket.on('startGame', (gameCode: string, callback: (response: { success: boolean; error?: string }) => void) => {
                this.startGame(socket, gameCode, callback);
            });

            socket.on('giveDebugCard', (gameCode: string) => {
                this.giveDebugCard(socket, gameCode);
            });

            socket.on('devDrawCard', (gameCode: string) => {
                this.devDrawCard(socket, gameCode);
            });

            socket.on('showDeck', (gameCode: string) => {
                this.showDeck(socket, gameCode);
            });

            socket.on('showRemovedPile', (gameCode: string) => {
                this.showRemovedPile(socket, gameCode);
            });

            socket.on('reorder-hand', ({ gameCode, newHand }: { gameCode: string; newHand: Card[] }) => {
                this.reorderHand(socket, gameCode, newHand);
            });

            socket.on('play-card', (data: { gameCode: string; cardId: string }) => {
                this.playCard(socket, data.gameCode, data.cardId);
            });

            socket.on('playCombo', (data: { gameCode: string; cardIds: string[] }) => {
                this.playCombo(socket, data.gameCode, data.cardIds);
            });

            socket.on('drawCard', (gameCode: string) => {
                this.drawCard(socket, gameCode);
            });

            // Handle voluntary leave
            socket.on('leaveGame', (gameCode: string) => {
                const game = this.games.get(gameCode);
                if (!game) return;

                this.log(game, `player ${socket.id} voluntarily left the game`);

                let playerRemoved = false;
                // Remove player completely
                const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
                if (playerIndex !== -1) {
                    playerRemoved = true;
                    const player = game.players[playerIndex];
                    
                    // If game started, remove from turnOrder
                    if (game.state === 'started') {
                        const turnIndex = game.turnOrder.indexOf(player.id);
                        if (turnIndex !== -1) {
                            game.turnOrder.splice(turnIndex, 1);
                            // If we removed a player before the current turn, or the current player, adjust index
                            if (turnIndex < game.currentTurnIndex) {
                                game.currentTurnIndex--;
                            } else if (turnIndex === game.currentTurnIndex) {
                                // Current player left. 
                                // If index is now out of bounds (last player left), wrap or handle?
                                // Ideally we should advance turn, but simply clamping or letting it point to next is basic fix.
                                if (game.currentTurnIndex >= game.turnOrder.length) {
                                    game.currentTurnIndex = 0;
                                }
                                // TODO: Trigger turn advancement logic properly?
                            }
                        }
                    }

                    // Move player's hand to removedPile
                    game.removedPile.push(...player.hand);
                    player.hand = []; // Clear hand

                    game.players.splice(playerIndex, 1); // Remove from array
                    this.emitToRoom(game.code, 'gameMessage', { message: `${player.name} has left the game, what a chicken!` });

                    // Handle owner migration if needed
                    if (game.state === 'lobby' && game.gameOwnerId === player.id) {
                        if (game.players.length > 0) {
                            const connectedPlayers = game.players.filter(p => !p.isDisconnected);
                             // Prefer connected players, otherwise take any
                            const newGameOwner = connectedPlayers.length > 0 ? connectedPlayers[0] : game.players[0];
                            game.gameOwnerId = newGameOwner.id;
                            this.log(game, `game owner "${player.name}" left. new game owner is "${newGameOwner.name}"`);
                        }
                    }
                }

                // Remove from spectators
                const spectatorIndex = game.spectators.findIndex(s => s.socketId === socket.id);
                if (spectatorIndex !== -1) {
                     game.spectators.splice(spectatorIndex, 1);
                }

                // If empty, end game
                if (game.players.length === 0 && game.spectators.length === 0) {
                    this.log(game, `game is empty after voluntary leave, purging`);
                    this.endGame(gameCode);
                } else if (game.state === 'started' && game.players.length < 2) {
                    if (game.players.length === 1) {
                        const winner = game.players[0];
                        this.log(game, `game ended due to insufficient players after voluntary leave. winner: ${winner.name}`);
                        this.endGame(gameCode, { winner: winner.name, reason: 'attrition' });
                    } else {
                        this.log(game, `game ended due to insufficient players after voluntary leave`);
                        this.endGame(gameCode);
                    }
                } else {
                    if (playerRemoved) {
                        this.updateGameNonce(game); // Triggers update for everyone else
                    } else {
                        this.emitGameUpdate(game); // Just update list (spectator left)
                    }
                }
                
                this.playerToGameMap.delete(socket.id);
                // Socket will disconnect naturally or we can force it?
                // Client disconnects itself usually.
            });

            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }

    private firstGameCreated = false;

    private generateGameCode(): string {
        // In DEVMODE, the first game code is always XXXXX
        if (process.env.DEVMODE === '1' && !this.firstGameCreated) {
            this.firstGameCreated = true;
            return 'XXXXX';
        }

        const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ'; // No vowels, uppercase
        let code = '';
        let unique = false;
        while (!unique) {
            code = Array.from({ length: 5 }, () => alphabet[Math.floor(this.prng.random() * alphabet.length)]).join('');
            // TODO: Implement swear word check
            if (!this.games.has(code)) {
                unique = true;
            }
        }
        return code;
    }

    private generateNonce(): string {
        return randomBytes(8).toString('hex');
    }

    private emitToRoom(room: string, event: string, data?: unknown) {
        if (this.verbose) {
            this.log(null, `sending event "${event}" to room ${room}: ${JSON.stringify(data as string)}`);
        }
        this.io.to(room).emit(event, data);
    }

    private emitToSocket(socketId: string, event: string, data?: unknown) {
        if (this.verbose) {
            this.log(null, `sending event "${event}" to socket ${socketId}: ${JSON.stringify(data as string)}`);
        }
        this.io.to(socketId).emit(event, data);
    }

    private emitGameUpdate(game: Game) {
        // Use inclusive check to catch potential type issues
        const debugCount = game.drawPile.filter(c => c.cardClass.includes('DEBUG')).length;
        const safeCardsCount = game.drawPile.filter(c => c.cardClass !== 'EXPLODING CLUSTER' && c.cardClass !== 'UPGRADE CLUSTER').length;
     
        this.emitToRoom(game.code, 'gameUpdate', {
            gameCode: game.code,
            nonce: game.nonce,
            // Filter out disconnected players for the client view
            players: game.players
                .filter(p => !p.isDisconnected)
                .map(p => ({ id: p.id, name: p.name, cards: p.hand.length, isOut: p.isOut, isDisconnected: p.isDisconnected })),
            state: game.state,
            gameOwnerId: game.gameOwnerId,
            spectators: game.spectators,
            devMode: game.devMode,
            turnOrder: game.turnOrder,
            currentTurnIndex: game.currentTurnIndex,
            drawPileCount: game.drawPile.length,
            discardPile: game.discardPile,
            removedPileCount: game.removedPile.length, // New: include removed pile count
            debugCardsCount: debugCount,
            safeCardsCount: safeCardsCount
        });
    }

    private updateGameNonce(game: Game) {
        // Purge disconnected players whenever nonce changes
        const initialPlayers = game.players; // Keep a reference to original players
        game.players = game.players.filter(p => {
            if (p.isDisconnected) {
                game.removedPile.push(...p.hand);
                p.hand = []; // Clear hand
                this.log(game, `purged disconnected player "${p.name}" (${p.id}). moved hand to removedPile`);
                return false; // Exclude disconnected player
            }
            return true; // Keep connected player
        });
        if (game.players.length < initialPlayers.length) {
            this.log(game, `purged ${initialPlayers.length - game.players.length} disconnected players due to nonce change`);
        }

        // Check for attrition win after purge
        if (game.state === 'started' && game.players.length === 1) {
            const winner = game.players[0];
            this.log(game, `game won by attrition by ${winner.name}`);
            this.endGame(game.code, { winner: winner.name, reason: 'attrition' });
            return; // Stop further updates
        }

        game.nonce = this.generateNonce();
        // Notify all clients in the game about the nonce change
        this.emitGameUpdate(game);

        // Send individual hand updates
        for (const player of game.players) {
            if (player.socketId) {
                this.emitToSocket(player.socketId, 'handUpdate', { hand: player.hand });
            }
        }

        if (game.devMode) {
            this.log(game, `nonce updated to: ${game.nonce}`);
        }
    }

    private createGame(socket: Socket, playerName: string, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => void) {
        const gameCode = this.generateGameCode();
        const playerId = uuidv4();
        const player: Player = { id: playerId, name: playerName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, turnsToTake: 0 };
        const devMode = process.env.DEVMODE === '1';

        const newGame: Game = {
            code: gameCode,
            players: [player],
            spectators: [],
            state: 'lobby',
            turnOrder: [],
            currentTurnIndex: -1,
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

        this.log(newGame, `game created by player "${playerName}" (${socket.id})`);
        this.updateGameNonce(newGame);
        callback({ success: true, gameCode, playerId });
    }

    private joinGame(socket: Socket, gameCode: string, playerName: string, clientNonce: string | undefined, callback: (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string; }) => void) {
        const game = this.games.get(gameCode);

        if (!game) {
            this.log(null, `Attempted to join non-existent game: ${gameCode}`);
            return callback({ success: false, error: `Game ${gameCode} does not exist` });
        }

        if (game.devMode && clientNonce) {
            this.log(game, `player "${playerName}" (${socket.id}) attempting to rejoin with nonce ${clientNonce}`);
        }
        // Reconnection logic
        if (clientNonce && clientNonce === game.nonce) {
            // Find player by NAME since socket ID changes on reconnect
            const existingPlayer = game.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
            if (existingPlayer) {
                existingPlayer.socketId = socket.id;
                existingPlayer.isDisconnected = false; // Player is reconnected
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
                
                this.log(game, `player "${playerName}" (${existingPlayer.socketId}) rejoined the game`);
                this.emitToRoom(game.code, 'gameMessage', { message: `${playerName} has rejoined the game, hoorah!` });
                this.emitGameUpdate(game); // Rejoining player does not change nonce
                this.emitToSocket(socket.id, 'handUpdate', { hand: existingPlayer.hand });
                return callback({ success: true, gameCode, nonce: game.nonce, playerId: existingPlayer.id });
            }
        } else if (clientNonce && clientNonce !== game.nonce) {
            this.log(game, `player "${playerName}" (${socket.id}) failed to rejoin due to nonce mismatch`);
            return callback({ success: false, error: 'Cannot rejoin, game state has changed.', nonce: game.nonce });
        }

        if (game.state !== 'lobby') {
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
        const existingPlayerWithSameName = connectedPlayers.find(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (existingPlayerWithSameName) {
            this.log(game, `attempted to join with duplicate name: "${playerName}", exists as ${existingPlayerWithSameName.socketId}`);
            return callback({ success: false, error: 'That name is already taken in this game. Please choose a different name.' });
        }

        const playerId = uuidv4(); // Generate a new ID for a new player
        const player: Player = { id: playerId, name: playerName, socketId: socket.id, hand: [], isOut: false, isDisconnected: false, turnsToTake: 0 };
        game.players.push(player);
        this.playerToGameMap.set(socket.id, gameCode);
        socket.join(gameCode);

        this.log(game, `player "${playerName}" (${socket.id}) joined the game`);
        this.updateGameNonce(game);
        // Notify all players in the game about the new player
        this.emitToRoom(game.code, 'playerJoined', { playerId: player.id, playerName: player.name });
        callback({ success: true, gameCode, nonce: game.nonce, playerId: player.id });
    }

    private watchGame(socket: Socket, gameCode: string, callback: (response: { success: boolean; gameCode?: string; error?: string }) => void) {
        const game = this.games.get(gameCode);

        if (!game) {
            this.log(null, `attempted to watch non-existent game: ${gameCode}`);
            return callback({ success: false, error: `Game ${gameCode} does not exist` });
        }

        game.spectators.push({ id: uuidv4(), socketId: socket.id });
        this.playerToGameMap.set(socket.id, gameCode); // Use playerToGameMap for spectators too for easy disconnect handling
        socket.join(gameCode);

        this.log(game, `spectator ${socket.id} joined the game`);
        this.emitGameUpdate(game); // Notify clients without changing nonce
        callback({ success: true, gameCode });
    }

    private startGame(socket: Socket, gameCode: string, callback: (response: { success: boolean; error?: string }) => void) {
        const game = this.games.get(gameCode);

        if (!game) {
            this.log(null, `attempted to start non-existent game: ${gameCode}`);
            return callback({ success: false, error: `Game ${gameCode} does not exist` });
        }

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player || player.id !== game.gameOwnerId) {
            this.log(game, `non-game owner tried to start the game. player: ${player?.name || socket.id}`);
            return callback({ success: false, error: 'Only the game owner can start the game.' });
        }

        if (game.players.length < 2) {
            this.log(game, `game owner tried to start game with too few players`);
            return callback({ success: false, error: 'Cannot start game with less than 2 players.' });
        }

        game.state = 'started';

        // Initialize deck
        let deck = [...fullDeck];
        const explodingClusters = deck.filter(c => c.cardClass === 'EXPLODING CLUSTER');
        const upgradeClusters = deck.filter(c => c.cardClass === 'UPGRADE CLUSTER');
        // "The full deck is comprised of... 6 DEBUG cards".
        const debugCards = deck.filter(c => c.cardClass === 'DEBUG');
        // Remove them all first
        deck = deck.filter(c => c.cardClass !== 'DEBUG' && c.cardClass !== 'EXPLODING CLUSTER' && c.cardClass !== 'UPGRADE CLUSTER');

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
            const explodingIndex = game.drawPile.findIndex(c => c.cardClass === 'EXPLODING CLUSTER');
            if (explodingIndex > -1) {
                const [explodingCard] = game.drawPile.splice(explodingIndex, 1);
                game.drawPile.push(explodingCard); // Push to end (which is the top for pop())
                this.log(game, `DEVMODE: moved EXPLODING CLUSTER to top of deck`);
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
        this.emitToRoom(game.code, 'gameStarted');
        callback({ success: true });
    }

    private dealDevModeHands(game: Game, deck: Card[]) {
        // P1: 2 identical DEVELOPER, 1 other DEVELOPER, 2 NAK, 1 SHUFFLE, 1 FAVOR
        // P2: 2 NAK, 1 SHUFFLE NOW, 1 ATTACK, 1 SEE FUTURE, 2 DEVELOPER (one identical to P1's pair, one not)
        
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
        const devCardA = deck.find(c => c.cardClass === 'DEVELOPER');
        if (!devCardA) return; // Should not happen
        const nameA = devCardA.name;

        // Pick Type B (different from A)
        const devCardB = deck.find(c => c.cardClass === 'DEVELOPER' && c.name !== nameA);
        if (!devCardB) return;
        const nameB = devCardB.name;

        // Pick Type C (different from A and B, or just different from A? "one not [identical to P1's pair]")
        // P2 needs 2 DEVELOPER cards: one identical to P1's pair (A), one not.
        // "one not" could be B or C. Let's pick C to be safe/diverse.
        const devCardC = deck.find(c => c.cardClass === 'DEVELOPER' && c.name !== nameA && c.name !== nameB);
        if (!devCardC) return; // Should not happen
        // If we are unlucky and only A and B are left (unlikely with 28 cards), we can use B.
        const nameC = devCardC ? devCardC.name : nameB; 

        const p1 = game.players[0];
        const p2 = game.players.length > 1 ? game.players[1] : null;

        // P1 Hand
        p1.hand.push(...findAndRemove(c => c.cardClass === 'DEVELOPER' && c.name === nameA, 2));
        p1.hand.push(...findAndRemove(c => c.cardClass === 'DEVELOPER' && c.name === nameB, 1));
        p1.hand.push(...findAndRemove(c => c.cardClass === 'NAK', 2));
        p1.hand.push(...findAndRemove(c => c.cardClass === 'SHUFFLE', 1));
        p1.hand.push(...findAndRemove(c => c.cardClass === 'FAVOR', 1));

        if (p2) {
            // P2 Hand (1 NAK, 1 SKIP, 1 SHUFFLE NOW, 1 ATTACK, 1 SEE FUTURE, 2 DEVELOPER) = 7 cards
            p2.hand.push(...findAndRemove(c => c.cardClass === 'NAK', 1));
            p2.hand.push(...findAndRemove(c => c.cardClass === 'SKIP', 1));
            p2.hand.push(...findAndRemove(c => c.cardClass === 'SHUFFLE NOW', 1));
            p2.hand.push(...findAndRemove(c => c.cardClass === 'ATTACK', 1));
            p2.hand.push(...findAndRemove(c => c.cardClass === 'SEE THE FUTURE', 1));
            p2.hand.push(...findAndRemove(c => c.cardClass === 'DEVELOPER' && c.name === nameB, 1)); // Matches P1's solo DEVELOPER
            p2.hand.push(...findAndRemove(c => c.cardClass === 'DEVELOPER' && c.name === nameC, 1)); // Different DEVELOPER
        }
    }

    private giveDebugCard(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const debugCardIndex = game.drawPile.findIndex(c => c.cardClass === 'DEBUG');
        if (debugCardIndex > -1) {
            const [debugCard] = game.drawPile.splice(debugCardIndex, 1);
            player.hand.push(debugCard);
            this.log(game, `DEVMODE: gave a DEBUG card to player "${player.name}" (${player.socketId})`);
            this.updateGameNonce(game); // This triggers gameUpdate and handUpdate
        } else {
            // Optionally create one if none exist?
             this.log(game, `DEVMODE: no DEBUG cards left in deck for player "${player.name}" (${player.socketId})`);
             this.emitGameUpdate(game); // Ensure client knows count is 0
        }
    }

    private devDrawCard(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const cardIndex = game.drawPile.findIndex(c => c.cardClass !== 'EXPLODING CLUSTER' && c.cardClass !== 'UPGRADE CLUSTER');
        if (cardIndex > -1) {
            const [card] = game.drawPile.splice(cardIndex, 1);
            player.hand.push(card);
            this.log(game, `DEVMODE: gave a safe card "${card.name}" to player "${player.name}" (${player.socketId})`);
            this.updateGameNonce(game);
        } else {
             this.log(game, `DEVMODE: no safe cards left in deck for player "${player.name}" (${player.socketId})`);
             this.emitGameUpdate(game);
        }
    }

    private showDeck(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        // Send the full deck to the requester, reversed so top is first
        this.emitToSocket(socket.id, 'deckData', { deck: [...game.drawPile].reverse() });
    }

    private showRemovedPile(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        // Send the removed pile to the requester
        this.emitToSocket(socket.id, 'removedData', { removedPile: game.removedPile });
    }

    private drawCard(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game) return;

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) return;

        // Validation
        if (game.state !== 'started') {
             this.emitToSocket(socket.id, 'gameMessage', { message: "Game not started." });
             return;
        }

        if (game.turnOrder[game.currentTurnIndex] !== player.id) {
             this.emitToSocket(socket.id, 'gameMessage', { message: "It's not your turn!" });
             return;
        }
        
        // Check if game is paused (e.g. another draw in progress)
        if (game.timer) {
             return; // Ignore if timer active
        }

        if (game.drawPile.length === 0) {
             this.log(game, `draw pile empty, cannot draw`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "The deck is empty!" });
             return;
        }

        const card = game.drawPile.pop()!;
        this.log(game, `player "${player.name}" is drawing a card. Card is ${card.cardClass} (${card.name})`);

        // Start animation phase
        // Current player sees the card
        this.emitToSocket(socket.id, 'draw-animation-start', { 
            drawingPlayerId: player.id,
            card: card, // They see the card
            duration: 3000 
        });

        // Others see "someone drew" (no card info)
        for (const p of game.players) {
            if (p.id !== player.id && p.socketId) {
                this.emitToSocket(p.socketId, 'draw-animation-start', {
                    drawingPlayerId: player.id,
                    duration: 3000
                });
            }
        }
        // Spectators
        for (const s of game.spectators) {
             this.emitToSocket(s.socketId, 'draw-animation-start', {
                drawingPlayerId: player.id,
                duration: 3000
            });
        }

        // Notify "X drew a card" is now inside setTimeout to include next player's turn.

        // Set timer to finalize
        game.timer = setTimeout(() => {
            game.timer = null;
            
            // Add to hand
            player.hand.push(card);
            
            // Handle Exploding/Upgrade logic later (Phase 3). 
            // For Phase 2.4: "If it is a regular card... that card goes into their hand... and their turn is over."
            // We treat ALL cards as regular for now.

            // Advance turn
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
            const nextPlayerId = game.turnOrder[game.currentTurnIndex];
            const nextPlayer = game.players.find(p => p.id === nextPlayerId);

            if (nextPlayer) {
                this.emitToRoom(game.code, 'gameMessage', { message: `${player.name} drew a card, it's ${nextPlayer.name}'s turn` });
            }

            this.log(game, `draw animation finished. Turn advanced to ${game.turnOrder[game.currentTurnIndex]}`);
            this.updateGameNonce(game); // Sends updated state (hand, turn, etc)

        }, 3000);
    }

    private reorderHand(socket: Socket, gameCode: string, newHand: Card[]) {
        const game = this.games.get(gameCode);
        if (!game) {
            this.log(null, `Attempted to reorder hand for non-existent game: ${gameCode}`);
            return;
        }

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) {
            this.log(game, `Player ${socket.id} not found in game ${gameCode} for hand reorder.`);
            return;
        }

        // Basic validation: ensure the newHand contains the same cards, just reordered.
        // More robust validation might compare card IDs or content.
        if (player.hand.length !== newHand.length ||
            !player.hand.every(card => newHand.some(newCard => newCard.id === card.id))) {
            this.log(game, `Invalid hand reorder attempt by player "${player.name}" (${player.socketId}).`);
            // Optionally, send an error back to the client or revert their UI.
            this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Revert client hand
            return;
        }

        player.hand = newHand;
        if (this.verbose) {
            this.log(game, `Player "${player.name}" (${player.socketId}) reordered their hand.`);
        }
        this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Update only the reordering player
    }

    private playCard(socket: Socket, gameCode: string, cardId: string) {
        const game = this.games.get(gameCode);
        if (!game) {
            this.log(null, `playCard failed: game ${gameCode} not found`);
            this.emitToSocket(socket.id, 'gameMessage', { message: "Error: Game not found." });
            return;
        }

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) {
            this.log(game, `playCard failed: player not found for socket ${socket.id}`);
            this.emitToSocket(socket.id, 'gameMessage', { message: "Error: Player not found." });
            return;
        }

        // Basic validation: check if it's player's turn (ignoring "now" cards for basic implementation)
        const isMyTurn = game.turnOrder[game.currentTurnIndex] === player.id;
        
        // TODO: Allow "now" cards (NAK, SHUFFLE NOW) to be played out of turn
        
        if (!isMyTurn) {
             this.log(game, `player "${player.name}" tried to play card out of turn`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "It's not your turn!" });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Revert optimistic update
             return;
        }

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) {
             this.log(game, `player "${player.name}" tried to play card they don't have`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "You don't have that card!" });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Revert optimistic update
             return;
        }

        const [card] = player.hand.splice(cardIndex, 1);
        game.discardPile.push(card);
        this.log(game, `player "${player.name}" played ${card.name} (${card.cardClass})`);
        this.emitToRoom(game.code, 'gameMessage', { message: `${player.name} played ${card.cardClass}.` });
        
        this.updateGameNonce(game);
    }

    private playCombo(socket: Socket, gameCode: string, cardIds: string[]) {
        const game = this.games.get(gameCode);
        if (!game) {
            this.log(null, `playCombo failed: game ${gameCode} not found`);
            this.emitToSocket(socket.id, 'gameMessage', { message: "Error: Game not found." });
            return;
        }

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) {
            this.log(game, `playCombo failed: player not found for socket ${socket.id}`);
            this.emitToSocket(socket.id, 'gameMessage', { message: "Error: Player not found." });
            return;
        }

        if (!cardIds || cardIds.length !== 2) {
             this.log(game, `player "${player.name}" tried to play invalid combo length: ${cardIds?.length}`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "Invalid combo selection." });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); 
             return;
        }

        const isMyTurn = game.turnOrder[game.currentTurnIndex] === player.id;
        if (!isMyTurn) {
             this.log(game, `player "${player.name}" tried to play combo out of turn`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "It's not your turn!" });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand });
             return;
        }

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
                this.log(game, `player "${player.name}" tried to play combo with card they don't have (id: ${id})`);
                this.emitToSocket(socket.id, 'gameMessage', { message: "You don't have those cards!" });
                this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand });
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
             this.emitToSocket(socket.id, 'gameMessage', { message: "Invalid combo." });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand });
             return;
        }

        // Validate Combo logic: 2 identical DEVELOPER cards
        const c1 = cardsToPlay[0];
        const c2 = cardsToPlay[1];

        if (c1.cardClass !== 'DEVELOPER' || c2.cardClass !== 'DEVELOPER') {
             this.log(game, `player "${player.name}" tried to play invalid combo types: ${c1.cardClass}, ${c2.cardClass}`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "Invalid combo. Must be DEVELOPER cards." });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand });
             return;
        }

        if (c1.name !== c2.name) {
             this.log(game, `player "${player.name}" tried to play mismatched developer combo: ${c1.name} vs ${c2.name}`);
             this.emitToSocket(socket.id, 'gameMessage', { message: "Invalid combo. Cards must match." });
             this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand });
             return;
        }

        // Remove cards from hand. Sort indices descending to splice safely.
        indicesToRemove.sort((a, b) => b - a);
        for (const idx of indicesToRemove) {
            player.hand.splice(idx, 1);
        }

        // Add to discard pile
        game.discardPile.push(...cardsToPlay);
        
        this.log(game, `player "${player.name}" played combo: 2x ${c1.name} (${c1.cardClass})`);
        this.emitToRoom(game.code, 'gameMessage', { message: `${player.name} played a pair of ${c1.cardClass}.` });
        
        // TODO: Trigger special action (Steal a card) - Phase 4
        
        this.updateGameNonce(game);
    }

    private handleDisconnect(socket: Socket) {
        const gameCode = this.playerToGameMap.get(socket.id);

        if (!gameCode) {
            this.log(null, `Socket ${socket.id} disconnected, not in any game`);
            return;
        }

        const game = this.games.get(gameCode);
        if (!game) {
            console.error(`Game ${gameCode} not found for disconnected socket ${socket.id}`);
            return;
        }

        // Remove from players
        const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex !== -1) {
            const player = game.players[playerIndex];
            this.log(game, `player "${player.name}" (${player.socketId}) disconnected`);

            const oldSocketId = player.socketId;
            player.isDisconnected = true;
            player.socketId = ''; // Clear socketId so this socket can't be reused directly
            this.emitToRoom(game.code, 'gameMessage', { message: `${player.name} has disconnected, maybe they will be right back?` });

            // If current player disconnected, handle turn progression
            if (game.state === 'started' && game.turnOrder[game.currentTurnIndex] === player.id) {
                this.log(game, `current player "${player.name}" has left, advancing turn`);
                
                // Check for pending Exploding/Upgrade Cluster cards in hand (just drawn)
                // "If the player has just drawn an EXPLODING CLUSTER card, it is re-inserted at a random position..."
                const specialCards = player.hand.filter(c => c.cardClass === 'EXPLODING CLUSTER' || c.cardClass === 'UPGRADE CLUSTER');
                const remainingHand = player.hand.filter(c => c.cardClass !== 'EXPLODING CLUSTER' && c.cardClass !== 'UPGRADE CLUSTER');

                specialCards.forEach(card => {
                    const insertIndex = Math.floor(this.prng.random() * (game.drawPile.length + 1));
                    game.drawPile.splice(insertIndex, 0, card);
                    this.log(game, `re-inserted ${card.name} (${card.cardClass}) at index ${insertIndex} due to disconnect`);
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
                    // If we removed the current player, the next player shifts into this index.
                    // Unless it was the last player, then wrap to 0.
                    if (game.currentTurnIndex >= game.turnOrder.length) {
                        game.currentTurnIndex = 0;
                    }
                }

                // Remove from players list so they cannot rejoin
                // We must use the index we found earlier, but verify it hasn't shifted?
                // No, we haven't mutated players array yet in this function.
                game.players.splice(playerIndex, 1);
                
                const nextPlayerId = game.turnOrder[game.currentTurnIndex];
                const nextPlayer = game.players.find(p => p.id === nextPlayerId);
                if (nextPlayer) {
                    this.emitToRoom(game.code, 'gameMessage', { 
                        message: `${player.name} has abandoned their turn, it's ${nextPlayer.name}'s turn.` 
                    });
                }
                // Ensure nonce is updated because game state changed significantly
                this.updateGameNonce(game);
                return; // updateGameNonce emits update, so we can return
            }

            // Check for attrition win (only 1 connected player left)
            const connectedPlayers = game.players.filter(p => !p.isDisconnected && !p.isOut);
            if (game.state === 'started' && connectedPlayers.length === 1) {
                 const winner = connectedPlayers[0];
                 this.log(game, `game won by attrition by ${winner.name} (others disconnected/out)`);
                 this.endGame(game.code, { winner: winner.name, reason: 'attrition' });
                 return;
            }

            // If game owner leaves the lobby, assign a new game owner IF game is in lobby
            if (game.state === 'lobby' && game.gameOwnerId === player.id && game.players.length > 1) {
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
        if (game) {
            if (game.timer) {
                clearTimeout(game.timer);
            }
            this.emitToRoom(gameCode, 'gameEnded', result);

            // Directly emit to the winner's socket if result and winner are available
            if (result?.winner) {
                const winnerPlayer = game.players.find(p => p.name === result.winner && !p.isDisconnected);
                if (winnerPlayer && winnerPlayer.socketId) {
                    this.emitToSocket(winnerPlayer.socketId, 'gameEnded', result);
                }
            }

            this.games.delete(gameCode); // Delete game from map after emitting

            this.log(null, `game ${gameCode} purged`);
        }
    }

    // Centralized logging
    private log(game: Game | null, message: string) {
        if (!game || game.devMode) {
            const timestamp = new Date().toISOString();
            const prefix = game ? `[${timestamp}] [game ${game.code}] ` : `[${timestamp}] [server] `;
            console.log(prefix + message);
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
                html += `<li>${p.name} ${isTurn ? '<strong>(TURN)</strong>' : ''} - Hand: ${p.hand.map(c => c.cardClass).join(', ')}</li>`;
            });
            html += '</ul>';

            html += `<h3>Draw Pile (${game.drawPile.length})</h3>`;
            html += `<textarea rows="10" cols="80" readonly>${game.drawPile.map(c => c.cardClass).join('\n')}</textarea>`;

            html += `<h3>Discard Pile (${game.discardPile.length})</h3>`;
             html += `<textarea rows="10" cols="80" readonly>${game.discardPile.map(c => c.cardClass).join('\n')}</textarea>`;

            html += `<h3>Removed Pile (${game.removedPile.length})</h3>`;
             html += `<textarea rows="10" cols="80" readonly>${game.removedPile.map(c => c.cardClass).join('\n')}</textarea>`;

            html += '</body></html>';
            res.end(html);
            return;
        }

        res.writeHead(404);
        res.end();
    }
}
