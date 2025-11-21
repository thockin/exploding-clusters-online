import { GameManager } from '../gameManager';

// Mock Socket
class MockSocket {
    id: string;
    callbacks: Record<string, Function> = {};
    emitted: Record<string, any[]> = {};
    joinedRooms: string[] = [];

    constructor(id: string) {
        this.id = id;
    }

    on(event: string, callback: Function) {
        this.callbacks[event] = callback;
    }

    onAny(callback: Function) {
        // ignore
    }

    emit(event: string, data?: any) {
        if (!this.emitted[event]) this.emitted[event] = [];
        this.emitted[event].push(data);
    }

    join(room: string) {
        this.joinedRooms.push(room);
    }

    // Helper to trigger event
    trigger(event: string, ...args: any[]) {
        if (this.callbacks[event]) {
            this.callbacks[event](...args);
        }
    }
}

// Mock Server
class MockServer {
    sockets: any;
    rooms: Record<string, { emitted: Record<string, any[]> }> = {};

    constructor() {
        this.sockets = {
            sockets: new Map(),
            in: (room: string) => this.in(room)
        };
    }

    on(event: string, callback: Function) {
        // Connection listener
        if (event === 'connection') {
            this.connectionCallback = callback;
        }
    }

    connectionCallback: Function | null = null;

    // Helper to connect a socket
    connectSocket(socket: MockSocket) {
        if (this.connectionCallback) {
            this.connectionCallback(socket);
        }
    }

    to(room: string) {
        if (!this.rooms[room]) this.rooms[room] = { emitted: {} };
        return {
            emit: (event: string, data?: any) => {
                if (!this.rooms[room].emitted[event]) this.rooms[room].emitted[event] = [];
                this.rooms[room].emitted[event].push(data);
            },
            socketsLeave: (r: string) => {} 
        };
    }
    
    in(room: string) { return this.to(room); }
}

describe('GameManager', () => {
    let gameManager: GameManager;
    let mockServer: MockServer;

    beforeEach(() => {
        mockServer = new MockServer() as any;
        gameManager = new GameManager(mockServer as any);
    });

    test('createGame creates a new game', (done) => {
        const socket = new MockSocket('socket-1');
        mockServer.connectSocket(socket);

        socket.trigger('createGame', 'Player1', (response: any) => {
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

        host.trigger('createGame', 'Host', (res: any) => {
            gameCode = res.gameCode;
            
            const player2 = new MockSocket('p2');
            mockServer.connectSocket(player2);
            
            player2.trigger('joinGame', gameCode, 'Player2', undefined, (res2: any) => {
                expect(res2.success).toBe(true);
                // Check if host got update?
                // We can check mockServer.rooms[gameCode].emitted['playerJoined']
                // But GameManager emits 'playerJoined' to room.
                expect(mockServer.rooms[gameCode].emitted['playerJoined']).toBeDefined();
                done();
            });
        });
    });

    test('leaveGame triggers attrition win if < 2 players remain in started game', (done) => {
        // Setup: Create game, join p2, start game.
        const host = new MockSocket('host');
        mockServer.connectSocket(host);
        let gameCode: string;

        host.trigger('createGame', 'Host', (res: any) => {
            gameCode = res.gameCode;
            const p2 = new MockSocket('p2');
            mockServer.connectSocket(p2);
            
            p2.trigger('joinGame', gameCode, 'Player2', undefined, (res2: any) => {
                // Start Game
                host.trigger('startGame', gameCode, (resStart: any) => {
                    expect(resStart.success).toBe(true);
                    
                    // Now P2 leaves
                    p2.trigger('leaveGame', gameCode);
                    
                    // Expect 'gameEnded' event in room with winner info
                    const roomEmits = mockServer.rooms[gameCode].emitted['gameEnded'];
                    expect(roomEmits).toBeDefined();
                    const lastEmit = roomEmits[roomEmits.length - 1];
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

        host.trigger('createGame', 'Host', (res: any) => {
            gameCode = res.gameCode;
            const p2 = new MockSocket('p2');
            mockServer.connectSocket(p2);
            
            p2.trigger('joinGame', gameCode, 'Player2', undefined, (res2: any) => {
                // Do NOT start game
                
                // P2 leaves
                p2.trigger('leaveGame', gameCode);
                
                // Expect NO 'gameEnded' event
                const roomEmits = mockServer.rooms[gameCode].emitted['gameEnded'];
                expect(roomEmits).toBeUndefined();
                done();
            });
        });
    });
});
