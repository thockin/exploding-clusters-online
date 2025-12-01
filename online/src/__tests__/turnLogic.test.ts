import { GameManager } from '../gameManager';
import { CardClass, GameState, SocketEvent, TurnPhase } from '../api';

// --- MOCK INFRASTRUCTURE (Copied from gameManager.test.ts) ---
interface GameResponse {
  success: boolean;
  gameCode?: string;
  playerId?: string;
  error?: string;
  nonce?: string;
}

interface TimerUpdateData {
  duration: number;
  phase: TurnPhase;
}

class MockSocket {
  readonly id: string;
  callbacks: Record<string, (...args: unknown[]) => void> = {};
  emitted: Record<string, unknown[]> = {};
  joinedGames: string[] = [];

  constructor(id: string) {
    this.id = id;
  }

  on(event: string, callback: (...args: unknown[]) => void) {
    this.callbacks[event] = callback;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAny(_callback: (...args: unknown[]) => void) { }

  emit(event: string, data?: unknown) {
    if (!this.emitted[event]) this.emitted[event] = [];
    this.emitted[event].push(data);
  }

  join(game: string) {
    this.joinedGames.push(game);
  }

  leave(game: string) {
    // no-op
  }

  trigger(event: string, ...args: unknown[]) {
    if (this.callbacks[event]) {
      this.callbacks[event](...args);
    }
  }
}

class MockServer {
  sockets: {
    sockets: Map<string, MockSocket>;
    in: (game: string) => { emit: (event: string, data?: unknown) => void; socketsLeave: (game: string) => void };
  };
  games: Record<string, { emitted: Record<string, unknown[]> }> = {};
  socketEmissions: Record<string, Record<string, unknown[]>> = {}; // Track emissions to specific sockets
  connectionCallback: ((socket: MockSocket) => void) | null = null;

  constructor() {
    this.sockets = {
      sockets: new Map<string, MockSocket>(),
      in: (game: string) => this.to(game)
    };
  }

  on(event: string, callback: (...args: unknown[]) => void) {
    if (event === 'connection') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.connectionCallback = callback as any;
    }
  }

  connectSocket(socket: MockSocket) {
    if (this.connectionCallback) {
      this.connectionCallback(socket);
    }
    this.sockets.sockets.set(socket.id, socket);
    if (!this.socketEmissions[socket.id]) {
      this.socketEmissions[socket.id] = {};
    }
  }

  to(target: string) {
    // Check if target is a socket ID (in our mock, socket IDs are like 'socket-1', 'host', etc.)
    // If it's a socket ID, emit to that socket
    if (this.sockets.sockets.has(target)) {
      return {
        emit: (event: string, data?: unknown) => {
          const socket = this.sockets.sockets.get(target);
          if (socket) {
            if (!socket.emitted[event]) socket.emitted[event] = [];
            socket.emitted[event].push(data);
          }
          if (!this.socketEmissions[target]) this.socketEmissions[target] = {};
          if (!this.socketEmissions[target][event]) this.socketEmissions[target][event] = [];
          this.socketEmissions[target][event].push(data);
        },
        socketsLeave: () => { }
      };
    }
    // Otherwise, treat it as a game code
    if (!this.games[target]) this.games[target] = { emitted: {} };
    return {
      emit: (event: string, data?: unknown) => {
        if (!this.games[target].emitted[event]) this.games[target].emitted[event] = [];
        this.games[target].emitted[event].push(data);
      },
      socketsLeave: () => { }
    };
  }

  in(game: string) { return this.to(game); }
}
// -----------------------------------------------------------

describe('Turn Logic (Phase 3.1.3)', () => {
  let gameManager: GameManager;
  let mockServer: MockServer;
  let host: MockSocket;
  let p2: MockSocket;
  let p3: MockSocket;
  let gameCode: string;
  const originalDevMode = process.env.DEVMODE;

  beforeAll(() => {
    process.env.DEVMODE = '1'; // Ensure Host is first
  });

  afterAll(() => {
    if (originalDevMode !== undefined) process.env.DEVMODE = originalDevMode;
    else delete process.env.DEVMODE;
  });

  beforeEach((done) => {
    mockServer = new MockServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gameManager = new GameManager(mockServer as any);

    host = new MockSocket('host');
    p2 = new MockSocket('p2');
    p3 = new MockSocket('p3');
    mockServer.connectSocket(host);
    mockServer.connectSocket(p2);
    mockServer.connectSocket(p3);

    // Create game with 3 players
    host.trigger('createGame', 'Host', (res: GameResponse) => {
      gameCode = res.gameCode!;
      p2.trigger('joinGame', gameCode, 'P2', undefined, () => {
        p3.trigger('joinGame', gameCode, 'P3', undefined, () => {
          host.trigger('startGame', gameCode, () => {
            done();
          });
        });
      });
    });
  });

  afterEach(() => {
    // Clean up any active timers to prevent Jest from hanging
    if (gameManager) {
      gameManager.cleanup();
    }
  });

  // Helper to get last TimerUpdate
  const getLastTimerUpdate = (): TimerUpdateData | undefined => {
    const emits = mockServer.games[gameCode].emitted[SocketEvent.TimerUpdate];
    if (!emits || emits.length === 0) return undefined;
    return emits[emits.length - 1] as TimerUpdateData;
  };

  test('Start of turn is Action phase', () => {
    // We can verify this via game update or internal state if we exposed it, 
    // but better to verify behavior: Can play regular card.
    // Host has DEVELOPER cards (regular) and NAK (now).
    // Let's assume we can get hand from update.
    // In DEVMODE, P1 Hand: 2x Dev(A), 1x Dev(B), 2x Nak, 1x Shuffle, 1x Favor.
    // Shuffle is regular. Favor is regular.
    
    // We need a way to know card IDs. 
    // We can get hand from emitted HandUpdate to host.
    const hand = host.emitted[SocketEvent.HandUpdate][0] as any; // Initial hand
    const shuffleCard = hand.hand.find((c: any) => c.class === CardClass.Shuffle);
    
    // Play Shuffle (Regular)
    host.trigger('playCard', { gameCode, cardId: shuffleCard.id });
    
    setTimeout(() => {
      // Should trigger TimerUpdate with Reaction phase
      const update = getLastTimerUpdate();
      expect(update).toBeDefined();
      expect(update!.phase).toBe(TurnPhase.Reaction);
      expect(update!.duration).toBe(8);
    }, 10);
  });

  test('Current player cannot play regular card during Reaction', (done) => {
    // 1. Play Shuffle to enter Reaction
    const hand = host.emitted[SocketEvent.HandUpdate][0] as any;
    const shuffleCard = hand.hand.find((c: any) => c.class === CardClass.Shuffle);
    const favorCard = hand.hand.find((c: any) => c.class === CardClass.Favor);

    host.trigger('playCard', { gameCode, cardId: shuffleCard.id });

    setTimeout(() => {
      // Confirm Reaction
      expect(getLastTimerUpdate()!.phase).toBe(TurnPhase.Reaction);

      // 2. Try to play Favor (Regular)
      host.trigger('playCard', { gameCode, cardId: favorCard.id });

      setTimeout(() => {
        // Should get error message
        const msgs = host.emitted[SocketEvent.GameMessage];
        const lastMsg = msgs[msgs.length - 1] as any;
        expect(lastMsg.message).toMatch(/wait for reactions/i);
        done();
      }, 10);
    }, 10);
  });

  test('Other player can play NOW card during Action (triggers Rereaction)', (done) => {
    // P2 has NAK (Now).
    // In DEVMODE, P2 hand deals: 1 Nak...
    // Host is in Action phase.
    // P2 plays NAK.
    
    // Need P2's hand. P2 gets dealt random cards after P1... wait.
    // In DEVMODE:
    // P1 Hand: Fixed.
    // P2 Hand: Fixed (1 Nak, 1 Skip, 1 ShuffleNow, 1 Attack, 1 SeeFuture, 2 Dev).
    
    // Wait, let's verify P2 gets HandUpdate.
    // P2 socket emitted 'handUpdate'.
    const p2HandEvents = p2.emitted[SocketEvent.HandUpdate];
    // The last one should be the dealt hand.
    const p2Hand = (p2HandEvents[p2HandEvents.length - 1] as any).hand;
    const nakCard = p2Hand.find((c: any) => c.class === CardClass.Nak);

    expect(nakCard).toBeDefined();

    // P2 plays NAK during Host's Action phase
    p2.trigger('playCard', { gameCode, cardId: nakCard.id });

    setTimeout(() => {
      // Should trigger Rereaction (Other player played)
      const update = getLastTimerUpdate();
      expect(update).toBeDefined();
      expect(update!.phase).toBe(TurnPhase.Rereaction);
      expect(update!.duration).toBe(8);
      done();
    }, 10);
  });

  test('Action -> Reaction (P1) -> Rereaction (P2)', (done) => {
    // 1. Host plays Shuffle
    const p1Hand = (host.emitted[SocketEvent.HandUpdate].pop() as any).hand;
    const shuffleCard = p1Hand.find((c: any) => c.class === CardClass.Shuffle);
    
    host.trigger('playCard', { gameCode, cardId: shuffleCard.id });

    setTimeout(() => {
      expect(getLastTimerUpdate()!.phase).toBe(TurnPhase.Reaction);

      // 2. P2 plays NAK
      const p2Hand = (p2.emitted[SocketEvent.HandUpdate].pop() as any).hand;
      const nakCard = p2Hand.find((c: any) => c.class === CardClass.Nak);
      
      p2.trigger('playCard', { gameCode, cardId: nakCard.id });

      setTimeout(() => {
        expect(getLastTimerUpdate()!.phase).toBe(TurnPhase.Rereaction);
        done();
      }, 10);
    }, 10);
  });

  test('Rereaction (P2) -> Reaction (P1 plays Now)', (done) => {
    // 1. P2 plays NAK (Action -> Rereaction)
    const p2Hand = (p2.emitted[SocketEvent.HandUpdate].pop() as any).hand;
    const nakCardP2 = p2Hand.find((c: any) => c.class === CardClass.Nak);
    p2.trigger('playCard', { gameCode, cardId: nakCardP2.id });

    setTimeout(() => {
      expect(getLastTimerUpdate()!.phase).toBe(TurnPhase.Rereaction);

      // 2. P1 plays NAK (P1 has NAK)
      const p1Hand = (host.emitted[SocketEvent.HandUpdate].pop() as any).hand;
      const nakCardP1 = p1Hand.find((c: any) => c.class === CardClass.Nak);
      
      host.trigger('playCard', { gameCode, cardId: nakCardP1.id });

      setTimeout(() => {
        // Current player played -> Reaction
        expect(getLastTimerUpdate()!.phase).toBe(TurnPhase.Reaction);
        done();
      }, 10);
    }, 10);
  });
});
