'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Modal, Button } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import LobbyBase from '../components/LobbyBase';
import GameScreen from '../game/page';
import { GameState } from '../../api';

export default function ObserverPage() {
  const router = useRouter();
  const { gameState, gameCode, isLoading, gameEndData, resetState } = useSocket();

  useEffect(() => {
    if (!gameState && !isLoading && !gameCode && !gameEndData) {
      router.push('/');
    }
  }, [gameState, isLoading, gameCode, router, gameEndData]);

  const handleGameEndConfirm = useCallback(() => {
    resetState();
    router.push('/');
  }, [resetState, router]);

  if (!gameState) {
    if (gameEndData) {
      return (
        <Container className="d-flex align-items-center justify-content-center" style={{ height: '100vh' }}>
          <Modal show={true} onHide={handleGameEndConfirm} backdrop="static" keyboard={false} centered>
            <Modal.Header>
              <Modal.Title>{gameEndData.winner} wins!</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <p>Winning by attrition is still winning.</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onClick={handleGameEndConfirm} autoFocus>OK</Button>
            </Modal.Footer>
          </Modal>
        </Container>
      );
    }
    return <Container className="mt-5 text-center"><h2>Loading observer...</h2></Container>;
  }

  if (gameState.state === GameState.Lobby) {
    return <LobbyBase />;
  } else if (gameState.state === GameState.Started) {
    // GameScreen internally checks for spectator status to adjust UI
    return <GameScreen />;
  } else if (gameState.state === GameState.Ended) {
    return <Container className="mt-5 text-center"><h2>Game Ended</h2></Container>;
  }

  return <Container className="mt-5 text-center"><h2>Unknown Game State</h2></Container>;
}
