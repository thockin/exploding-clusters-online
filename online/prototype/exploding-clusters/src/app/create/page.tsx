'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Row, Col, Card, Button, Form } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';

export default function CreateGame() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const socket = useSocket();
  const [playerName, setPlayerName] = useState('');
  const [dbg, setDbg] = useState(false);

  useEffect(() => {
    const dbgParam = searchParams.get('dbg');
    if (dbgParam === '1') {
      setDbg(true);
    }
  }, [searchParams]);

  const handleCreateGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) {
      return;
    }
    const newGameCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    if (socket) {
      socket.emit('create-game', { gameCode: newGameCode, dbg });
    }
    const dbgQuery = dbg ? '&dbg=1' : '';
    router.push(`/host-lobby?code=${newGameCode}&name=${playerName}${dbgQuery}`);
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="6">
          <Card className="text-center">
            <Card.Header as="h2">Create New Game</Card.Header>
            <Card.Body>
              <Form onSubmit={handleCreateGame}>
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
                <Button variant="primary" size="lg" type="submit" className="w-100">
                  Create Game
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
