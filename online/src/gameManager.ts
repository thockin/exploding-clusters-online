
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
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
    pendingOperations: any[]; // To be defined later
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

            socket.on('showDeck', (gameCode: string) => {
                this.showDeck(socket, gameCode);
            });

            socket.on('reorder-hand', ({ gameCode, newHand }: { gameCode: string; newHand: Card[] }) => {
                this.reorderHand(socket, gameCode, newHand);
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

                    game.players.splice(playerIndex, 1); // Remove from array

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

    private generateGameCode(): string {
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

    private generateNonce(devMode: boolean): string {
        if (devMode) {
            return '0000000000000000'; // Fixed nonce for DEVMODE reproducibility
        }
        return randomBytes(8).toString('hex');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private emitToRoom(room: string, event: string, data?: any) {
        if (this.verbose) {
            this.log(null, `sending event "${event}" to room ${room}: ${JSON.stringify(data)}`);
        }
        this.io.to(room).emit(event, data);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private emitToSocket(socketId: string, event: string, data?: any) {
        if (this.verbose) {
            this.log(null, `sending event "${event}" to socket ${socketId}: ${JSON.stringify(data)}`);
        }
        this.io.to(socketId).emit(event, data);
    }

    private emitGameUpdate(game: Game) {
        // Use inclusive check to catch potential type issues
        const debugCount = game.drawPile.filter(c => c.cardClass.includes('Debug')).length;
        if (game.devMode) {
             this.log(game, `emitting update. debug count: ${debugCount}`);
        }
        
        this.emitToRoom(game.code, 'gameUpdate', {
            gameCode: game.code,
            nonce: game.nonce,
            players: game.players.map(p => ({ id: p.id, name: p.name, cards: p.hand.length, isOut: p.isOut, isDisconnected: p.isDisconnected })),
            state: game.state,
            gameOwnerId: game.gameOwnerId,
            spectators: game.spectators,
            devMode: game.devMode,
            turnOrder: game.turnOrder,
            currentTurnIndex: game.currentTurnIndex,
            drawPileCount: game.drawPile.length,
            discardPile: game.discardPile,
            debugCardsCount: debugCount
        });
    }

    private updateGameNonce(game: Game) {
        // Purge disconnected players whenever nonce changes
        const initialCount = game.players.length;
        game.players = game.players.filter(p => !p.isDisconnected);
        if (game.players.length < initialCount) {
            this.log(game, `purged ${initialCount - game.players.length} disconnected players due to nonce change`);
        }

        // Check for attrition win after purge
        if (game.state === 'started' && game.players.length === 1) {
            const winner = game.players[0];
            this.log(game, `game won by attrition by ${winner.name}`);
            this.endGame(game.code, { winner: winner.name, reason: 'attrition' });
            return; // Stop further updates
        }

        game.nonce = this.generateNonce(game.devMode);
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
            pendingOperations: [],
            gameOwnerId: playerId,
            nonce: this.generateNonce(devMode),
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
            this.log(game, `player "${playerName}" (${socket.id}) attempting to rejoin with nonce=${clientNonce} (server=${game.nonce})`);
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
                this.emitGameUpdate(game); // Rejoining player does not change nonce
                this.emitToSocket(socket.id, 'handUpdate', { hand: existingPlayer.hand });
                return callback({ success: true, gameCode, nonce: game.nonce, playerId: existingPlayer.id });
            }
        } else if (clientNonce && clientNonce !== game.nonce) {
            this.log(game, `player "${playerName}" (${game.players.find(p => p.name.toLowerCase() === playerName.toLowerCase())?.id || 'unknown'}) failed to reconnect due to nonce mismatch`);
            return callback({ success: false, error: 'Cannot rejoin, game state has changed.', nonce: game.nonce });
        }

        if (game.state !== 'lobby') {
            this.log(game, `attempted to join when not in lobby state`);
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
            this.log(game, `attempted to join with duplicate name: "${playerName}" (existing: "${existingPlayerWithSameName.name}" (${existingPlayerWithSameName.socketId}))`);
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
        const explodingClusters = deck.filter(c => c.cardClass === 'Exploding Cluster');
        const upgradeClusters = deck.filter(c => c.cardClass === 'Upgrade Cluster');
        // "The full deck is comprised of... 6 DEBUG cards".
        const debugCards = deck.filter(c => c.cardClass === 'Debug');
        // Remove them all first
        deck = deck.filter(c => c.cardClass !== 'Debug');

        // Give 1 Debug card to each player
        for (const p of game.players) {
            if (debugCards.length > 0) p.hand.push(debugCards.pop()!);
        }

        // Put remaining Debug cards back (max 2 or whatever is left)
        // Design doc says: "Put 2 DEBUG cards back into the deck, or 1 DEBUG card if that is all that is left."
        const debugsToReturn = game.devMode ? debugCards.length : Math.min(debugCards.length, 2);
        // Actually logic says: "Each player gets 1 DEBUG card... Put 2 DEBUG cards back into the deck... Shuffle the deck."
        // Wait, if we have 6 debug cards and 5 players, we use 5. 1 left. We put it back.
        // If we have 6 debug cards and 2 players, we use 2. 4 left. We put 2 back? Or all 4?
        // Design doc: "Put 2 DEBUG cards back into the deck, or 1 DEBUG card if that is all that is left."
        // Implicitly, discard the rest? "The full deck is comprised of... 6 DEBUG cards".
        // If 2 players, 2 used. 4 left. Put 2 back. 2 discarded?
        // Let's follow "Put 2 DEBUG cards back...".
        
        for (let i = 0; i < debugsToReturn; i++) {
             deck.push(debugCards.pop()!);
        }
        
        deck = shuffleDeck(deck, this.prng.random.bind(this.prng));

        // Deal 7 cards to each player
        for (const p of game.players) {
            p.hand.push(...deck.splice(0, 7));
        }

        // Insert Exploding Clusters (players - 1)
        const numExploding = game.players.length - 1;
        for (let i = 0; i < numExploding; i++) {
             if (explodingClusters.length > 0) deck.push(explodingClusters.pop()!);
        }

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

        game.drawPile = shuffleDeck(deck, this.prng.random.bind(this.prng));

        // DEVMODE: Move Exploding Cluster to top
        if (game.devMode) {
            const explodingIndex = game.drawPile.findIndex(c => c.cardClass === 'Exploding Cluster');
            if (explodingIndex > -1) {
                const [explodingCard] = game.drawPile.splice(explodingIndex, 1);
                game.drawPile.unshift(explodingCard);
                this.log(game, `DEVMODE: moved Exploding Cluster to top of deck`);
            }
        }

        // Set turn order randomly
        game.turnOrder = game.players.map(p => p.id);
        for (let i = game.turnOrder.length - 1; i > 0; i--) {
            const j = Math.floor(this.prng.random() * (i + 1));
            [game.turnOrder[i], game.turnOrder[j]] = [game.turnOrder[j], game.turnOrder[i]];
        }
        game.currentTurnIndex = 0;

        this.log(game, `game started!`);
        this.updateGameNonce(game);
        this.emitToRoom(game.code, 'gameStarted');
        callback({ success: true });
    }

    private giveDebugCard(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        const player = game.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const debugCardIndex = game.drawPile.findIndex(c => c.cardClass === 'Debug');
        if (debugCardIndex > -1) {
            const [debugCard] = game.drawPile.splice(debugCardIndex, 1);
            player.hand.push(debugCard);
            this.log(game, `DEVMODE: gave DEBUG card to player "${player.name}" (${player.socketId})`);
            this.updateGameNonce(game); // This triggers gameUpdate and handUpdate
        } else {
            // Optionally create one if none exist?
             this.log(game, `DEVMODE: no DEBUG cards left in deck for player "${player.name}" (${player.socketId})`);
             this.emitGameUpdate(game); // Ensure client knows count is 0
        }
    }

    private showDeck(socket: Socket, gameCode: string) {
        const game = this.games.get(gameCode);
        if (!game || !game.devMode) return;

        // Send the full deck to the requester
        this.emitToSocket(socket.id, 'deckData', { deck: game.drawPile });
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
            this.log(game, `Invalid hand reorder attempt by player "${player.name}" (${player.id}).`);
            // Optionally, send an error back to the client or revert their UI.
            this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Revert client hand
            return;
        }

        player.hand = newHand;
        this.log(game, `Player "${player.name}" (${player.id}) reordered their hand.`);
        this.emitToSocket(socket.id, 'handUpdate', { hand: player.hand }); // Update only the reordering player
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

    public handleInfozRequest(req: any, res: any) {
        const url = req.url.split('?')[0];
        
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

            html += '</body></html>';
            res.end(html);
            return;
        }

        res.writeHead(404);
        res.end();
    }
}
