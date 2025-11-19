'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Row, Col, Card, Button, Form, Alert } from 'react-bootstrap';

export default function JoinGame() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [gameCode, setGameCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [dbgQuery, setDbgQuery] = useState('');

  useEffect(() => {
    const dbg = searchParams.get('dbg');
    if (dbg === '1') {
      setDbgQuery('&dbg=1');
    }
  }, [searchParams]);

  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!gameCode || !playerName) {
      setError('Please enter both a game code and your name.');
      return;
    }

    // In a real application, this would involve a server call to check game existence and capacity.
    // For now, we'll simulate success.
    const gameExists = true; // Simulate game existence
    const gameFull = false; // Simulate game not full

    if (!gameExists) {
      setError('Game not found. Please check the game code.');
      return;
    }

    if (gameFull) {
      setError('Sorry, the game is full.');
      return;
    }

    router.push(`/player-lobby?code=${gameCode}&name=${playerName}${dbgQuery}`);
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="6">
          <Card className="text-center">
            <Card.Header as="h2">Join Game</Card.Header>
            <Card.Body>
              <Form onSubmit={handleJoinGame}>
                <Form.Group className="mb-3" controlId="formGameCode">
                  <Form.Label>Game Code</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Enter 4-letter game code"
                    value={gameCode}
                    onChange={(e) => setGameCode(e.target.value.toUpperCase())}
                    maxLength={4}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3" controlId="formPlayerName">
                  <Form.Label>Your Name</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Enter your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    required
                  />
                </Form.Group>

                {error && <Alert variant="danger">{error}</Alert>}

                <Button variant="success" size="lg" type="submit" className="w-100">
                  Join Game
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
