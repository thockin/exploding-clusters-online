// Copyright 2025 Tim Hockin

'use client';

import { useEffect, Suspense, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, Card, ListGroup, Button, Modal, Form, InputGroup } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { GameState, SocketEvent } from '../../api';

function LobbyContent() {
  const router = useRouter();
  const { gameCode, playerName, playerId, gameState, socket, startGame, resetState, isLoading, isSpectator } = useSocket();
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [previousHostName, setPreviousHostName] = useState('');
  const [copyJoinFeedback, setCopyJoinFeedback] = useState(false);
  const [copyWatchFeedback, setCopyWatchFeedback] = useState(false);
  const previousGameOwnerIdRef = useRef<string | null>(gameState?.gameOwnerId || null);
  const hasRedirected = useRef(false);

  const handleLeaveGame = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.LeaveGame, gameCode);
    }
    setShowLeaveModal(false);
    resetState();
    router.push('/');
  };

  useEffect(() => {
    if (gameState?.gameOwnerId) {
      const prevId = previousGameOwnerIdRef.current;
      const currentId = gameState.gameOwnerId;

      if (prevId && prevId !== currentId && currentId === playerId) {
        // I have been promoted!
        const prevGameOwner = gameState.players.find(p => p.id === prevId);
        const name = prevGameOwner ? prevGameOwner.name : 'The previous host';
        setTimeout(() => {
          setPreviousHostName(name);
          setShowPromotionModal(true);
        }, 0);
      }
      previousGameOwnerIdRef.current = currentId;
    }
  }, [gameState?.gameOwnerId, playerId, gameState?.players]);

  useEffect(() => {
    // For spectators, playerName might be 'Spectator' or not set during reconnection
    // Don't redirect if we're still loading (reconnecting)
    if (isLoading) {
      return;
    }

    // For spectators, we only need gameCode and socket, not playerName
    const hasValidSession = isSpectator
      ? (gameCode && socket)
      : (gameCode && playerName && socket);

    if (!hasValidSession) {
      // Redirect to home immediately
      // (user is not reconnecting, they don't have a valid session)
      if (!hasRedirected.current) {
        hasRedirected.current = true;
        router.replace('/');
      }
      return;
    }

    if (gameState?.state === GameState.Started) {
      // Players get redirected to /game. Spectators might be handled by ObserverPage or go to /game.
      // If we are in ObserverPage, we might want to stay there?
      // But let's assume if we are a spectator, we check if we are already handling it?
      // Easiest: If I am a spectator, DO NOT redirect here. Let the parent (ObserverPage) or manual logic handle it.
      const isSpectator = !gameState.players.some(p => p.id === playerId);
      if (!isSpectator) {
        router.push('/game');
      }
    }
  }, [gameCode, playerName, gameState, router, socket, playerId, isLoading, isSpectator]);

  const handleStartGame = async () => {
    if (gameCode) {
      const response = await startGame(gameCode);
      if (!response.success) {
        console.error('Failed to start game:', response.error);
        // Optionally, display error to user
      }
    }
  };

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return '';
  };

  const handleCopyToClipboard = async (text: string, setFeedback: (value: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback(true);
      setTimeout(() => setFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Hide disconnected players in lobby to mimic 'removal', but they remain in state for reconnection
  const allPlayers = gameState?.players || [];
  const playersInLobby = allPlayers.filter(p => !p.isDisconnected);
  const spectatorsInLobby = gameState?.spectators.length || 0;
  const isGameOwner = gameState?.gameOwnerId === playerId;

  // Don't render anything if we don't have a valid session (will redirect)
  // For spectators, playerName might be 'Spectator' or not set during reconnection
  const hasValidSession = isSpectator
    ? (gameCode && socket)
    : (gameCode && playerName && socket);

  if (!hasValidSession || isLoading) {
    return null;
  }

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="8">
          <Card className="text-center">
            <Card.Header as="h2">Lobby - Game Code: {gameCode}</Card.Header>
            <Card.Body>
              <Row>
                <Col md="12">
                  <h5>Joined Users:</h5>
                  <ListGroup data-testid="lobby-player-list" className="mb-3 text-start">
                    {playersInLobby.length === 0 && <ListGroup.Item>No players yet.</ListGroup.Item>}
                    {playersInLobby.map((player) => (
                      <ListGroup.Item key={player.id} className={player.isDisconnected ? 'text-muted opacity-50' : ''}>
                        {player.name} {player.id === gameState?.gameOwnerId && '(Host)'} {player.isDisconnected && '(Disconnected)'}
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                  <p>Watching: {spectatorsInLobby} {spectatorsInLobby === 1 ? 'person' : 'people'}</p>
                  {isGameOwner && (
                    <Button
                      variant="danger"
                      size="lg"
                      onClick={handleStartGame}
                      disabled={playersInLobby.length < 2}
                    >
                      Start Game
                    </Button>
                  )}
                  {!isGameOwner && (
                    <p>Waiting for the game to start...</p>
                  )}

                  <hr />
                  <Button variant="secondary" onClick={() => setShowLeaveModal(true)}>
                    Leave Game
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {isGameOwner && (
        <Row className="justify-content-md-center mt-3">
          <Col md="8">
            <Row className="mb-3">
              <Col xs={4} sm={3} className="d-flex align-items-center">
                <Form.Label className="mb-0">Invite friends to play:</Form.Label>
              </Col>
              <Col>
                <InputGroup>
                  <Form.Control
                    type="text"
                    readOnly
                    value={gameCode ? `${getBaseUrl()}/join/${gameCode}` : ''}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => handleCopyToClipboard(`${getBaseUrl()}/join/${gameCode}`, setCopyJoinFeedback)}
                  >
                    {copyJoinFeedback ? 'Copied!' : 'Copy'}
                  </Button>
                </InputGroup>
              </Col>
            </Row>
            <Row>
              <Col xs={4} sm={3} className="d-flex align-items-center">
                <Form.Label className="mb-0">Invite friends to watch:</Form.Label>
              </Col>
              <Col>
                <InputGroup>
                  <Form.Control
                    type="text"
                    readOnly
                    value={gameCode ? `${getBaseUrl()}/watch/${gameCode}` : ''}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => handleCopyToClipboard(`${getBaseUrl()}/watch/${gameCode}`, setCopyWatchFeedback)}
                  >
                    {copyWatchFeedback ? 'Copied!' : 'Copy'}
                  </Button>
                </InputGroup>
              </Col>
            </Row>
          </Col>
        </Row>
      )}

      <Modal
        data-modalname="host-promotion"
        show={showPromotionModal}
        onHide={() => setShowPromotionModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title>You are now the game owner</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{previousHostName} left the game, so you have been randomly selected as the new game owner. Congratulations on your promotion!</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowPromotionModal(false)} autoFocus>
            Awesome!
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        data-modalname="leave-game"
        show={showLeaveModal}
        onHide={() => setShowLeaveModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title>Leave Game?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to leave this game?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowLeaveModal(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleLeaveGame} autoFocus>Leave Game</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}

export default function LobbyBase() {
  return (
    <Suspense fallback={<Container className="mt-5 text-center"><h2>Loading lobby...</h2></Container>}>
      <LobbyContent />
    </Suspense>
  );
}

