import { Server, Socket } from 'socket.io';
import { GameManager } from '../gameManager';
import { CardClass, GameState, SocketEvent, TurnPhase } from '../api';

const createMockSocket = (id: string, name: string) => {
  const callbacks: Record<string, Function> = {};
  return {
    id,
    on: jest.fn((event, cb) => { callbacks[event] = cb; }),
    onAny: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    trigger: (event: string, ...args: any[]) => {
      if (callbacks[event]) {
        callbacks[event](...args);
      }
    }
  } as unknown as Socket & { trigger: (event: string, ...args: any[]) => void };
};

// Mock dependencies
jest.mock('../utils/PseudoRandom', () => {
  return {
    PseudoRandom: jest.fn().mockImplementation(() => ({
      random: jest.fn().mockReturnValue(0.5),
      seed: jest.fn()
    })),
    SecureRandom: jest.fn().mockImplementation(() => ({
        random: jest.fn().mockReturnValue(0.5)
    }))
  };
});

jest.mock('../config', () => ({
  config: {
    verbose: false,
    devMode: true, // Use devMode to ensure deterministic behavior if needed
    maxGames: 10,
    maxSpectators: 10,
    reactionTimer: 1, // Short timer for tests
    goFast: false
  }
}));

describe('Attack Phase Logic', () => {
  let io: Server;
  let gameManager: GameManager;
  let clientSockets: Map<string, any>;
  let serverSockets: Map<string, any>;

  beforeEach(() => {
    jest.useFakeTimers();
    clientSockets = new Map();
    serverSockets = new Map();
    io = new Server();
    
    (io.on as jest.Mock) = jest.fn((event, callback) => {
      // Mock connection handler if needed
    });
    (io.to as jest.Mock) = jest.fn().mockReturnValue({
      emit: jest.fn()
    });

    gameManager = new GameManager(io);
  });

  afterEach(() => {
    gameManager.cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  const setupGame = (gameCode = 'XXXXX') => {
    const hostSocket = createMockSocket('host', 'Host');
    const p2Socket = createMockSocket('p2', 'P2');
    const p3Socket = createMockSocket('p3', 'P3');

    const connectionHandler = (io.on as jest.Mock).mock.calls[0][1];
    connectionHandler(hostSocket);
    
    let createdGameCode = '';
    const createCallback = jest.fn((res) => { createdGameCode = res.gameCode; });
    hostSocket.trigger(SocketEvent.CreateGame, 'Host', createCallback);
    
    connectionHandler(p2Socket);
    p2Socket.trigger(SocketEvent.JoinGame, createdGameCode, 'P2', undefined, jest.fn());
    
    connectionHandler(p3Socket);
    p3Socket.trigger(SocketEvent.JoinGame, createdGameCode, 'P3', undefined, jest.fn());
    
    hostSocket.trigger(SocketEvent.StartGame, createdGameCode, jest.fn());

    return { hostSocket, p2Socket, p3Socket, gameCode: createdGameCode };
  };

  const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

  it('should increment attackTurns by 2 and pass to next player', async () => {
    const { hostSocket, p2Socket, gameCode } = setupGame();
    const game = (gameManager as any).games.get(gameCode);
    
    // Host plays ATTACK
    const host = game.players[0];
    const attackCard = { id: 'attack-1', class: CardClass.Attack, name: 'Attack', imageUrl: '', now: false };
    host.hand.push(attackCard);
    
    // Ensure it's Host's turn
    game.currentTurnIndex = 0; // Host
    game.attackTurns = 0;

    hostSocket.trigger(SocketEvent.PlayCard, { gameCode, cardId: attackCard.id, nonce: game.nonce });

    jest.advanceTimersByTime(1500); 
    await flushPromises();

    // Verify attackTurns incremented
    expect(game.attackTurns).toBe(2);
    
    // Verify turn passed to P2
    expect(game.currentTurnIndex).toBe(1);
  });

  it('should stack attacks: P2 attacks P3', async () => {
    const { hostSocket, p2Socket, p3Socket, gameCode } = setupGame();
    const game = (gameManager as any).games.get(gameCode);
    
    // Host attacks P2
    const host = game.players[0];
    host.hand.push({ id: 'attack-h', class: CardClass.Attack, name: 'Attack', imageUrl: '' });
    hostSocket.trigger(SocketEvent.PlayCard, { gameCode, cardId: 'attack-h', nonce: game.nonce });
    jest.advanceTimersByTime(1500);
    await flushPromises();
    
    expect(game.attackTurns).toBe(2);
    expect(game.currentTurnIndex).toBe(1); // P2

    // P2 draws once (consumes 1 turn)
    p2Socket.trigger(SocketEvent.DrawCard, gameCode);
    jest.advanceTimersByTime(3000);
    await flushPromises();

    expect(game.attackTurns).toBe(1);
    expect(game.currentTurnIndex).toBe(1); // Still P2

    // P2 attacks P3
    const p2 = game.players[1];
    p2.hand.push({ id: 'attack-p2', class: CardClass.Attack, name: 'Attack', imageUrl: '' });
    p2Socket.trigger(SocketEvent.PlayCard, { gameCode, cardId: 'attack-p2', nonce: game.nonce });
    
    jest.advanceTimersByTime(1500);
    await flushPromises();
    
    // attackTurns was 1, added 2 => 3
    expect(game.attackTurns).toBe(3);
    
    // Turn passes to P3
    expect(game.currentTurnIndex).toBe(2); // P3
  });

  it('should decrement attackTurns on draw', async () => {
    const { hostSocket, p2Socket, gameCode } = setupGame();
    const game = (gameManager as any).games.get(gameCode);
    
    // Manually set state: P2's turn, attackTurns = 2
    game.currentTurnIndex = 1;
    game.attackTurns = 2;
    
    // P2 draws a card
    p2Socket.trigger(SocketEvent.DrawCard, gameCode);
    jest.advanceTimersByTime(3000); 
    await flushPromises();
    
    // Should still be P2's turn, but 1 attack turn left
    expect(game.currentTurnIndex).toBe(1);
    expect(game.attackTurns).toBe(1);
    
    // P2 draws again
    p2Socket.trigger(SocketEvent.DrawCard, gameCode);
    jest.advanceTimersByTime(3000);
    await flushPromises();
    
    // Should now be P3's turn
    expect(game.currentTurnIndex).toBe(2);
    expect(game.attackTurns).toBe(0);
  });
});