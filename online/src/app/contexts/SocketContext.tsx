'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Card, GameUpdatePayload, GameState, SocketEvent, WinType } from '../../api';

interface SocketContextType {
  socket: Socket | null;
  gameCode: string | null;
  setGameCode: (code: string | null) => void;
  playerName: string | null;
  setPlayerName: (name: string | null) => void;
  playerId: string | null;
  myHand: Card[]; // Using Card[]
  setMyHand: React.Dispatch<React.SetStateAction<Card[]>>;
  gameState: GameUpdatePayload | null;
  isLoading: boolean; // New: indicates if context is restoring session
  rejoinError: string | null;
  gameMessages: string[];
  gameEndData: { winner: string; winType: WinType } | null;
  createGame: (playerName: string) => Promise<{ success: boolean; gameCode?: string; playerId?: string; error?: string }>;
  joinGame: (gameCode: string, playerName: string, clientNonce?: string) => Promise<{ success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }>;
  watchGame: (gameCode: string) => Promise<{ success: boolean; gameCode?: string; error?: string }>;
  startGame: (gameCode: string) => Promise<{ success: boolean; error?: string }>;
  resetState: () => void;
}

const SocketContext = createContext<SocketContextType | null>(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameUpdatePayload | null>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true); // Start loading
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [gameMessages, setGameMessages] = useState<string[]>([]);
  const [isSpectator, setIsSpectator] = useState(false);
  const [gameEndData, setGameEndData] = useState<{ winner: string; winType: WinType } | null>(null);

  // Restore session on mount/connect
  useEffect(() => {
    if (!socket) return;

    const restoreSession = async () => {
      const stored = sessionStorage.getItem('exploding_session');
      if (stored) {
        try {
          const { gameCode: sCode, playerName: sName, nonce: sNonce, playerId: sId, isSpectator: sIsSpectator } = JSON.parse(stored);
          if (sCode) {

            // Check if explicit spectator flag OR legacy "Spectator" name
            if (sIsSpectator || sName === 'Spectator') {
              // Restore spectator session
              socket.emit(SocketEvent.WatchGame, sCode, (response: { success: boolean; gameCode?: string; error?: string }) => {
                if (response.success && response.gameCode) {
                  setGameCode(response.gameCode);
                  setPlayerName('Spectator');
                  setIsSpectator(true);
                  // gameState will be updated by gameUpdate event
                } else {
                  sessionStorage.removeItem('exploding_session');
                }
                setIsLoading(false);
              });
            } else if (sName && sNonce) {
              // Restore player session
              socket.emit(SocketEvent.JoinGame, sCode, sName, sNonce, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }) => {
                if (response.success && response.gameCode) {
                  setGameCode(response.gameCode);
                  setPlayerName(sName);
                  setPlayerId(response.playerId || sId); // Prefer server response, fallback to stored
                  setIsSpectator(false);
                  // gameState will be updated by gameUpdate event
                } else {
                  sessionStorage.removeItem('exploding_session');
                  // Only set error if it's NOT a "game does not exist" error
                  if (response.error && !response.error.includes('does not exist')) {
                    setRejoinError("Sorry, the game has changed since you left. Rejoining is not possible.");
                  }
                }
                setIsLoading(false);
              });
            } else {
              setIsLoading(false);
            }
            return; // Wait for emit callback
          }
        } catch (e) {
          console.error('Error parsing session storage', e);
          sessionStorage.removeItem('exploding_session');
        }
      }
      setIsLoading(false); // No session or invalid
    };

    if (socket.connected) {
      restoreSession();
    } else {
      socket.once('connect', restoreSession);
    }

    return () => {
      socket.off('connect', restoreSession);
    };
  }, [socket]);

  // Save session on state change
  useEffect(() => {
    if (gameCode && gameState?.nonce && (playerName || isSpectator)) {
      const sessionData = {
        gameCode,
        playerName,
        playerId,
        nonce: gameState.nonce,
        isSpectator
      };
      sessionStorage.setItem('exploding_session', JSON.stringify(sessionData));
    }
  }, [gameCode, playerName, playerId, gameState?.nonce, isSpectator]);


  const createGame = useCallback(async (pName: string) => {
    return new Promise<{ success: boolean; gameCode?: string; playerId?: string; error?: string }>((resolve) => {
      socket?.emit(SocketEvent.CreateGame, pName, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => {
        if (response.success && response.gameCode && response.playerId) {
          setGameCode(response.gameCode);
          setPlayerName(pName);
          setPlayerId(response.playerId);
          setIsSpectator(false);
        }
        resolve(response);
      });
    });
  }, [socket]);

  const joinGame = useCallback(async (gCode: string, pName: string, clientNonce?: string) => {
    return new Promise<{ success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }>((resolve) => {
      socket?.emit(SocketEvent.JoinGame, gCode, pName, clientNonce, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }) => {
        if (response.success && response.gameCode && response.playerId) {
          setGameCode(response.gameCode);
          setPlayerName(pName);
          setPlayerId(response.playerId);
          setIsSpectator(false);
        }
        resolve(response);
      });
    });
  }, [socket]);

  const watchGame = useCallback(async (gCode: string) => {
    return new Promise<{ success: boolean; gameCode?: string; error?: string }>((resolve) => {
      socket?.emit(SocketEvent.WatchGame, gCode, (response: { success: boolean; gameCode?: string; error?: string }) => {
        if (response.success && response.gameCode) {
          setGameCode(response.gameCode);
          setPlayerName('Spectator');
          setIsSpectator(true);
        }
        resolve(response);
      });
    });
  }, [socket]);

  const startGame = useCallback(async (gCode: string) => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      socket?.emit(SocketEvent.StartGame, gCode, (response: { success: boolean; error?: string }) => {
        resolve(response);
      });
    });
  }, [socket]);

  const resetState = useCallback(() => {
    setGameCode(null);
    setPlayerName(null);
    setPlayerId(null);
    setGameState(null);
    setMyHand([]);
    setIsLoading(false);
    setRejoinError(null);
    setGameEndData(null);
    setGameMessages([]); // Clear messages on reset
    sessionStorage.removeItem('exploding_session');
    // Optionally disconnect socket to ensure server cleans up connection-based state
    // socket?.disconnect();
    // socket?.connect(); 
  }, []);

  useEffect(() => {
    const socketIo = io();
    setTimeout(() => {
      setSocket(socketIo);
    }, 0);


    socketIo.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    socketIo.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setGameState(null);
      setGameCode(null);
      setPlayerName(null);
    });

    socketIo.on(SocketEvent.GameUpdate, (data: GameUpdatePayload) => {
      console.debug(`received event: ${SocketEvent.GameUpdate}`);
      setGameState(() => {
        // We can just use data directly as it matches the interface
        return data;
      });
      // Also sync the separate gameCode state if it's not set (e.g. refresh or late join)
      setGameCode(prev => prev || data.gameCode); 
    });

    socketIo.on(SocketEvent.GameMessage, (data: { message: string }) => {
      console.debug(`received event: ${SocketEvent.GameMessage}`);
      setGameMessages(prev => [...prev, data.message]);
    });

    socketIo.on(SocketEvent.HandUpdate, (data: { hand: Card[] }) => {
      console.debug(`received event: ${SocketEvent.HandUpdate}`);
      setMyHand(data.hand);
    });

    socketIo.on(SocketEvent.PlayerJoined, (data: { playerId: string; playerName: string }) => {
      console.debug(`received event: ${SocketEvent.PlayerJoined}`);
      setGameState(prev => {
        if (!prev) return null;
        if (prev.players.some(p => p.id === data.playerId)) {
          return prev;
        }
        const newPlayers = [...prev.players, { id: data.playerId, name: data.playerName, cards: 0 }];
        return { ...prev, players: newPlayers };
      });
    });

    socketIo.on(SocketEvent.PlayerDisconnected, (data: { playerId: string }) => {
      console.debug(`received event: ${SocketEvent.PlayerDisconnected}`);
      setGameState(prev => {
        if (!prev) return null;
        const newPlayers = prev.players.map(p => 
          p.id === data.playerId ? { ...p, isDisconnected: true } : p
        );
        return { ...prev, players: newPlayers };
      });
    });

    socketIo.on(SocketEvent.GameStarted, () => {
      console.debug(`received event: ${SocketEvent.GameStarted}`);
      setGameState(prev => ({
        ...(prev as GameUpdatePayload),
        state: GameState.Started,
      }));
    });

    socketIo.on(SocketEvent.GameEnded, (data?: { winner: string; winType: string }) => {
      console.debug(`received event: ${SocketEvent.GameEnded}`);
      console.log('Game ended.', data);
      if (data) {
        setGameEndData(data);
      }
      // setGameState(null); // Keep game state visible
    });

    socketIo.on('error', (message: string) => {
      console.error('Server error:', message);
      // Optionally, display this error to the user
    });

    return () => {
      socketIo.off('connect');
      socketIo.off('disconnect');
      socketIo.off(SocketEvent.GameUpdate);
      socketIo.off(SocketEvent.GameMessage);
      socketIo.off(SocketEvent.HandUpdate);
      socketIo.off(SocketEvent.PlayerJoined);
      socketIo.off(SocketEvent.PlayerDisconnected);
      socketIo.off(SocketEvent.GameStarted);
      socketIo.off(SocketEvent.GameEnded);
      socketIo.off('error');
      socketIo.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{
      socket,
      gameCode,
      setGameCode,
      playerName,
      setPlayerName,
      playerId,
      myHand,
      setMyHand,
      gameState,
      isLoading,
      rejoinError,
      gameMessages,
      gameEndData,
      createGame,
      joinGame,
      watchGame,
      startGame,
      resetState,
    }}>{
        children
      }</SocketContext.Provider>
  );
};
