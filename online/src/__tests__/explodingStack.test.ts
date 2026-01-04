// Copyright 2025 Tim Hockin

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
    devMode: true,
    maxGames: 10,
    maxSpectators: 10,
    reactionTimer: 1,
    goFast: false
  }
}));

describe('Exploding Stack Logic', () => {
  let io: Server;
  let gameManager: GameManager;

  beforeEach(() => {
    jest.useFakeTimers();
    io = new Server();
    (io.on as jest.Mock) = jest.fn();
    (io.to as jest.Mock) = jest.fn().mockReturnValue({ emit: jest.fn() });
    gameManager = new GameManager(io);
  });

  afterEach(() => {
    gameManager.cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  const setupGame = () => {
    const hostSocket = createMockSocket('host', 'Host');
    const p2Socket = createMockSocket('p2', 'P2');

    const connectionHandler = (io.on as jest.Mock).mock.calls[0][1];
    connectionHandler(hostSocket);

    let createdGameCode = '';
    hostSocket.trigger(SocketEvent.CreateGame, 'Host', (res) => { createdGameCode = res.gameCode; });

    connectionHandler(p2Socket);
    p2Socket.trigger(SocketEvent.JoinGame, createdGameCode, 'P2', undefined, jest.fn());

    hostSocket.trigger(SocketEvent.StartGame, createdGameCode, jest.fn());

    return { hostSocket, p2Socket, gameCode: createdGameCode };
  };

  const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

  it('should continue turn if attackTurns > 0 after debugging explosion', async () => {
    const { hostSocket, p2Socket, gameCode } = setupGame();
    const game = (gameManager as any).games.get(gameCode);
    const p2 = game.players[1];

    // Setup: P2 needs to take 2 turns
    game.currentPlayer = 1; // P2
    game.attackTurns = 2;
    game.attackTurnsTaken = 0;

    // Rig deck: Top card (end of array) is EXPLODING CLUSTER
    const explodingCard = { id: 'ec-1', class: CardClass.ExplodingCluster, name: 'EC', imageUrl: '' };
    game.drawPile.push(explodingCard);

    // Give P2 a DEBUG card
    const debugCard = { id: 'debug-1', class: CardClass.Debug, name: 'Debug', imageUrl: '' };
    p2.hand.push(debugCard);

    // P2 draws (Turn 1 of 2)
    p2Socket.trigger(SocketEvent.DrawCard, gameCode);
    jest.advanceTimersByTime(3000);
    await flushPromises();

    // Verify state: Exploding Phase
    expect(game.turnPhase).toBe(TurnPhase.Exploding);
    expect(game.players[game.currentPlayer].id).toBe(p2.id);

    // P2 plays DEBUG
    p2Socket.trigger(SocketEvent.PlayCard, { gameCode, cardId: debugCard.id, nonce: game.nonce });
    // Verify DEBUG played (removed from hand, phase unchanged as we wait for re-insert)
    expect(p2.hand.find(c => c.id === debugCard.id)).toBeUndefined();

    // P2 re-inserts EXPLODING CLUSTER
    p2Socket.trigger(SocketEvent.ReinsertExplodingCard, { gameCode, index: 0, nonce: game.nonce });
    await flushPromises();

    // Verify state:
    // Should still be P2's turn
    expect(game.players[game.currentPlayer].id).toBe(p2.id);
    // Phase should be Action
    expect(game.turnPhase).toBe(TurnPhase.Action);
    // attackTurns should be decremented to 1
    expect(game.attackTurns).toBe(1);
    // attackTurnsTaken should be 1
    expect(game.attackTurnsTaken).toBe(1);
  });
});
