import { GameManager } from '../gameManager';
import { CardClass, SocketEvent, TurnPhase } from '../api';

// --- MOCK INFRASTRUCTURE ---
interface GameResponse {
  success: boolean;
  gameCode?: string;
  playerId?: string;
  error?: string;
  nonce?: string;
}

class MockSocket {
  readonly id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callbacks: Record<string, (...args: any[]) => void> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitted: Record<string, any[]> = {};
  joinedGames: string[] = [];

  constructor(id: string) {
    this.id = id;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, callback: (...args: any[]) => void) {
    this.callbacks[event] = callback;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  onAny(_callback: (...args: any[]) => void) { }

  emit(event: string, data?: unknown) {
    if (!this.emitted[event]) this.emitted[event] = [];
    this.emitted[event].push(data);
  }

  join(game: string) {
    this.joinedGames.push(game);
  }

  leave(_game: string) {
    // no-op
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trigger(event: string, ...args: any[]) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  games: Record<string, { emitted: Record<string, any[]> }> = {};
  connectionCallback: ((socket: MockSocket) => void) | null = null;

  constructor() {
    this.sockets = {
      sockets: new Map<string, MockSocket>(),
      in: (game: string) => this.to(game)
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, callback: (...args: any[]) => void) {
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
  }

  to(target: string) {
    if (this.sockets.sockets.has(target)) {
      const socket = this.sockets.sockets.get(target)!;
      return {
        emit: (event: string, data?: unknown) => {
          socket.emit(event, data);
        },
        socketsLeave: () => { }
      };
    }
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

describe('Executing Phase Blocking', () => {
  let gameManager: GameManager;
  let mockServer: MockServer;
  let host: MockSocket;
  let p2: MockSocket;
  let gameCode: string;
  const originalDevMode = process.env.DEVMODE;

  beforeAll(() => {
    process.env.DEVMODE = '1';
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
    mockServer.connectSocket(host);
    mockServer.connectSocket(p2);

    host.trigger('createGame', 'Host', (res: GameResponse) => {
      gameCode = res.gameCode!;
      p2.trigger('joinGame', gameCode, 'P2', undefined, () => {
        host.trigger('startGame', gameCode, () => {
          done();
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

  // Helper to force phase
  const setGamePhase = (phase: TurnPhase) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gameManager as any).games.get(gameCode).turnPhase = phase;
  };

  test('Cannot draw card during Executing phase', () => {
    // Force phase to Executing
    setGamePhase(TurnPhase.Executing);

    // Host tries to draw
    host.trigger('drawCard', gameCode);

    // Verify rejection message
    const msgs = host.emitted[SocketEvent.GameMessage];
    expect(msgs).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastMsg = msgs[msgs.length - 1] as any;
    expect(lastMsg.message).toMatch(/wait for reactions/i); // "You cannot draw right now (wait for reactions)."
    
    // Verify no card drawn (Action phase would emit DrawCardAnimation)
    expect(host.emitted[SocketEvent.DrawCardAnimation]).toBeUndefined();
  });

  test('Cannot play card during Executing phase', () => {
    setGamePhase(TurnPhase.Executing);

    // Get a card from Host's hand
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hand = host.emitted[SocketEvent.HandUpdate][0] as any;
    const card = hand.hand[6];

    host.trigger('playCard', { gameCode, cardId: card.id });

    // Verify rejection
    const msgs = host.emitted[SocketEvent.GameMessage];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastMsg = msgs[msgs.length - 1] as any;
    // Expected: "You can't play cards while the previous play is in progress."
    expect(lastMsg.message).toMatch(/previous play is in progress/i);
  });

  test('Cannot play combo during Executing phase', () => {
    setGamePhase(TurnPhase.Executing);

    // Host has 2 identical Developer cards in DEVMODE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hand = host.emitted[SocketEvent.HandUpdate][0] as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const devCards = hand.hand.filter((c: any) => c.class === CardClass.Developer);
    // Grab the first two (which should be identical per DEVMODE setup: 2 identical, 1 different)
    // Actually DEVMODE setup: "The first player's hand starts with 2 identical DEVELOPER cards..."
    // So the first two found with same name should work.
    const pairName = devCards[0].name;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pair = devCards.filter((c: any) => c.name === pairName).slice(0, 2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    host.trigger('playCombo', { gameCode, cardIds: pair.map((c: any) => c.id) });

    // Verify rejection
    const msgs = host.emitted[SocketEvent.GameMessage];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastMsg = msgs[msgs.length - 1] as any;
    // Expected: "You can only play combos in your Action phase."
    expect(lastMsg.message).toMatch(/only play combos in your Action phase/i);
  });
});
