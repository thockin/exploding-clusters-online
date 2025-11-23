'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, ListGroup, Button, Modal } from 'react-bootstrap';
import { useSocket, PlayerInfo } from '../contexts/SocketContext';
import { Card as CardType } from './deck';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';

const FIXED_TABLE_PADDING = 20; // px
const FIXED_PILE_GAP = 30; // px

const CARD_WIDTH_PX = 100;
const CARD_SMALL_WIDTH_PX = 75;
const CARD_MARGIN_X_PX = 4; // m-1 means 0.25rem, assuming 1rem=16px, so 4px on each side
const CARD_FULL_WIDTH_PX = CARD_WIDTH_PX + (CARD_MARGIN_X_PX * 2);
const CARD_SMALL_FULL_WIDTH_PX = CARD_SMALL_WIDTH_PX + (CARD_MARGIN_X_PX * 2);

export default function GameScreen() {
  const router = useRouter();
  const { socket, gameCode, gameState, playerName, playerId, myHand, resetState, isLoading, gameEndData, gameMessages } = useSocket();

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [overlayCard, setOverlayCard] = useState<CardType | null>(null);
  const [explodingCard, setExplodingCard] = useState<CardType | null>(null);
  const [windowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  const [isClient] = useState(false);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const [tableAreaSize, setTableAreaSize] = useState({ width: 0, height: 0 });
  const [handAreaWidth, setHandAreaWidth] = useState(0);
  
  // DEVMODE states
  const [deckOverlay, setDeckOverlay] = useState<CardType[] | null>(null);
  const [removedOverlay, setRemovedOverlay] = useState<CardType[] | null>(null); // New: for removed pile overlay
  const [hostPromotionMessage, setHostPromotionMessage] = useState<string | null>(null);

  const gameStateRef = useRef(gameState);
  
  useEffect(() => {
      const prevGameState = gameStateRef.current;
      if (prevGameState && gameState) {
          if (prevGameState.gameOwnerId !== playerId && gameState.gameOwnerId === playerId) {
              const prevOwner = prevGameState.players.find(p => p.id === prevGameState.gameOwnerId);
              const prevOwnerName = prevOwner ? prevOwner.name : 'The previous host';
              setHostPromotionMessage(`${prevOwnerName} left the game, so you have been selected as the new game owner. Congratulations on your promotion!`);
          }
      }
  }, [gameState, playerId]);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    if (!gameState && !isLoading && !gameEndData) {
      router.push('/');
    }
    console.log({ myHand, isSpectator: !gameState?.players.some(p => p.id === playerId), playerId, gameCode });
  }, [gameState, isLoading, router, gameEndData, myHand, playerId, gameCode]);
  
  useEffect(() => {
    // This effect handles logging exploding card but we don't render it yet?
    // Keeping state setter for future use or debugging.
  }, [explodingCard]); 

  useEffect(() => {
    if (!socket) return;

    const onDeckData = ({ deck }: { deck: CardType[] }) => setDeckOverlay(deck);
    const onRemovedData = ({ removedPile }: { removedPile: CardType[] }) => setRemovedOverlay(removedPile);
    const onPlayerExploding = ({ card }: { card: CardType }) => setExplodingCard(card);

    socket.on('deckData', onDeckData);
    socket.on('removedData', onRemovedData);
    socket.on('player-exploding', onPlayerExploding);

    return () => {
        socket.off('deckData', onDeckData);
        socket.off('removedData', onRemovedData);
        socket.off('player-exploding', onPlayerExploding);
    };
  }, [socket]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOverlayCard(null);
        setDeckOverlay(null);
        setRemovedOverlay(null); // Close removed pile overlay
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
    }
  }, [gameMessages]);

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
  }, [isClient, isLoading, gameState]);

  useEffect(() => {
    if (handAreaRef.current) {
        setHandAreaWidth(handAreaRef.current.offsetWidth);
        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                setHandAreaWidth(entries[0].contentRect.width);
            }
        });
        observer.observe(handAreaRef.current);
        return () => observer.disconnect();
    }
  }, [handAreaRef.current]); // Re-run if ref changes

  useEffect(() => {
    if (handAreaRef.current) {
        setHandAreaWidth(handAreaRef.current.offsetWidth);
        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                setHandAreaWidth(entries[0].contentRect.width);
            }
        });
        observer.observe(handAreaRef.current);
        return () => observer.disconnect();
    }
  }, [handAreaRef.current]);

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

  // Helper function to calculate layout constraints
  const calculateHandLayout = useCallback(( 
    numCards: number, 
    containerWidth: number 
  ): { maxWidth: number, cardWidth: number, cols: number } => {
    if (numCards === 0) return { maxWidth: 0, cardWidth: CARD_WIDTH_PX, cols: 1 };
    // Fallback to single row if container width is not yet measured
    if (containerWidth === 0) return { maxWidth: numCards * CARD_FULL_WIDTH_PX + 2, cardWidth: CARD_WIDTH_PX, cols: numCards };

    const getRowsAndCols = (cardFullWidth: number) => {
        const maxColsPossible = Math.floor(containerWidth / cardFullWidth);
        if (maxColsPossible === 0) return { rows: numCards, cols: 1 }; 
        
        for (let r = 1; r <= numCards; r++) {
            const cols = Math.ceil(numCards / r);
            if (cols <= maxColsPossible) return { rows: r, cols };
        }
        return { rows: numCards, cols: 1 };
    };

    const standard = getRowsAndCols(CARD_FULL_WIDTH_PX);
    
    let chosenCardWidth = CARD_WIDTH_PX;
    let chosenFullWidth = CARD_FULL_WIDTH_PX;
    let chosenCols = standard.cols;

    // "Once we shrink cards, they stay at the smaller size until the number of cards in the hand can all fit in two rows at the regular size."
    // This implies: If Standard > 2 rows, use Small.
    if (standard.rows > 2) {
        const small = getRowsAndCols(CARD_SMALL_FULL_WIDTH_PX);
        chosenCardWidth = CARD_SMALL_WIDTH_PX;
        chosenFullWidth = CARD_SMALL_FULL_WIDTH_PX;
        chosenCols = small.cols;
    }

    const maxWidth = chosenCols * chosenFullWidth + 2; // Buffer
    return { maxWidth, cardWidth: chosenCardWidth, cols: chosenCols };
  }, [handAreaWidth]);

  const handleGiveDebugCard = () => {
      if (socket && gameCode) {
          socket.emit('giveDebugCard', gameCode);
      }
  };

  const handleDevDrawCard = () => {
      if (socket && gameCode) {
          socket.emit('devDrawCard', gameCode);
      }
  };
  
  const handleShowDeck = () => {
      if (socket && gameCode) {
          socket.emit('showDeck', gameCode);
      }
  };

  const handleShowRemovedPile = () => {
      if (socket && gameCode) {
          socket.emit('showRemovedPile', gameCode);
      }
  };

  const onDragEnd = (result: DropResult) => {
    console.log('onDragEnd', result);
    const { source, destination } = result;
    if (!destination) {
        console.log('no destination');
        return;
    }

    const currentGameState = gameStateRef.current;
    if (!currentGameState) {
        console.log('no gameState');
        return;
    }

    // Handle discard pile drop
    if (destination.droppableId === 'discard-pile') {
      let card = null;
      if (source.droppableId.startsWith('hand-row-')) {
          const { cols } = calculateHandLayout(myHand.length, handAreaWidth);
          const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
          const sourceGlobalIndex = sourceRowIndex * cols + source.index;
          card = myHand[sourceGlobalIndex];
      }
      
      if (card) {
          socket?.emit('play-card', { gameCode, cardId: card.id });
      }
      return;
    }

    if (source.droppableId.startsWith('hand-row-') && destination.droppableId.startsWith('hand-row-')) {
        const { cols } = calculateHandLayout(myHand.length, handAreaWidth);
        const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
        const destRowIndex = parseInt(destination.droppableId.replace('hand-row-', ''), 10);

        const sourceGlobalIndex = sourceRowIndex * cols + source.index;
        const destGlobalIndex = destRowIndex * cols + destination.index;

        const newHand = Array.from(myHand);
        const [reorderedItem] = newHand.splice(sourceGlobalIndex, 1);
        newHand.splice(destGlobalIndex, 0, reorderedItem);
        socket?.emit('reorder-hand', { gameCode, newHand });
        return;
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
      const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
      const nextPlayerId = gameState.turnOrder[nextTurnIndex];

      if (me.id === currentPlayerId) {
        turnStatus = "It's your turn";
        turnStatusBgColor = 'lightgreen';
      } else if (me.id === nextPlayerId) {
        turnStatus = "Your turn is next";
        turnStatusBgColor = '#FFD580'; // light orange
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
    const { maxWidth, cardWidth, cols } = calculateHandLayout(myHand.length, handAreaWidth);

    // Split hand into rows
    const rows: CardType[][] = [];
    if (cols > 0) {
        for (let i = 0; i < myHand.length; i += cols) {
            rows.push(myHand.slice(i, i + cols));
        }
    } else {
        rows.push(myHand);
    }
    
    if (rows.length === 0) {
        rows.push([]);
    }

    return (
      <div 
        style={{ 
            maxWidth: `${maxWidth}px`,
            margin: '0 auto', // Center the container itself
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
        }}
      >
        {rows.map((rowCards, rowIndex) => (
            <Droppable key={rowIndex} droppableId={`hand-row-${rowIndex}`} direction="horizontal">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="d-flex justify-content-center flex-nowrap w-100"
                    style={{ 
                        minHeight: `${cardWidth * 1.4 + 10}px`, // Ensure height for drop target + margin
                        width: '100%',
                    }}
                  >
                    {rowCards.map((card, index) => (
                        <Draggable key={card.id} draggableId={card.id} index={index}>
                          {(providedDraggable) => (
                            <div
                              ref={providedDraggable.innerRef}
                              {...providedDraggable.draggableProps}
                              {...providedDraggable.dragHandleProps}
                              className="m-1"
                              style={{
                                ...providedDraggable.draggableProps.style,
                                border: selectedCard?.id === card.id ? '3px solid blue' : 'none',
                                borderRadius: '5px',
                                width: `${cardWidth}px`,
                                height: `${cardWidth * 1.4}px`,
                                boxSizing: 'content-box',
                                cursor: 'pointer',
                              }}
                              onClick={() => handleCardClick(card)}
                              onDoubleClick={() => handleCardDoubleClick(card)}
                            >
                              <Image 
                                src={card.imageUrl} 
                                alt={card.name} 
                                width={cardWidth} 
                                height={cardWidth * 1.4}
                              />
                            </div>
                          )}
                        </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
            </Droppable>
        ))}
      </div>
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
        
        {removedOverlay && (
          <div
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              zIndex: 1000, overflowY: 'auto', padding: '20px'
            }}
            onClick={() => setRemovedOverlay(null)}
          >
             <h2 style={{color: 'white'}}>Removed Pile ({removedOverlay.length} cards)</h2>
             <div className="d-flex flex-wrap justify-content-center">
                 {removedOverlay.map((card, index) => (
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
                    <Button variant="warning" size="sm" onClick={handleDevDrawCard}>Draw a safe card</Button>
                    <Button variant="info" size="sm" onClick={handleShowDeck}>Show the deck</Button>
                    <Button variant="info" size="sm" onClick={handleShowRemovedPile}>Show removed cards</Button>
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
              
              <div 
                  ref={messageAreaRef}
                  style={{
                      textAlign: 'left', padding: '0.25rem',
                      overflowY: 'auto', flexGrow: 1,
                      borderTop: '1px solid #ccc', marginTop: '0.25rem'
                  }}
              >
                  {gameMessages.map((msg, i) => (
                      <div key={i}>{msg}</div>
                  ))}
              </div>
            </div>
          </Col>
        </Row>
        {!isSpectator && (
        <Row className="bg-light p-3 d-flex flex-column position-relative" 
             style={{ 
                 borderTop: '1px solid #ccc', 
                 flexShrink: 0,
                 height: '35vh',
                 minHeight: '250px'
             }} 
        >
          <h5 className="text-start mb-2 flex-shrink-0">Your Hand</h5>
          <div 
            ref={handAreaRef}
            className="flex-grow-1"
            style={{ overflowY: 'auto', width: '100%' }}
          >
             {renderHand()}
          </div>
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
        <Modal show={!!hostPromotionMessage} onHide={() => setHostPromotionMessage(null)}>
          <Modal.Header closeButton>
            <Modal.Title>You are now the game owner</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>{hostPromotionMessage}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={() => setHostPromotionMessage(null)}>OK</Button>
          </Modal.Footer>
        </Modal>

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
