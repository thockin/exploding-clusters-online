// Copyright 2025 Tim Hockin

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Button, Container, Row, Col, Card, Form, Alert, Modal } from 'react-bootstrap';
import { useSocket } from './contexts/SocketContext';
import { GameState } from '../api';
import { validatePlayerName } from '../utils/nameValidation';

type FileMode = 'initial' | 'create' | 'join' | 'watch';

export default function Home() {
  const router = useRouter();
  const { createGame, joinGame, watchGame, gameCode, setGameCode, playerName, setPlayerName, gameState, socket, playerId, isLoading, rejoinError, resetState } = useSocket();

  const [inputGameCode, setInputGameCode] = useState('');
  const [inputPlayerName, setInputPlayerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [mode, setMode] = useState<FileMode>('initial');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasProcessedUrlAction = useRef(false);

  // Check for action parameter in URL (from /join route) and open join dialog
  useEffect(() => {
    // Wait for loading to complete before processing URL
    if (isLoading) return;

    // Only process once on mount
    if (hasProcessedUrlAction.current) return;

    // Read from URL directly to avoid useSearchParams re-render issues
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlGameCode = params.get('gameCode');
      const action = params.get('action'); // 'join' (watch is handled by /watch route)

      // Only process if we have both gameCode and action=join
      if (urlGameCode && action === 'join' && mode === 'initial') {
        hasProcessedUrlAction.current = true;
        setInputGameCode(urlGameCode.toUpperCase());
        setMode('join');

        // Focus the name field after a short delay to ensure modal is rendered
        setTimeout(() => {
          nameInputRef.current?.focus();
        }, 100);
      }
    }
  }, [mode, isLoading]);

  useEffect(() => {
    // Don't redirect if we're still loading
    if (isLoading) return;

    // Only prevent redirect in join mode if we don't have all the data yet (user is still filling form)
    // If we have all the data, allow redirect even in join mode (join was successful)
    // Watch mode redirects directly in handleWatchGame, so we don't need to handle it here
    const hasAllData = gameCode && playerName && gameState && socket && playerId;
    if (mode === 'join' && !hasAllData) {
      return; // Stay on page to allow user to join
    }

    if (hasAllData) {
      if (gameState.state === GameState.Lobby) {
        router.push('/lobby');
      } else if (gameState.state === GameState.Started) {
        router.push('/game');
      }
    }
  }, [gameCode, playerName, gameState, router, socket, playerId, mode, isLoading]);

  if (isLoading) {
    return <Container className="mt-5 text-center"><h2>Loading session...</h2></Container>;
  }

  const handleRejoinErrorClose = () => {
    resetState(); // Clears error and session storage
  };

  const handleCreateGame = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let success = false;
    try {
      if (!inputPlayerName) {
        setError('Please enter your name to create a game.');
        return;
      }

      // Client-side validation
      const validation = validatePlayerName(inputPlayerName);
      if (!validation.isValid) {
        setNameError(validation.error || 'Invalid name');
        setError(validation.error || 'Invalid name');
        return;
      }

      setNameError(null);
      setError(null);
      const response = await createGame(inputPlayerName);
      success = response.success;
      if (response.success && response.gameCode) {
        setGameCode(response.gameCode);
        // Navigation handled by useEffect
      } else {
        setError(response.error || 'Failed to create game.');
      }
    } finally {
      if (!success) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleJoinGame = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let success = false;
    try {
      if (!inputGameCode || !inputPlayerName) {
        setError('Please enter game code and your name to join.');
        return;
      }

      // Client-side validation
      const validation = validatePlayerName(inputPlayerName);
      if (!validation.isValid) {
        setNameError(validation.error || 'Invalid name');
        setError(validation.error || 'Invalid name');
        return;
      }

      setNameError(null);
      setError(null);
      const response = await joinGame(inputGameCode, inputPlayerName);
      success = response.success;
      if (response.success && response.gameCode) {
        setGameCode(response.gameCode);
        // Navigation handled by useEffect
      } else {
        setError(response.error || 'Failed to join game.');
      }
    } finally {
      if (!success) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleWatchGame = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let success = false;
    try {
      if (!inputGameCode) {
        setError('Please enter a game code to watch.');
        return;
      }
      setError(null);
      const response = await watchGame(inputGameCode);
      success = response.success;
      if (response.success && response.gameCode) {
        setGameCode(response.gameCode);
        setPlayerName('Spectator'); // Ensure session saves
        router.push('/observer');
      } else {
        setError(response.error || 'Failed to watch game.');
      }
    } finally {
      if (!success) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleCloseModal = () => {
    setMode('initial');
    setError(null);
    setNameError(null);
    setInputGameCode('');
    // Clear URL query parameters when closing modal
    if (typeof window !== 'undefined') {
      router.replace('/', { scroll: false });
    }
    // Keep inputPlayerName if they entered it for convenience?
  };

  const handlePlayerNameChange = (value: string) => {
    setInputPlayerName(value);
    // Clear name error when user starts typing
    if (nameError) {
      setNameError(null);
    }
    // Real-time validation feedback (optional - can be removed if too aggressive)
    if (value.trim().length > 0) {
      const validation = validatePlayerName(value);
      if (!validation.isValid) {
        setNameError(validation.error || 'Invalid name');
      }
    }
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="6">
          <Card className="text-center">
            <Card.Header as="h2">Exploding Clusters</Card.Header>
            <Card.Body>
              {error && <Alert variant="danger">{error}</Alert>}
              <Button variant="primary" size="lg" className="mb-3 w-100" onClick={() => setMode('create')}>
                Create a new game
              </Button>
              <Button variant="success" size="lg" className="mb-3 w-100" onClick={() => setMode('join')}>
                Join a game
              </Button>
              <Button variant="info" size="lg" className="w-100" onClick={() => setMode('watch')}>
                Watch a game
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Create Game Modal */}
      <Modal
        show={mode === 'create'}
        onHide={handleCloseModal}
        data-modalname="create-game"
        backdrop="static"
      >
        <Modal.Header closeButton>
          <Modal.Title>Create a new game</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form id="create-game-form" onSubmit={(e) => { e.preventDefault(); handleCreateGame(); }}>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="create-game-player-name">Your Name</Form.Label>
              <Form.Control
                type="text"
                id="create-game-player-name"
                placeholder="Enter your name (max 32 characters)"
                value={inputPlayerName}
                onChange={(e) => handlePlayerNameChange(e.target.value)}
                maxLength={32}
                isInvalid={!!nameError}
                autoFocus
              />
              {nameError && <Form.Control.Feedback type="invalid">{nameError}</Form.Control.Feedback>}
              <Form.Text className="text-muted">
                {inputPlayerName.length}/32 characters
              </Form.Text>
            </Form.Group>
          </Form>
          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>Cancel</Button>
          <Button type="submit" form="create-game-form" variant="primary" disabled={isSubmitting}>Create Game</Button>
        </Modal.Footer>
      </Modal>

      {/* Join Game Modal */}
      <Modal
        data-modalname="join-game"
        show={mode === 'join'}
        onHide={handleCloseModal}
        backdrop="static"
      >
        <Modal.Header closeButton>
          <Modal.Title>Join a game</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form id="join-game-form" onSubmit={(e) => { e.preventDefault(); handleJoinGame(); }}>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="join-game-code">Game Code</Form.Label>
              <Form.Control
                type="text"
                id="join-game-code"
                placeholder="Enter 5-letter game code"
                value={inputGameCode}
                onChange={(e) => setInputGameCode(e.target.value.toUpperCase())}
                maxLength={5}
                autoFocus
                autoComplete="off"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="join-game-player-name">Your Name</Form.Label>
              <Form.Control
                ref={nameInputRef}
                type="text"
                id="join-game-player-name"
                placeholder="Enter your name (max 32 characters)"
                value={inputPlayerName}
                onChange={(e) => handlePlayerNameChange(e.target.value)}
                maxLength={32}
                isInvalid={!!nameError}
              />
              {nameError && <Form.Control.Feedback type="invalid">{nameError}</Form.Control.Feedback>}
              <Form.Text className="text-muted">
                {inputPlayerName.length}/32 characters
              </Form.Text>
            </Form.Group>
          </Form>
          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>Cancel</Button>
          <Button type="submit" form="join-game-form" variant="primary" disabled={isSubmitting}>Join Game</Button>
        </Modal.Footer>
      </Modal>

      {/* Watch Game Modal */}
      <Modal
        data-modalname="watch-game"
        show={mode === 'watch'}
        onHide={handleCloseModal}
        backdrop="static"
      >
        <Modal.Header closeButton>
          <Modal.Title>Watch a game</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form id="watch-game-form" onSubmit={(e) => { e.preventDefault(); handleWatchGame(); }}>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="watch-game-code">Game Code</Form.Label>
              <Form.Control
                type="text"
                id="watch-game-code"
                placeholder="Enter 5-letter game code"
                value={inputGameCode}
                onChange={(e) => setInputGameCode(e.target.value.toUpperCase())}
                maxLength={5}
                autoFocus
                autoComplete="off"
              />
            </Form.Group>
          </Form>
          {error && <Alert variant="danger">{error}</Alert>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>Cancel</Button>
          <Button type="submit" form="watch-game-form" variant="info" disabled={isSubmitting}>Watch Game</Button>
        </Modal.Footer>
      </Modal>

      {/* Rejoin Error Modal */}
      <Modal
        data-modalname="rejoin-error"
        show={!!rejoinError}
        onHide={handleRejoinErrorClose}
        backdrop="static"
        keyboard={false}
      >
        <Modal.Header>
          <Modal.Title>Sorry!</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>The game has changed or ended since you left. Rejoining it is not possible.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={handleRejoinErrorClose} autoFocus>OK</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
