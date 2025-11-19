'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, Card, Button, Form, Alert } from 'react-bootstrap';

export default function WatchGame() {
  const router = useRouter();
  const [gameCode, setGameCode] = useState('');
  const [error, setError] = useState('');

  const handleWatchGame = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!gameCode) {
      setError('Please enter a game code.');
      return;
    }

    // In a real application, this would involve a server call to check game existence.
    const gameExists = true; // Simulate game existence

    if (!gameExists) {
      setError('Game not found. Please check the game code.');
      return;
    }

    router.push(`/observer?code=${gameCode}`);
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="6">
          <Card className="text-center">
            <Card.Header as="h2">Watch Game</Card.Header>
            <Card.Body>
              <Form onSubmit={handleWatchGame}>
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

                {error && <Alert variant="danger">{error}</Alert>}

                <Button variant="info" size="lg" type="submit" className="w-100">
                  Watch Game
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
