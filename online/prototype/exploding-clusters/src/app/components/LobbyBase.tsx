'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Row, Col, Card, ListGroup, Form, Button, InputGroup } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';

interface Message {
  author: string;
  message: string;
}

interface LobbyBaseProps {
  isHost: boolean;
}

function LobbyContent({ isHost }: LobbyBaseProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameCode = searchParams.get('code');
  const playerName = searchParams.get('name');
  const socket = useSocket();

  const [players, setPlayers] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [observers, setObservers] = useState(0);

  useEffect(() => {
    if (!socket || !gameCode || !playerName) return;

    socket.emit('join-game', { gameCode, playerName });

    socket.on('update-players', ({ playerList }: { playerList: string[] }) => {
      setPlayers(playerList);
    });

    socket.on('update-messages', (messageList: Message[]) => {
      setMessages(messageList);
    });

    socket.on('game-started', () => {
      const dbg = searchParams.get('dbg');
      const dbgQuery = dbg === '1' ? '&dbg=1' : '';
      router.push(`/your-hand?code=${gameCode}${dbgQuery}`);
    });

    return () => {
      socket.off('update-players');
      socket.off('update-messages');
      socket.off('game-started');
    };
  }, [socket, gameCode, playerName, router]);

  const handleStartGame = () => {
    if (socket && gameCode) {
      socket.emit('start-game', gameCode);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() && socket && playerName) {
      const message = { author: playerName, message: newMessage };
      socket.emit('send-message', { gameCode, message });
      setNewMessage('');
    }
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-md-center">
        <Col md="8">
          <Card className="text-center">
            <Card.Header as="h2">Lobby - Game Code: {gameCode}</Card.Header>
            <Card.Body>
              <Row>
                <Col md="6">
                  <h5>Joined Users:</h5>
                  <ListGroup className="mb-3 text-start">
                    {players.map((player, index) => (
                      <ListGroup.Item key={index}>{player}</ListGroup.Item>
                    ))}
                  </ListGroup>
                  <p>Watching: {observers} {observers === 1 ? 'person' : 'people'}</p>
                  {isHost && (
                    <Button
                      variant="danger"
                      size="lg"
                      onClick={handleStartGame}
                      disabled={players.length < 2}
                    >
                      Start Game
                    </Button>
                  )}
                </Col>
                <Col md="6">
                  <h5>Chat:</h5>
                  <div className="chat-window border p-2 mb-3" style={{ height: '200px', overflowY: 'scroll', textAlign: 'left' }}>
                    {messages.map((msg, index) => (
                      <div key={index}><strong>{msg.author}:</strong> {msg.message}</div>
                    ))}
                  </div>
                  <Form onSubmit={handleSendMessage}>
                    <InputGroup className="mb-3">
                      <Form.Control
                        placeholder="Type your message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                      />
                      <Button variant="primary" type="submit">
                        Send
                      </Button>
                    </InputGroup>
                  </Form>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default function LobbyBase({ isHost }: LobbyBaseProps) {
  return (
    <Suspense fallback={<div>Loading lobby...</div>}>
      <LobbyContent isHost={isHost} />
    </Suspense>
  );
}
