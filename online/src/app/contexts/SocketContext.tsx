'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Card } from '../game/deck';

export interface PlayerInfo {
  id: string;
  name: string;
  cards: number; // number of cards in hand
  isOut?: boolean;
  isDisconnected?: boolean;
}

interface GameState {
  gameCode: string;
  players: PlayerInfo[];
  spectators: { id: string; name: string }[]; // Assuming spectators might have names for future features
  state: 'lobby' | 'started' | 'ended';
  gameOwnerId: string;
  nonce: string;
  devMode: boolean;
  turnOrder: string[];
  currentTurnIndex: number;
  drawPileCount: number;
  discardPile: Card[];
  removedPileCount?: number; // New: number of cards in the removed pile
  debugCardsCount?: number;
  safeCardsCount?: number; // New: number of safe cards in the draw pile
  // Add other game state properties as they become relevant
}

interface SocketContextType {
  socket: Socket | null;
  gameCode: string | null;
  setGameCode: (code: string | null) => void;
  playerName: string | null;
  setPlayerName: (name: string | null) => void;
  playerId: string | null;
  myHand: any[]; // Using any[] for now, ideally Card[]
  setMyHand: (hand: any[]) => void;
  gameState: GameState | null;
  isLoading: boolean; // New: indicates if context is restoring session
  rejoinError: string | null;
  gameMessages: string[];
  gameEndData: { winner: string; reason: string } | null;
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
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myHand, setMyHand] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true); // Start loading
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [gameMessages, setGameMessages] = useState<string[]>([]);
  const [isSpectator, setIsSpectator] = useState(false);
  const [gameEndData, setGameEndData] = useState<{ winner: string; reason: string } | null>(null);

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
                socket.emit('watchGame', sCode, (response: { success: boolean; gameCode?: string; error?: string }) => {
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
                socket.emit('joinGame', sCode, sName, sNonce, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }) => {
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
      socket?.emit('createGame', pName, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string }) => {
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
      socket?.emit('joinGame', gCode, pName, clientNonce, (response: { success: boolean; gameCode?: string; playerId?: string; error?: string; nonce?: string }) => {
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
      socket?.emit('watchGame', gCode, (response: { success: boolean; gameCode?: string; error?: string }) => {
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
      socket?.emit('startGame', gCode, (response: { success: boolean; error?: string }) => {
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
    sessionStorage.removeItem('exploding_session');
    // Optionally disconnect socket to ensure server cleans up connection-based state
    // socket?.disconnect();
    // socket?.connect(); 
  }, []);

  useEffect(() => {
    const socketIo = io();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setSocket(socketIo);

    socketIo.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    socketIo.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setGameState(null);
      setGameCode(null);
      setPlayerName(null);
    });

    socketIo.on('gameUpdate', (data: { 
      gameCode: string; 
      nonce: string; 
      players: PlayerInfo[]; 
      state: 'lobby' | 'started' | 'ended'; 
      gameOwnerId: string; 
      spectators: { id: string; name: string }[]; 
      devMode: boolean;
      turnOrder: string[];
      currentTurnIndex: number;
      drawPileCount: number;
      discardPile: Card[];
      removedPileCount?: number; // New: number of cards in the removed pile
      debugCardsCount?: number;
      safeCardsCount?: number; // New: number of safe cards in the draw pile
    }) => {
      setGameState(() => {
        const newState: GameState = {
          gameCode: data.gameCode,
          players: data.players,
          spectators: data.spectators || [],
          state: data.state,
          gameOwnerId: data.gameOwnerId,
          nonce: data.nonce,
          devMode: data.devMode,
          turnOrder: data.turnOrder || [],
          currentTurnIndex: data.currentTurnIndex || 0,
          drawPileCount: data.drawPileCount || 0,
          discardPile: data.discardPile || [],
          removedPileCount: data.removedPileCount || 0, // Set new removed pile count
          debugCardsCount: data.debugCardsCount,
          safeCardsCount: data.safeCardsCount // Set new safe cards count
        };
        return newState;
      });
      // Also sync the separate gameCode state if it's not set (e.g. refresh or late join)
      setGameCode(prev => prev || data.gameCode); 
    });

    socketIo.on('gameMessage', (data: { message: string }) => {
      setGameMessages(prev => [...prev, data.message]);
    });

    socketIo.on('handUpdate', (data: { hand: Card[] }) => {
      setMyHand(data.hand);
    });

    socketIo.on('playerJoined', (data: { playerId: string; playerName: string }) => {
      setGameState(prev => {
        if (!prev) return null;
        if (prev.players.some(p => p.id === data.playerId)) {
            return prev;
        }
        const newPlayers = [...prev.players, { id: data.playerId, name: data.playerName, cards: 0 }];
        return { ...prev, players: newPlayers };
      });
    });

    socketIo.on('playerDisconnected', (data: { playerId: string }) => {
      setGameState(prev => {
        if (!prev) return null;
        const newPlayers = prev.players.map(p => 
          p.id === data.playerId ? { ...p, isDisconnected: true } : p
        );
        return { ...prev, players: newPlayers };
      });
    });

    socketIo.on('gameStarted', () => {
      setGameState(prev => ({
        ...(prev as GameState),
        state: 'started',
      }));
    });

    socketIo.on('gameEnded', (data?: { winner: string; reason: string }) => {
      console.log('Game ended.', data);
      if (data) {
          setGameEndData(data);
      }
      setGameState(null);
      setGameCode(null);
      setPlayerName(null);
      sessionStorage.removeItem('exploding_session');
    });

    socketIo.on('error', (message: string) => {
      console.error('Server error:', message);
      // Optionally, display this error to the user
    });

    return () => {
      socketIo.off('connect');
      socketIo.off('disconnect');
      socketIo.off('gameUpdate');
      socketIo.off('gameMessage');
      socketIo.off('handUpdate');
      socketIo.off('playerJoined');
      socketIo.off('playerDisconnected');
      socketIo.off('gameStarted');
      socketIo.off('gameEnded');
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