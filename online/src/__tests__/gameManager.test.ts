import { GameManager } from '../gameManager';

// Define types for callbacks and responses
interface GameResponse {
    success: boolean;
    gameCode?: string;
    playerId?: string;
    error?: string;
    nonce?: string;
}

interface StartGameResponse {
    success: boolean;
    error?: string;
}

interface GameEndData {
    winner: string;
    reason: string;
}

// Mock Socket
class MockSocket {
    readonly id: string;
    callbacks: Record<string, (...args: unknown[]) => void> = {};
    emitted: Record<string, unknown[]> = {};
    joinedRooms: string[] = [];

    constructor(id: string) {
        this.id = id;
    }

    on(event: string, callback: (...args: unknown[]) => void) {
        this.callbacks[event] = callback;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAny(_callback: (...args: unknown[]) => void) {
        // ignore
    }

    emit(event: string, data?: unknown) {
        if (!this.emitted[event]) this.emitted[event] = [];
        this.emitted[event].push(data);
    }

    join(room: string) {
        this.joinedRooms.push(room);
    }

    trigger(event: string, ...args: unknown[]) {
        if (this.callbacks[event]) {
            this.callbacks[event](...args);
        }
    }
}

// Mock Server
class MockServer {
    sockets: {
        sockets: Map<string, MockSocket>;
        in: (room: string) => { emit: (event: string, data?: unknown) => void; socketsLeave: (room: string) => void };
    };
    rooms: Record<string, { emitted: Record<string, unknown[]> }> = {};
    connectionCallback: ((socket: MockSocket) => void) | null = null;

    constructor() {
        this.sockets = {
            sockets: new Map<string, MockSocket>(),
            in: (room: string) => this.in(room)
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
    }

    to(room: string) {
        if (!this.rooms[room]) this.rooms[room] = { emitted: {} };
        return {
            emit: (event: string, data?: unknown) => {
                if (!this.rooms[room].emitted[event]) this.rooms[room].emitted[event] = [];
                this.rooms[room].emitted[event].push(data);
            },
            socketsLeave: () => { }
        };
    }

    in(room: string) { return this.to(room); }
}

describe('GameManager', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let gameManager: GameManager;
    const mockServer = new MockServer();

    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gameManager = new GameManager(mockServer as any);
    });

    test('createGame creates a new game', (done) => {
        const socket = new MockSocket('socket-1');
        mockServer.connectSocket(socket);

        socket.trigger('createGame', 'Player1', (response: GameResponse) => {
            expect(response.success).toBe(true);
            expect(response.gameCode).toHaveLength(5);
            expect(response.playerId).toBeDefined();
            done();
        });
    });

    test('joinGame adds a player', (done) => {
        const host = new MockSocket('host');
        mockServer.connectSocket(host);
        let gameCode: string;

        host.trigger('createGame', 'Host', (res: GameResponse) => {
            gameCode = res.gameCode!;
            
            const player2 = new MockSocket('p2');
            mockServer.connectSocket(player2);
            
            player2.trigger('joinGame', gameCode, 'Player2', undefined, (res2: GameResponse) => {
                expect(res2.success).toBe(true);
                expect(mockServer.rooms[gameCode].emitted['playerJoined']).toBeDefined();
                done();
            });
        });
    });

    test('leaveGame triggers attrition win if < 2 players remain in started game', (done) => {
        const host = new MockSocket('host');
        mockServer.connectSocket(host);
        let gameCode: string;

        host.trigger('createGame', 'Host', (res: GameResponse) => {
            gameCode = res.gameCode!;
            const p2 = new MockSocket('p2');
            mockServer.connectSocket(p2);
            
            p2.trigger('joinGame', gameCode, 'Player2', undefined, () => {
                host.trigger('startGame', gameCode, (resStart: StartGameResponse) => {
                    expect(resStart.success).toBe(true);
                    
                    p2.trigger('leaveGame', gameCode);
                    
                    const roomEmits = mockServer.rooms[gameCode].emitted['gameEnded'];
                    expect(roomEmits).toBeDefined();
                    const lastEmit = roomEmits![roomEmits!.length - 1] as GameEndData;
                    expect(lastEmit).toBeDefined();
                    expect(lastEmit.reason).toBe('attrition');
                    expect(lastEmit.winner).toBe('Host');
                    done();
                });
            });
        });
    });

    test('leaveGame does NOT trigger attrition win if game NOT started', (done) => {
        const host = new MockSocket('host');
        mockServer.connectSocket(host);
        let gameCode: string;

        host.trigger('createGame', 'Host', (res: GameResponse) => {
            gameCode = res.gameCode!;
            const p2 = new MockSocket('p2');
            mockServer.connectSocket(p2);
            
            p2.trigger('joinGame', gameCode, 'Player2', undefined, () => {
                p2.trigger('leaveGame', gameCode);
                
                const roomEmits = mockServer.rooms[gameCode].emitted['gameEnded'];
                expect(roomEmits).toBeUndefined();
                done();
            });
        });
    });
});