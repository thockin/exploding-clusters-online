'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Row, Col, Card, ListGroup, Alert } from 'react-bootstrap';

function ObserverScreenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameCode = searchParams.get('code');
  const [drawPileCount, setDrawPileCount] = useState(20); // Simulate draw pile
  const [discardPile, setDiscardPile] = useState<string[]>(['Defuse']); // Simulate discard pile
  const [players, setPlayers] = useState<{ name: string; cardCount: number; isCurrent: boolean }[]>([
    { name: 'Player 1', cardCount: 5, isCurrent: true },
    { name: 'Player 2', cardCount: 4, isCurrent: false },
    { name: 'Player 3', cardCount: 5, isCurrent: false },
  ]);

  useEffect(() => {
    if (!gameCode) {
      router.push('/'); // Redirect if no game code
      return;
    }
    // In a real app, this would connect to the Socket.IO server
    // and receive real-time game state updates for observation.
  }, [gameCode, router]);

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="8">
          <Card className="text-center">
            <Card.Header as="h2">Observer Mode - Game Code: {gameCode}</Card.Header>
            <Card.Body>
              <Row>
                <Col md="4">
                  <h5>Draw Pile:</h5>
                  <p className="h3">{drawPileCount} cards</p>
                </Col>
                <Col md="4">
                  <h5>Discard Pile:</h5>
                  {discardPile.length > 0 ? (
                    <p className="h3">{discardPile[discardPile.length - 1]}</p>
                  ) : (
                    <p className="h3">Empty</p>
                  )}
                </Col>
                <Col md="4">
                  <h5>Players:</h5>
                  <ListGroup className="text-start">
                    {players.map((player, index) => (
                      <ListGroup.Item key={index} variant={player.isCurrent ? 'primary' : ''}>
                        {player.name} ({player.cardCount} cards) {player.isCurrent && '(Current)'}
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default function ObserverScreen() {
  return (
    <Suspense fallback={<div>Loading observer screen...</div>}>
      <ObserverScreenContent />
    </Suspense>
  );
}
