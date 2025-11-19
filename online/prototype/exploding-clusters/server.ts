import { createServer } from 'http';
import { parse } from 'url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const next = require('next');
import { Server, Socket } from 'socket.io';
import { Card, fullDeck, shuffleDeck } from './src/app/game/deck';

interface Player {
  id: string;
  name: string;
  hand: Card[];
  isExploded: boolean;
}

interface Game {
  players: Player[];
  gameLog: string[];
  creatorId: string;
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;
  debuggingPlayerId: string | null;
  pendingOperations: { card: Card; playerId: string }[];
  reactionTimerEndTime: number | null;
  dbg: boolean;
}

const games = new Map<string, Game>();

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer);

  const broadcastGameState = (gameCode: string) => {
    const game = games.get(gameCode);
    if (!game) return;

    console.log(`[${gameCode}] Broadcasting game state...`);
    for (const player of game.players) {
      const gameStateForPlayer = {
        ...game,
        drawPile: game.drawPile.length, // only send card count
        players: game.players.map(p => ({ ...p, hand: p.id === player.id ? p.hand : p.hand.length })),
      };
      io.to(player.id).emit('game-state', gameStateForPlayer);
    }
    console.log(`[${gameCode}] Game state broadcasted.`);
  };

  const checkWinCondition = (game: Game, gameCode: string) => {
    const activePlayers = game.players.filter(p => !p.isExploded);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      console.log(`[${gameCode}] Game over. Winner is ${winner.name}`);
      io.to(gameCode).emit('game-over', { winnerName: winner.name });
    }
  };

  const advanceTurn = (game: Game) => {
    if (game.players.filter(p => !p.isExploded).length <= 1) return;
    let nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    while (game.players[nextPlayerIndex].isExploded) {
      nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
    }
    console.log(`[${game.players[0] && game.players[0].name}'s game] Advancing turn from ${game.players[game.currentPlayerIndex]?.name} to ${game.players[nextPlayerIndex]?.name}`);
    game.currentPlayerIndex = nextPlayerIndex;
  };

  const processPendingOperations = (gameCode: string) => {
    const game = games.get(gameCode);
    if (!game || game.reactionTimerEndTime === null || Date.now() < game.reactionTimerEndTime) {
      return;
    }

    console.log(`[${gameCode}] Processing pending operations...`);
    game.reactionTimerEndTime = null;

    while (game.pendingOperations.length > 0) {
      const operation = game.pendingOperations.pop();
      if (!operation) continue;

      const { card, playerId } = operation;
      const player = game.players.find(p => p.id === playerId);
      if (!player) continue;

      console.log(`[${gameCode}] Processing ${card.type} from ${player.name}`);
      switch (card.type) {
        case 'Shuffle':
        case 'Shuffle Now':
          game.drawPile = shuffleDeck(game.drawPile);
          game.gameLog.push(`${player.name} shuffled the deck.`);
          break;
        case 'Nak':
          if (game.pendingOperations.length > 0) {
            const negatedOperation = game.pendingOperations.pop();
            game.gameLog.push(`${player.name} negated ${negatedOperation?.card.name}.`);
          }
          break;
      }
    }
    console.log(`[${gameCode}] Finished processing operations.`);
    broadcastGameState(gameCode);
  };

  io.on('connection', (socket: Socket) => {
    console.log('A user connected:', socket.id);

    socket.on('create-game', ({ gameCode, dbg }: { gameCode: string; dbg: boolean }) => {
      console.log(`[${gameCode}] Game created. Debug mode: ${dbg}`);
      games.set(gameCode, {
        players: [],
        gameLog: [],
        creatorId: '',
        drawPile: [],
        discardPile: [],
        currentPlayerIndex: 0,
        debuggingPlayerId: null,
        pendingOperations: [],
        reactionTimerEndTime: null,
        dbg: dbg,
      });
      socket.join(gameCode);
    });

    socket.on('join-game', ({ gameCode, playerName }: { gameCode: string; playerName: string }) => {
      if (!games.has(gameCode)) {
        console.error(`[${gameCode}] Attempted to join non-existent game.`);
        socket.emit('error', 'Game not found');
        return;
      }
      console.log(`[${gameCode}] Player ${playerName} (${socket.id}) is joining.`);
      socket.join(gameCode);
      const game = games.get(gameCode)!;
      if (game.players.length === 0) {
        game.creatorId = socket.id;
      }

      if (!game.players.some(p => p.id === socket.id)) {
        game.players.push({ id: socket.id, name: playerName, hand: [], isExploded: false });
      }
      
      io.to(gameCode).emit('update-players', { playerList: game.players.map(p => p.name), creatorId: game.creatorId });
    });

    socket.on('start-game', (gameCode: string) => {
      const game = games.get(gameCode);
      if (!game || socket.id !== game.creatorId) {
        console.error(`[${gameCode}] Unauthorized attempt to start game by ${socket.id}`);
        return;
      }
      console.log(`[${gameCode}] Starting game...`);
      
      // Deck creation and dealing logic...
      let deck = [...fullDeck];
      const explodingClusters = deck.filter(c => c.type === 'Exploding Cluster');
      const upgradeClusters = deck.filter(c => c.type === 'Upgrade Cluster');
      let debugCards = deck.filter(c => c.type === 'Debug');
      deck = deck.filter(c => c.type !== 'Exploding Cluster' && c.type !== 'Upgrade Cluster' && c.type !== 'Debug');
      for (const player of game.players) {
        if (debugCards.length > 0) player.hand.push(debugCards.pop()!);
      }
      const debugsToReturn = Math.min(debugCards.length, 2);
      for (let i = 0; i < debugsToReturn; i++) deck.push(debugCards.pop()!);
      deck = shuffleDeck(deck);
      for (const player of game.players) player.hand.push(...deck.splice(0, 7));
      const numExploding = game.players.length - 1;
      for (let i = 0; i < numExploding; i++) if (explodingClusters.length > 0) deck.push(explodingClusters.pop()!);
      const numPlayers = game.players.length;
      if (numPlayers >= 3 && numPlayers <= 4) { if (upgradeClusters.length > 0) deck.push(upgradeClusters.pop()!); }
      else if (numPlayers === 5) { for (let i = 0; i < 2; i++) if (upgradeClusters.length > 0) deck.push(upgradeClusters.pop()!); }
      game.drawPile = shuffleDeck(deck);

      if (game.dbg) {
        const explodingIndex = game.drawPile.findIndex(c => c.type === 'Exploding Cluster');
        if (explodingIndex > -1) {
          console.log(`[${gameCode}] DEBUG: Moving Exploding Cluster to top of deck.`);
          const [explodingCard] = game.drawPile.splice(explodingIndex, 1);
          game.drawPile.unshift(explodingCard);
        }
      }

      game.currentPlayerIndex = Math.floor(Math.random() * game.players.length);
      console.log(`[${gameCode}] Game started. First player is ${game.players[game.currentPlayerIndex].name}`);
      
      io.to(gameCode).emit('game-started');
      broadcastGameState(gameCode);
    });

    socket.on('request-game-state', (gameCode: string) => {
      const game = games.get(gameCode);
      if (!game) return;
      const player = game.players.find(p => p.id === socket.id);
      if (!player) return;
      console.log(`[${gameCode}] Sending game state to ${player.name}`);
      const gameStateForPlayer = {
        ...game,
        drawPile: game.drawPile.length,
        players: game.players.map(p => ({ ...p, hand: p.id === player.id ? p.hand : p.hand.length })),
      };
      socket.emit('game-state', gameStateForPlayer);
    });

    socket.on('play-card', ({ gameCode, cardId }: { gameCode: string; cardId: string }) => {
      const game = games.get(gameCode);
      if (!game) return;
      const player = game.players.find(p => p.id === socket.id);
      if (!player) return;

      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return;

      const card = player.hand[cardIndex];
      console.log(`[${gameCode}] Attempting to play card ${card.name} by ${player.name}`);

      if (game.debuggingPlayerId) {
        console.error(`[${gameCode}] ILLEGAL PLAY: ${player.name} tried to play ${card.name} while player ${game.debuggingPlayerId} is debugging.`);
        socket.emit('error', 'Cannot play cards while a player is debugging an Exploding Cluster.');
        return;
      }

      player.hand.splice(cardIndex, 1);
      game.discardPile.push(card);
      game.pendingOperations.push({ card, playerId: player.id });
      game.gameLog.push(`${player.name} played ${card.name.toUpperCase()}.`);
      console.log(`[${gameCode}] ${player.name} played ${card.name}. Starting reaction timer.`);

      game.reactionTimerEndTime = Date.now() + 5000;
      setTimeout(() => processPendingOperations(gameCode), 5000);

      broadcastGameState(gameCode);
    });

    socket.on('draw-card', ({ gameCode }: { gameCode: string }) => {
      const game = games.get(gameCode);
      if (!game) return;
      const player = game.players[game.currentPlayerIndex];
      if (player.id !== socket.id) return;

      console.log(`[${gameCode}] ${player.name} is drawing a card.`);
      if (game.drawPile.length > 0) {
        const card = game.drawPile.shift()!;
        console.log(`[${gameCode}] ${player.name} drew ${card.name}.`);
        if (card.type === 'Exploding Cluster') {
          console.log(`[${gameCode}] IT'S AN EXPLODING CLUSTER!`);
          game.debuggingPlayerId = player.id;
          io.to(gameCode).emit('player-exploding', { playerId: player.id, card });
          const hasDebug = player.hand.some(c => c.type === 'Debug');
          if (!hasDebug) {
            console.log(`[${gameCode}] ${player.name} has no Debug card and explodes!`);
            player.isExploded = true;
            player.hand = [];
            game.gameLog.push(`${player.name} exploded!`);
            game.debuggingPlayerId = null;
            advanceTurn(game);
            checkWinCondition(game, gameCode);
          } else {
            console.log(`[${gameCode}] ${player.name} has a Debug card and must play it.`);
          }
        } else {
          player.hand.push(card);
          advanceTurn(game);
        }
        broadcastGameState(gameCode);
      }
    });

    socket.on('debugged', ({ gameCode, cardId }: { gameCode: string; cardId: string }) => {
      console.log(`[${gameCode}] Received 'debugged' event from ${socket.id} with cardId: ${cardId}`);
      const game = games.get(gameCode);
      if (!game) {
        console.error(`[${gameCode}] Game not found for 'debugged' event.`);
        return;
      }
      const player = game.players.find(p => p.id === socket.id);
      if (!player) {
        console.error(`[${gameCode}] Player not found for 'debugged' event.`);
        return;
      }
      if (player.id !== game.debuggingPlayerId) {
        console.error(`[${gameCode}] ${player.name} sent 'debugged' but it's not their turn to debug.`);
        return;
      }

      const cardIndex = player.hand.findIndex(c => c.id === cardId && c.type === 'Debug');
      if (cardIndex > -1) {
        const card = player.hand.splice(cardIndex, 1)[0];
        game.discardPile.push(card);
        console.log(`[${gameCode}] ${player.name} successfully played a Debug card.`);
        socket.emit('debug-successful');
        broadcastGameState(gameCode);
      } else {
        console.error(`[${gameCode}] ${player.name} sent 'debugged' but did not have the specified Debug card.`);
      }
    });

    socket.on('reinsert-exploding-cluster', ({ gameCode, position, card }: { gameCode: string; position: number; card: Card }) => {
      console.log(`[${gameCode}] ${socket.id} is reinserting Exploding Cluster at position ${position}`);
      const game = games.get(gameCode);
      if (!game || socket.id !== game.debuggingPlayerId) return;

      if (card && card.type === 'Exploding Cluster') {
        game.drawPile.splice(position, 0, card);
        game.debuggingPlayerId = null;
        advanceTurn(game);
        broadcastGameState(gameCode);
      }
    });

    socket.on('reorder-hand', ({ gameCode, newHand }: { gameCode: string; newHand: Card[] }) => {
      const game = games.get(gameCode);
      if (!game) return;
      const player = game.players.find(p => p.id === socket.id);
      if (!player) return;
      player.hand = newHand;
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      // ... (cleanup logic)
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});