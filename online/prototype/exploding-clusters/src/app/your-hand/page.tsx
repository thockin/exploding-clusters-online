'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Container, Row, Col, ListGroup, Button, Modal, Form } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { Card as CardType } from '../game/deck';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';

interface PlayerState {
  id: string;
  name: string;
  hand: CardType[] | number;
  isExploded: boolean;
}

interface GameState {
  players: PlayerState[];
  drawPile: number;
  discardPile: CardType[];
  currentPlayerIndex: number;
  debuggingPlayerId: string | null;
  reactionTimerEndTime: number | null;
  gameLog: string[];
}

export default function YourHandContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameCode = searchParams.get('code');
  const socket = useSocket();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [overlayCard, setOverlayCard] = useState<CardType | null>(null);
  const [explodingCard, setExplodingCard] = useState<CardType | null>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [reinsertPosition, setReinsertPosition] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  const [isClient, setIsClient] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [gameState?.gameLog]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!gameState?.reactionTimerEndTime) {
      setCountdown(null);
      return;
    }
    const interval = setInterval(() => {
      const endTime = gameState.reactionTimerEndTime!;
      const remaining = Math.ceil((endTime - Date.now()) / 1000);
      if (remaining > 0) {
        setCountdown(remaining);
      } else {
        setCountdown(null);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [gameState?.reactionTimerEndTime]);

  useEffect(() => {
    if (!socket || !gameCode) return;

    socket.on('game-state', (state: GameState) => {
      setGameState(state);
      if (state.debuggingPlayerId === null) {
        setExplodingCard(null);
      }
    });

    socket.on('player-exploding', ({ card }: { card: CardType }) => {
      setExplodingCard(card);
    });

    socket.on('debug-successful', () => {
      setShowDebugModal(true);
    });

    socket.on('game-over', ({ winnerName }: { winnerName: string }) => {
      setWinner(winnerName);
    });

    socket.emit('request-game-state', gameCode);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOverlayCard(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      socket.off('game-state');
      socket.off('player-exploding');
      socket.off('debug-successful');
      socket.off('game-over');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [socket, gameCode]);

  const handleCardClick = (card: CardType) => {
    setSelectedCard(selectedCard?.id === card.id ? null : card);
  };

  const handleCardDoubleClick = (card: CardType) => {
    setOverlayCard(card);
  };

  const handleDrawCard = () => {
    if (socket && gameState && !(gameState.debuggingPlayerId === socket.id)) {
      const me = gameState.players.find(p => p.id === socket.id);
      if (me && gameState.players[gameState.currentPlayerIndex].id === me.id) {
        socket.emit('draw-card', { gameCode });
      }
    }
  };

  const handleReinsertCard = () => {
    if (socket && explodingCard) {
      socket.emit('reinsert-exploding-cluster', { gameCode, position: reinsertPosition, card: explodingCard });
      setShowDebugModal(false);
      setExplodingCard(null);
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;

    const currentGameState = gameStateRef.current;
    if (!currentGameState) return;

    const me = currentGameState.players.find(p => p.id === socket?.id);
    if (!me || !Array.isArray(me.hand)) return;

    if (source.droppableId === 'hand' && destination.droppableId === 'hand') {
      const newHand = Array.from(me.hand);
      const [reorderedItem] = newHand.splice(source.index, 1);
      newHand.splice(destination.index, 0, reorderedItem);
      setGameState(prevState => ({ ...prevState!, players: prevState!.players.map(p => p.id === socket?.id ? { ...p, hand: newHand } : p) }));
      socket.emit('reorder-hand', { gameCode, newHand });
      return;
    }

    if (destination.droppableId === 'discard-pile') {
      const card = me.hand[source.index];
      const amDebugging = currentGameState.debuggingPlayerId === socket?.id;
      const myTurn = me.id === currentGameState.players[currentGameState.currentPlayerIndex].id;
      const isReactionWindow = currentGameState.reactionTimerEndTime !== null && Date.now() < currentGameState.reactionTimerEndTime;

      let isValidPlay = false;
      if (amDebugging && card.type === 'Debug') isValidPlay = true;
      else if (isReactionWindow && (card.type === 'Nak' || card.type === 'Shuffle Now')) isValidPlay = true;
      else if (myTurn && !amDebugging && !isReactionWindow && card.type !== 'Debug') isValidPlay = true;

      if (isValidPlay) {
        const newHand = me.hand.filter(c => c.id !== card.id);
        const newDiscardPile = [...currentGameState.discardPile, card];

        setGameState(prevState => ({
          ...prevState!,
          discardPile: newDiscardPile,
          players: prevState!.players.map(p => p.id === socket?.id ? { ...p, hand: newHand } : p),
        }));

        if (amDebugging) {
          socket.emit('debugged', { gameCode, cardId: card.id });
        } else {
          socket.emit('play-card', { gameCode, cardId: card.id });
        }
      }
    }
  };

  if (!gameState) {
    return <div>Loading game...</div>;
  }

  const me = gameState.players.find(p => p.id === socket?.id);
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const myTurn = me && currentPlayer.id === me.id;
  const amDebugging = gameState.debuggingPlayerId === socket.id;

  const getEnlargedCardSize = () => {
    const maxHeight = windowHeight * 0.9;
    const defaultHeight = 840;
    const aspectRatio = 300 / 420;
    let height = defaultHeight;
    if (height > maxHeight) {
      height = maxHeight;
    }
    const width = height * aspectRatio;
    return { width, height };
  };

  const getPlayerClassName = (player: PlayerState) => {
    if (player.isExploded) return 'text-secondary';
    if (gameState.debuggingPlayerId === player.id) return 'blinking-red';
    return '';
  };

  let turnStatus = '';
  let turnStatusBgColor = '';
  if (amDebugging) {
    turnStatus = "You drew an Exploding Cluster! You must play a debug card.";
    turnStatusBgColor = '#FF0000';
  } else if (gameState && me) {
    const activePlayers = gameState.players.filter(p => !p.isExploded);
    if (activePlayers.length > 1) {
      let nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
      while (gameState.players[nextPlayerIndex].isExploded) {
        nextPlayerIndex = (nextPlayerIndex + 1) % gameState.players.length;
      }
      const nextPlayer = gameState.players[nextPlayerIndex];
      if (me.id === currentPlayer.id) {
        turnStatus = "It's your turn";
        turnStatusBgColor = 'lightgreen';
      } else if (me.id === nextPlayer.id) {
        turnStatus = "Your turn is next";
        turnStatusBgColor = 'lightcoral';
      } else {
        turnStatus = `It is ${currentPlayer.name}'s turn`;
        turnStatusBgColor = 'lightblue';
      }
    }
  }

  const renderDiscardPile = () => {
    const droppableContent = (
      <Droppable droppableId="discard-pile">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              width: 'min(100%, 200px)',
              aspectRatio: '300 / 420',
              border: snapshot.isDraggingOver ? '2px dashed #00FF00' : '2px dashed #FFA500',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <h5 style={{ color: '#FFA500', position: 'absolute' }}>Discard Pile</h5>
            {gameState && gameState.discardPile.length > 0 && (
              <Image
                src={gameState.discardPile[gameState.discardPile.length - 1].imageUrl}
                alt="Discard Pile"
                fill
                style={{ objectFit: 'contain', borderRadius: '10px' }}
              />
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
    const nonDroppableContent = (
      <div style={{ width: 'min(100%, 200px)', aspectRatio: '300 / 420', border: '2px dashed #FFA500', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <h5 style={{ color: '#FFA500', position: 'absolute' }}>Discard Pile</h5>
        {gameState && gameState.discardPile.length > 0 && (
          <Image
            src={gameState.discardPile[gameState.discardPile.length - 1].imageUrl}
            alt="Discard Pile"
            fill
            style={{ objectFit: 'contain', borderRadius: '10px' }}
          />
        )}
      </div>
    );
    return isClient ? droppableContent : nonDroppableContent;
  };

  const renderHand = () => {
    const droppableContent = (
      <Droppable droppableId="hand" direction="horizontal">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className="d-flex justify-content-center flex-wrap"
            style={{ minHeight: '200px' }}
          >
            {me && Array.isArray(me.hand) && me.hand.map((card, index) => {
              let isPlayable = false;
              const isReactionWindow = countdown !== null;
              if (amDebugging) isPlayable = card.type === 'Debug';
              else if (isReactionWindow) isPlayable = (card.type === 'Shuffle Now' || card.type === 'Nak');
              else if (myTurn) isPlayable = card.type !== 'Debug';
              return (
                <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={!isPlayable}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className="m-1"
                      style={{
                        ...provided.draggableProps.style,
                        border: selectedCard?.id === card.id ? '3px solid blue' : 'none',
                        borderRadius: '5px',
                        width: '100px',
                        height: '140px',
                        boxSizing: 'content-box',
                        opacity: isPlayable ? 1 : 0.5,
                        cursor: 'pointer',
                      }}
                      onClick={() => handleCardClick(card)}
                      onDoubleClick={() => handleCardDoubleClick(card)}
                    >
                      <Image src={card.imageUrl} alt={card.name} width={100} height={140} />
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
    const nonDroppableContent = (
      <div className="d-flex justify-content-center flex-wrap" style={{ minHeight: '200px' }}>
        {me && Array.isArray(me.hand) && me.hand.map(card => {
          let isPlayable = false;
          const isReactionWindow = countdown !== null;
          if (amDebugging) isPlayable = card.type === 'Debug';
          else if (isReactionWindow) isPlayable = (card.type === 'Shuffle Now' || card.type === 'Nak');
          else if (myTurn) isPlayable = card.type !== 'Debug';
          return (
            <div
              key={card.id}
              className="m-1"
              style={{
                border: selectedCard?.id === card.id ? '3px solid blue' : 'none',
                borderRadius: '5px',
                width: '100px',
                height: '140px',
                boxSizing: 'content-box',
                opacity: isPlayable ? 1 : 0.5,
                cursor: 'pointer',
              }}
              onClick={() => handleCardClick(card)}
              onDoubleClick={() => handleCardDoubleClick(card)}
            >
              <Image src={card.imageUrl} alt={card.name} width={100} height={140} />
            </div>
          );
        })}
      </div>
    );
    return isClient ? droppableContent : nonDroppableContent;
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Container fluid className="p-3 d-flex flex-column" style={{ height: '100vh' }}>
        {overlayCard && (
          <div
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              zIndex: 1000,
            }}
            onClick={() => setOverlayCard(null)}
          >
            <Image src={overlayCard.imageUrl} alt={overlayCard.name} width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
          </div>
        )}
        <Row className="flex-grow-1">
          <Col md={3}>
            <h5>Players</h5>
            <ListGroup>
              {gameState.players.map((player, index) => (
                <ListGroup.Item key={player.id} active={index === gameState.currentPlayerIndex && !amDebugging}>
                  <span className={getPlayerClassName(player)}>{player.name}</span>
                  <span className="float-end">{typeof player.hand === 'number' ? player.hand : player.hand.length} cards</span>
                </ListGroup.Item>
              ))}
            </ListGroup>
            {countdown !== null && (
              <div className="mt-3 text-center">
                <h2>Reaction Timer</h2>
                <h1 style={{ fontSize: '4rem' }}>{countdown}</h1>
              </div>
            )}
          </Col>
          <Col md={9} className="d-flex flex-column" style={{ backgroundColor: '#228B22', borderRadius: '10px', padding: '1rem' }}>
            <Row className="justify-content-center text-center flex-grow-1">
              <Col md={5} className="d-flex flex-column align-items-center justify-content-center">
                <div style={{ width: 'min(100%, 200px)', aspectRatio: '300 / 420', position: 'relative' }}>
                  <Image src="/art/back.png" alt="Draw Pile" fill style={{ objectFit: 'contain', cursor: myTurn && !amDebugging ? 'pointer' : 'not-allowed' }} onClick={handleDrawCard} />
                </div>
              </Col>
              <Col md={5} className="d-flex flex-column align-items-center justify-content-center">
                {explodingCard && gameState.debuggingPlayerId ? (
                  <Droppable droppableId="discard-pile">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{
                          width: 'min(100%, 200px)',
                          aspectRatio: '300 / 420',
                          border: snapshot.isDraggingOver ? '2px dashed #00FF00' : '2px dashed #FF0000',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                        }}
                      >
                        <h5 style={{ color: '#FF0000', position: 'absolute', zIndex: 1, backgroundColor: 'rgba(255,255,255,0.8)', padding: '0.5rem', borderRadius: '5px' }}>Drop Debug Card Here</h5>
                        <Image src={explodingCard.imageUrl} alt="Exploding Cluster" fill style={{ objectFit: 'contain', borderRadius: '10px' }} />
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                ) : (
                  renderDiscardPile()
                )}
              </Col>
            </Row>
          </Col>
        </Row>
        <Row>
          <Col>
            <div style={{
              backgroundColor: '#f0f0f0',
              borderRadius: '5px', margin: '0.5rem 0', padding: '0.5rem',
              height: '120px', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                textAlign: 'center', padding: '0.25rem',
                backgroundColor: turnStatusBgColor,
                borderRadius: '5px', flexShrink: 0,
              }}>
                <strong>{turnStatus}</strong>
              </div>
              <div ref={logContainerRef} style={{
                flexGrow: 1, overflowY: 'auto', fontSize: '0.9rem',
                textAlign: 'center', paddingTop: '0.5rem',
              }}>
                {gameState.gameLog.map((log, index) => {
                  const personalizedLog = me && log.startsWith(me.name) ? log.replace(me.name, 'You') : log;
                  return <div key={index}>{personalizedLog}</div>;
                })}
              </div>
            </div>
          </Col>
        </Row>
        <Row className="bg-light p-3 d-flex flex-column" style={{ borderTop: '1px solid #ccc', flexShrink: 0 }}>
          <h5 className="text-start mb-2">Your Hand</h5>
          {renderHand()}
        </Row>

        <Modal show={showDebugModal} onHide={() => {}} backdrop="static" keyboard={false} onKeyDown={(e) => { if (e.key === 'Enter') handleReinsertCard(); }}>
          <Modal.Header><Modal.Title>Reinsert the Exploding Cluster card</Modal.Title></Modal.Header>
          <Modal.Body>
            <p>Where do you want to put the Exploding Cluster card back into the draw pile?</p>
            <Form.Group>
              <Form.Label>Position (0 is the top, {gameState.drawPile} is the bottom)</Form.Label>
              <Form.Control
                type="number" min="0" max={gameState.drawPile}
                value={reinsertPosition}
                onChange={(e) => setReinsertPosition(parseInt(e.target.value, 10))}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer><Button variant="primary" onClick={handleReinsertCard}>Re-insert Card</Button></Modal.Footer>
        </Modal>

        <Modal show={!!winner} onHide={() => router.push('/')} backdrop="static" keyboard={false}>
          <Modal.Header><Modal.Title>Game Over!</Modal.Title></Modal.Header>
          <Modal.Body><p>{winner} has won the game!</p></Modal.Body>
          <Modal.Footer><Button variant="primary" onClick={() => router.push('/')}>Back to Main Menu</Button></Modal.Footer>
        </Modal>
      </Container>
    </DragDropContext>
  );
}
