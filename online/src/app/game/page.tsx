'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, ListGroup, Button, Modal } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { Card as CardType } from './deck';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';

const FIXED_TABLE_PADDING = 20; // px
const FIXED_PILE_GAP = 30; // px

export default function GameScreen() {
  const router = useRouter();
  const { socket, gameCode, gameState, playerName, playerId, myHand, resetState, isLoading, gameEndData } = useSocket();

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [overlayCard, setOverlayCard] = useState<CardType | null>(null);
  const [explodingCard, setExplodingCard] = useState<CardType | null>(null);
  const [windowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  const [isClient] = useState(false);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const [tableAreaSize, setTableAreaSize] = useState({ width: 0, height: 0 });
  
  // DEVMODE states
  const [deckOverlay, setDeckOverlay] = useState<CardType[] | null>(null);

  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    if (!gameState && !isLoading && !gameEndData) {
      router.push('/');
    }
  }, [gameState, isLoading, router, gameEndData]);
  
  useEffect(() => {
    // This effect handles logging exploding card but we don't render it yet?
    // Keeping state setter for future use or debugging.
  }, [explodingCard]); 

  useEffect(() => {
    if (!socket) return;

    const onDeckData = ({ deck }: { deck: CardType[] }) => setDeckOverlay(deck);
    const onPlayerExploding = ({ card }: { card: CardType }) => setExplodingCard(card);

    socket.on('deckData', onDeckData);
    socket.on('player-exploding', onPlayerExploding);

    return () => {
        socket.off('deckData', onDeckData);
        socket.off('player-exploding', onPlayerExploding);
    };
  }, [socket]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOverlayCard(null);
        setDeckOverlay(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (tableAreaRef.current) {
        setTableAreaSize({
            width: tableAreaRef.current.offsetWidth,
            height: tableAreaRef.current.offsetHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [isClient]);

  const handleGameEndConfirm = useCallback(() => {
      resetState();
      router.push('/');
  }, [resetState, router]);

  const getCardSize = useCallback((enlarged: boolean = false) => {
    const aspectRatio = 5 / 7;
    if (enlarged) {
      const maxHeight = windowHeight * 0.7;
      const maxWidth = maxHeight * aspectRatio;
      return { width: maxWidth, height: maxHeight };
    }
    if (tableAreaSize.width === 0 || tableAreaSize.height === 0) {
        return { width: 100, height: 140 };
    }
    const padding = 20;
    const fixedGapPx = 30;
    const availW = tableAreaSize.width - (padding * 2) - fixedGapPx;
    const availH = tableAreaSize.height - (padding * 2);
    let cardW = availW / 2;
    let cardH = cardW / aspectRatio;
    if (cardH > availH) {
        cardH = availH;
        cardW = cardH * aspectRatio;
    }
    return { width: Math.floor(cardW), height: Math.floor(cardH) };
  }, [tableAreaSize, windowHeight]);

  const handleLeaveGame = useCallback(() => {
    if (socket && gameCode) {
        socket.emit('leaveGame', gameCode);
    }
    setShowLeaveModal(false);
    resetState();
    router.push('/');
  }, [socket, gameCode, resetState, router]);

  const handleCardClick = useCallback((card: CardType) => {
    if (selectedCard?.id === card.id) {
      setSelectedCard(null);
    } else {
      setSelectedCard(card);
    }
  }, [selectedCard]);

  const handleCardDoubleClick = useCallback((card: CardType) => {
    setOverlayCard(card);
  }, []);

  const handleGiveDebugCard = () => {
      if (socket && gameCode) {
          socket.emit('giveDebugCard', gameCode);
      }
  };
  
  const handleShowDeck = () => {
      if (socket && gameCode) {
          socket.emit('showDeck', gameCode);
      }
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;

    const currentGameState = gameStateRef.current;
    if (!currentGameState) return;
    
    if (source.droppableId === 'hand' && destination.droppableId === 'hand') {
      const newHand = Array.from(myHand);
      const [reorderedItem] = newHand.splice(source.index, 1);
      newHand.splice(destination.index, 0, reorderedItem);
      socket?.emit('reorder-hand', { gameCode, newHand });
      return;
    }

    if (destination.droppableId === 'discard-pile') {
      const card = myHand[source.index];
       socket?.emit('play-card', { gameCode, cardId: card.id });
    }
  };

  if (!gameState || !socket) {
      if (gameEndData) {
          return (
            <Container className="d-flex align-items-center justify-content-center" style={{ height: '100vh' }}>
                <Modal show={true} onHide={handleGameEndConfirm} backdrop="static" keyboard={false} centered>
                    <Modal.Header>
                    <Modal.Title>
                        {gameEndData.winner === playerName ? 'You win!' : `${gameEndData.winner} wins!`}
                    </Modal.Title>
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
      return <div>Loading game...</div>;
  }

  const me = gameState.players.find(p => p.id === playerId);
  const currentPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
  const currentPlayer = gameState.players.find(p => p.id === currentPlayerId);

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

  const getPlayerClassName = (player: PlayerInfo) => {
    let className = '';
    if (player.id === currentPlayerId) className += 'bg-success-subtle';
    if (player.isOut) className += ' text-decoration-line-through text-muted';
    if (player.isDisconnected) className += ' text-muted opacity-50';
    return className.trim();
  };

  const playersToDisplay = gameState.players;

  let turnStatus = '';
  let turnStatusBgColor = '';
   if (gameState && me && currentPlayer) {
      if (me.id === currentPlayerId) {
        turnStatus = "It's your turn";
        turnStatusBgColor = 'lightgreen';
      } else {
        turnStatus = `It is ${currentPlayer.name}'s turn`;
        turnStatusBgColor = 'lightblue';
      }
   }



  const renderDiscardPile = () => {
    return (
      <Droppable droppableId="discard-pile">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              width: getCardSize().width,
              height: getCardSize().height,
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
  };

  const renderHand = () => {
     return (
      <Droppable droppableId="hand" direction="horizontal">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className="d-flex justify-content-center flex-wrap"
            style={{ minHeight: '200px' }}
          >
            {myHand.map((card, index) => (
                <Draggable key={card.id} draggableId={card.id} index={index}>
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
                        cursor: 'pointer',
                      }}
                      onClick={() => handleCardClick(card)}
                      onDoubleClick={() => handleCardDoubleClick(card)}
                    >
                      <Image src={card.imageUrl} alt={card.name} width={100} height={140} />
                    </div>
                  )}
                </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
  };

  const isSpectator = gameState && !gameState.players.some(p => p.id === playerId);

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
        
        {deckOverlay && (
          <div
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              zIndex: 1000, overflowY: 'auto', padding: '20px'
            }}
            onClick={() => setDeckOverlay(null)}
          >
             <h2 style={{color: 'white'}}>Draw Pile ({deckOverlay.length} cards)</h2>
             <div className="d-flex flex-wrap justify-content-center">
                 {deckOverlay.map((card, index) => (
                     <div key={index} className="m-1">
                        <Image src={card.imageUrl} alt={card.name} width={100} height={140} />
                        <div style={{color: 'white', textAlign: 'center'}}>{index}</div>
                     </div>
                 ))}
             </div>
          </div>
        )}

        <Row className="flex-grow-1">
          <Col md={3}>
            <h5>Players</h5>
            <ListGroup>
              {playersToDisplay.map((player) => (
                <ListGroup.Item key={player.id} className={getPlayerClassName(player)}>
                  <div>
                      <span>{player.name} {player.id === gameState.gameOwnerId && '(Host)'} {player.isDisconnected && '(Disconnected)'}</span>
                      <span className="float-end">{player.cards} cards</span>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
            
            {gameState.devMode && !isSpectator && (
                <div className="mt-3 d-grid gap-2">
                    <Button 
                        variant="warning" 
                        size="sm" 
                        onClick={handleGiveDebugCard} 
                        disabled={(gameState.debugCardsCount || 0) === 0}
                    >
                        Give me a DEBUG card
                    </Button>
                    <Button variant="info" size="sm" onClick={handleShowDeck}>Show me the deck</Button>
                </div>
            )}
          </Col>
          <Col md={9} className="d-flex flex-column" style={{ backgroundColor: '#228B22', borderRadius: '10px', padding: `${FIXED_TABLE_PADDING}px` }} ref={tableAreaRef}>
            <div 
                className="d-flex justify-content-center align-items-center flex-grow-1" 
                style={{ gap: `${FIXED_PILE_GAP}px` }}
            >
              {/* Draw Pile */}
              <div className="d-flex flex-column align-items-center">
                  <div className="game-pile position-relative" style={{ width: getCardSize().width, height: getCardSize().height }}>
                    <Image src="/art/back.png" alt="Draw Pile" width={getCardSize().width} height={getCardSize().height} />
                  </div>
                  {gameState.devMode && <div className="text-white mt-1">({gameState.drawPileCount} cards)</div>}
              </div>

              {/* Discard Pile */}
              <div className="d-flex flex-column align-items-center">
                  <div style={{ width: getCardSize().width, height: getCardSize().height }}>
                      {renderDiscardPile()}
                  </div>
                  {gameState.devMode && <div className="text-white mt-1">({gameState.discardPile.length} cards)</div>}
              </div>
            </div>
          </Col>
        </Row>
        <Row style={{ flexGrow: isSpectator ? 1 : 0 }}>
          <Col className="d-flex flex-column">
            <div style={{
              backgroundColor: '#f0f0f0',
              borderRadius: '5px', margin: '0.5rem 0', padding: '0.5rem',
              height: isSpectator ? 'auto' : '120px', 
              flexGrow: isSpectator ? 1 : 0,
              display: 'flex', flexDirection: 'column',
            }}>
               <div style={{
                textAlign: 'center', padding: '0.25rem',
                backgroundColor: turnStatusBgColor,
                borderRadius: '5px', flexShrink: 0,
              }}>
                <strong>{turnStatus}</strong>
              </div>
              {/* Log area would go here */}
            </div>
          </Col>
        </Row>
        {!isSpectator && (
        <Row className="bg-light p-3 d-flex flex-column position-relative" style={{ borderTop: '1px solid #ccc', flexShrink: 0 }}>
          <h5 className="text-start mb-2">Your Hand</h5>
          {renderHand()}
          <Button 
             variant="secondary" 
             className="position-absolute bottom-0 end-0 m-3 w-auto"
             onClick={() => setShowLeaveModal(true)}
          >
            Leave Game
          </Button>
        </Row>
        )}
        {isSpectator && (
          <Row className="bg-light p-3 position-relative" style={{ borderTop: '1px solid #ccc', flexShrink: 0 }}>
             <div className="d-flex justify-content-end w-100">
                 <Button 
                    variant="secondary" 
                    className="w-auto"
                    onClick={() => setShowLeaveModal(true)}
                 >
                   Leave Game
                 </Button>
             </div>
          </Row>
        )}
        
        {/* Modals... */}
        <Modal show={showLeaveModal} onHide={() => setShowLeaveModal(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Leave Game?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Are you sure you want to leave the game?</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowLeaveModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleLeaveGame} autoFocus>Leave Game</Button>
          </Modal.Footer>
        </Modal>
      </Container>
    </DragDropContext>
  );
}
