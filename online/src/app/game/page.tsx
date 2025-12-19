'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, ListGroup, Button, Modal, Form } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { Card, Player, SocketEvent, CardClass, TurnPhase, WinType } from '../../api';
import { DragDropContext, Droppable, Draggable, DropResult, DragStart } from '@hello-pangea/dnd';
import Image from 'next/image';

const FIXED_TABLE_PADDING = 20; // px
const FIXED_PILE_GAP = 30; // px

const CARD_WIDTH_PX = 100;
const CARD_SMALL_WIDTH_PX = 80;
const CARD_MARGIN_X_PX = 4; // m-1 means 0.25rem, assuming 1rem=16px, so 4px on each side
const CARD_FULL_WIDTH_PX = CARD_WIDTH_PX + (CARD_MARGIN_X_PX * 2);
const CARD_SMALL_FULL_WIDTH_PX = CARD_SMALL_WIDTH_PX + (CARD_MARGIN_X_PX * 2);

export default function GameScreen() {
  const router = useRouter();
  const { socket, gameCode, gameState, playerName, playerId, myHand, setMyHand, resetState, isLoading, gameEndData, gameMessages } = useSocket();

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]); // For single or combo selection
  const [overlayCard, setOverlayCard] = useState<Card | null>(null);
  const [explodingCard, setExplodingCard] = useState<Card | null>(null);
  const [windowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  const [isClient, setIsClient] = useState(false); // Initialize as false
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const [tableAreaSize, setTableAreaSize] = useState({ width: 0, height: 0 });
  const [handAreaWidth, setHandAreaWidth] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // DEVMODE states
  const [deckOverlay, setDeckOverlay] = useState<Card[] | null>(null);
  const [removedOverlay, setRemovedOverlay] = useState<Card[] | null>(null); // New: for removed pile overlay
  const [hostPromotionMessage, setHostPromotionMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const isDrawingRef = useRef(false);
  const clickStartPosRef = useRef({ x: 0, y: 0 });
  const dragStartNonceRef = useRef<string>('');
  const isShiftKeyPressed = useRef(false);
  const [drawingAnimation, setDrawingAnimation] = useState<{ active: boolean, card?: Card, playerId?: string, duration?: number, nextCardImageUrl?: string, currentPileImageUrl?: string } | null>(null);
  const [replayModal, setReplayModal] = useState<{ show: boolean, reason: string, cardId?: string, cardIds?: string[] } | null>(null);
  const [insertionModal, setInsertionModal] = useState<{ show: boolean, maxIndex: number } | null>(null);
  const [insertionIndex, setInsertionIndex] = useState<string | number>(0);
  const [upgradeInsertionModal, setUpgradeInsertionModal] = useState<{ show: boolean, maxIndex: number } | null>(null);
  const [seeTheFutureCards, setSeeTheFutureCards] = useState<Card[] | null>(null); // Added
  const [favorVictimModalOpen, setFavorVictimModalOpen] = useState(false);
  const [favorVictimSelection, setFavorVictimSelection] = useState<string | null>(null);
  const [favorCardChoiceModalOpen, setFavorCardChoiceModalOpen] = useState(false);
  const [favorOutcomeCard, setFavorOutcomeCard] = useState<Card | null>(null);
  const [favorSelectedCardId, setFavorSelectedCardId] = useState<string | null>(null); // For victim selecting card to give
  const [favorCountdown, setFavorCountdown] = useState(15);
  const [developerVictimModalOpen, setDeveloperVictimModalOpen] = useState(false);
  const [developerCardChoiceCount, setDeveloperCardChoiceCount] = useState<number | null>(null);
  const [developerStolenCard, setDeveloperStolenCard] = useState<Card | null>(null);

  // Ensure isClient is true after first render
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftKeyPressed.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftKeyPressed.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (favorCardChoiceModalOpen) {
      setFavorCountdown(15);
      const interval = setInterval(() => {
        setFavorCountdown(prev => {
            if (prev <= 1) {
                clearInterval(interval);
                setFavorCardChoiceModalOpen(false);
                return 0;
            }
            return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [favorCardChoiceModalOpen]);

  const gameStateRef = useRef(gameState);

  useEffect(() => {
    const prevGameState = gameStateRef.current;
    if (prevGameState && gameState) {
      if (prevGameState.gameOwnerId !== playerId && gameState.gameOwnerId === playerId) {
        const prevOwner = prevGameState.players.find(p => p.id === prevGameState.gameOwnerId);
        const prevOwnerName = prevOwner ? prevOwner.name : 'The previous host';
        setTimeout(() => {
          setHostPromotionMessage(`${prevOwnerName} left the game, so you have been selected as the new game owner. Congratulations on your promotion!`);
        }, 0);
      }
    }
  }, [gameState, playerId]);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    if (!gameState && !isLoading && !gameEndData) {
      router.push('/');
    }
    console.debug({ myHand, isSpectator: !gameState?.players.some(p => p.id === playerId), playerId, gameCode });
  }, [gameState, isLoading, router, gameEndData, myHand, playerId, gameCode]);

  useEffect(() => {
    // This effect handles logging exploding card but we don't render it yet?
    // Keeping state setter for future use or debugging.
  }, [explodingCard]);

  useEffect(() => {
    // Detect if we are in Exploding phase and need to show Insertion Modal
    if (gameState?.turnPhase === TurnPhase.Exploding) {
      const currentPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
      if (currentPlayerId === playerId) {
        const hasDebug = myHand.some(c => c.class === CardClass.Debug);
        if (!hasDebug && !insertionModal && !overlayCard) {
           setInsertionModal({ show: true, maxIndex: gameState.drawPileCount || 50 });
        }
      }
    } else {
      if (insertionModal) setInsertionModal(null);
    }
  }, [gameState, playerId, myHand, insertionModal, overlayCard]);

  useEffect(() => {
    // Detect if we are in Upgrading phase and need to show Insertion Modal
    if (gameState?.turnPhase === TurnPhase.Upgrading) {
      const currentPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
      if (currentPlayerId === playerId) {
        if (!upgradeInsertionModal && !overlayCard) {
           setUpgradeInsertionModal({ show: true, maxIndex: gameState.drawPileCount || 50 });
        }
      }
    } else {
      if (upgradeInsertionModal) setUpgradeInsertionModal(null);
    }
  }, [gameState, playerId, upgradeInsertionModal, overlayCard]);

  useEffect(() => {
    if (!socket) return;

    const onDeckData = ({ deck }: { deck: Card[] }) => setDeckOverlay(deck);
    const onRemovedData = ({ removedPile }: { removedPile: Card[] }) => setRemovedOverlay(removedPile);
    const onPlayerExploding = ({ card }: { card: Card }) => setExplodingCard(card);
        const onPlayError = (data: { reason: string, cardId?: string, cardIds?: string[] }) => {
          setReplayModal({ show: true, ...data });
        };
  
    const onSeeTheFutureData = (data: { cards: Card[], timeout?: number }) => {
      setSeeTheFutureCards(data.cards);
      const duration = data.timeout || (gameStateRef.current?.devMode ? 2000 : 10000);
      setTimeout(() => {
        setSeeTheFutureCards(null);
        if (socket && gameCode) {
          socket.emit(SocketEvent.DismissSeeTheFuture, gameCode); // Auto-dismiss triggers server dismiss
        }
      }, duration);
    };

    const onChooseFavorCard = () => {
      setFavorCardChoiceModalOpen(true);
    };

    const onFavorOutcome = (data: { card: Card }) => {
      setFavorOutcomeCard(data.card);
      setTimeout(() => {
        setFavorOutcomeCard(null);
      }, 3000);
    };

    const onChooseDeveloperCard = (data: { victimId: string, handCount: number }) => {
        setDeveloperCardChoiceCount(data.handCount);
    };

    const onDeveloperStolen = (data: { card: Card }) => {
        setDeveloperStolenCard(data.card);
        setTimeout(() => setDeveloperStolenCard(null), 3000);
    };

    const onTimerUpdate = ({ duration, phase }: { duration: number, phase: TurnPhase }) => {
      if (phase === TurnPhase.Reaction) {
        setCountdown(duration);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownIntervalRef.current!);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else if (phase === TurnPhase.Action) {
        setCountdown(0);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
    };

    console.debug('Registering Socket event listeners.');
    socket.on(SocketEvent.DeckData, onDeckData);
    socket.on(SocketEvent.RemovedData, onRemovedData);
    socket.on(SocketEvent.PlayerExploding, onPlayerExploding);
    socket.on(SocketEvent.PlayError, onPlayError);
    socket.on(SocketEvent.SeeTheFutureData, onSeeTheFutureData);
    socket.on(SocketEvent.ChooseFavorCard, onChooseFavorCard);
    socket.on(SocketEvent.FavorOutcome, onFavorOutcome);
    socket.on(SocketEvent.ChooseDeveloperCard, onChooseDeveloperCard);
    socket.on(SocketEvent.DeveloperStolen, onDeveloperStolen);
    socket.on(SocketEvent.TimerUpdate, onTimerUpdate);

    return () => {
      socket.off(SocketEvent.DeckData, onDeckData);
      socket.off(SocketEvent.RemovedData, onRemovedData);
      socket.off(SocketEvent.PlayerExploding, onPlayerExploding);
      socket.off(SocketEvent.PlayError, onPlayError);
      socket.off(SocketEvent.SeeTheFutureData, onSeeTheFutureData);
      socket.off(SocketEvent.ChooseFavorCard, onChooseFavorCard);
      socket.off(SocketEvent.FavorOutcome, onFavorOutcome);
      socket.off(SocketEvent.ChooseDeveloperCard, onChooseDeveloperCard);
      socket.off(SocketEvent.DeveloperStolen, onDeveloperStolen);
      socket.off(SocketEvent.TimerUpdate, onTimerUpdate);
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [socket, gameCode]);
  
      // handleDismissSeeTheFuture function
      const handleDismissSeeTheFuture = useCallback(() => {
        if (socket && gameCode) {
          socket.emit(SocketEvent.DismissSeeTheFuture, gameCode);
          setSeeTheFutureCards(null);
        }
      }, [socket, gameCode]);
  
      useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            setOverlayCard(null);
            setDeckOverlay(null);
            setRemovedOverlay(null);
            setDrawingAnimation(null); // Clear drawing animation on Escape
            setSeeTheFutureCards(null); // Clear See The Future overlay on Escape
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
      setHandAreaWidth(handAreaRef.current.clientWidth);
      const observer = new ResizeObserver(entries => {
        if (entries[0] && !isDraggingRef.current) {
          setHandAreaWidth(entries[0].contentRect.width);
        }
      });
      observer.observe(handAreaRef.current);
      return () => observer.disconnect();
    }
  }, []);

  const handleUpgradeInsertConfirm = useCallback(() => {
    if (!socket || !gameCode || !gameState) return;
    const index = typeof insertionIndex === 'string' ? parseInt(insertionIndex, 10) : insertionIndex;
    socket.emit(SocketEvent.InsertUpgradeCard, { gameCode, index, nonce: gameState.nonce });
    setUpgradeInsertionModal(null);
  }, [socket, gameCode, gameState, insertionIndex]);

  const handleGameEndConfirm = useCallback(() => {
    resetState();
    router.push('/');
  }, [resetState, router]);

  const handleInsertConfirm = useCallback(() => {
    if (!socket || !gameCode || !gameState) return;
    const index = typeof insertionIndex === 'string' ? parseInt(insertionIndex, 10) : insertionIndex;
    socket.emit(SocketEvent.InsertExplodingCard, { gameCode, index, nonce: gameState.nonce });
    setInsertionModal(null);
  }, [socket, gameCode, gameState, insertionIndex]);

  const isCardPlayable = useCallback((card: Card) => {
    if (!gameState || !playerId) return false;
    const currentPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
    const isMyTurn = currentPlayerId === playerId;
    const isNowCard = !!card.now;

    // Developer Card Logic: Must have at least 2 identical cards to be playable (as a pair)
    if (card.class === CardClass.Developer) {
      const count = myHand.filter(c => c.class === CardClass.Developer && c.name === card.name).length;
      if (count < 2) return false;
    }

    // DEBUG card logic
    if (card.class === CardClass.Debug) {
        // Playable ONLY in Exploding phase and if it's my turn
        return gameState.turnPhase === TurnPhase.Exploding && isMyTurn;
    }

    // Phase checks
    switch (gameState.turnPhase) {
      case TurnPhase.Action:
        // NAK is only playable in Reaction, unless DEVMODE
        if (card.class === CardClass.Nak && isMyTurn) return gameState.devMode;
        // Action Phase: Can play if it's my turn OR it's a NOW card
        if (isMyTurn) return true;
        if (isNowCard) return true;
        return false;
      case TurnPhase.Reaction:
        // Reaction Phase:
        // - The player who acted last (lastActorName) CANNOT play.
        // - Others CAN play NOW cards or NAK.
        if (gameState.lastActorName && playerName === gameState.lastActorName) return false;
        if (isNowCard || card.class === CardClass.Nak) return true;
        return false;
      case TurnPhase.Exploding:
        // Handled above (DEBUG only)
        return { allowed: false, reason: "You must play a DEBUG card!" };
      case TurnPhase.SeeingTheFuture:
        // Block all players from playing cards while one player is seeing the future
        return { allowed: false, reason: `${gameState.players.find(p => p.id === gameState.turnOrder[gameState.currentTurnIndex])?.name} is seeing the future.` };
      case TurnPhase.ChoosingFavorCard:
        return { allowed: false, reason: "Waiting for a favor to be granted." };
      case TurnPhase.ChoosingDeveloperCard:
        return { allowed: false, reason: "Waiting for a card to be stolen." };
      default:
        return { allowed: false, reason: `BUG: Can't play cards in phase ${gameState.turnPhase}.` };
    }
  }, [gameState, playerId, myHand, playerName]);

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
      socket.emit(SocketEvent.LeaveGame, gameCode);
    }
    setShowLeaveModal(false);
    resetState();
    router.push('/');
  }, [socket, gameCode, resetState, router]);

  const handleReplayConfirm = useCallback(() => {
    if (!socket || !gameCode || !replayModal || !gameState) return;

    if (replayModal.cardId) {
      socket.emit(SocketEvent.PlayCard, { gameCode, cardId: replayModal.cardId, nonce: gameState.nonce });
    } else if (replayModal.cardIds) {
      socket.emit(SocketEvent.PlayCombo, { gameCode, cardIds: replayModal.cardIds, nonce: gameState.nonce });
    }
    setReplayModal(null);
  }, [socket, gameCode, replayModal, gameState]);

  const handleCardClick = useCallback((card: Card, event: React.MouseEvent) => {
    event.stopPropagation();

    if (isDraggingRef.current) {
      // handleCardClick ignored (isDraggingRef)
      return;
    }

    // Check playability (Phase 3.2)
    // "If the player single-clicks an unplayable card in their hand, do nothing."
    if (!isCardPlayable(card)) {
      return;
    }

    // Calculate distance moved to distinguish click from drag
    const moveX = Math.abs(event.clientX - clickStartPosRef.current.x);
    const moveY = Math.abs(event.clientY - clickStartPosRef.current.y);
    if (moveX > 30 || moveY > 30) {
      // handleCardClick ignored (distance)
      return;
    }
    console.debug('handleCardClick', card.id, card.name, 'shift:', event.shiftKey, 'selected:', selectedCards.map(c => c.id));
    // TODO: Add check for playable cards here (Phase 3)

    // If shift key is pressed, attempt combo selection
    if (event.shiftKey) {
      // Only DEVELOPER cards can be part of a combo
      if (card.class !== CardClass.Developer) {
        return; // Do nothing if not a DEVELOPER card
      }

      if (selectedCards.length === 0) {
        // Start a new combo selection
        setSelectedCards([card]);
      } else if (selectedCards.length === 1) {
        const existingCard = selectedCards[0];
        // Only allow combo with identical DEVELOPER cards and not the same card instance
        if (existingCard.class === CardClass.Developer &&
            existingCard.name === card.name &&
            existingCard.id !== card.id) {
          setSelectedCards(prev => [...prev, card]); // Form a combo
        }
      } else if (selectedCards.length === 2) {
        // If two cards are already selected (a full combo), do nothing
        return;
      }
    } else {
      // Single click behavior
      if (selectedCards.length === 1 && selectedCards[0].id === card.id) {
        // If the same card is clicked again, deselect it
        setSelectedCards([]);
      } else {
        // Otherwise, select the clicked card and deselect any others
        setSelectedCards([card]);
      }
    }
  }, [selectedCards, isCardPlayable]);

  const handleCardDoubleClick = useCallback((card: Card) => {
    setOverlayCard(card);
  }, []);

  // Helper function to calculate layout constraints
  const calculateHandLayout = useCallback((
    numCards: number,
    containerWidth: number
  ): { maxWidth: number, cardWidth: number, cols: number } => {
    if (numCards === 0) return { maxWidth: 0, cardWidth: CARD_WIDTH_PX, cols: 1 };
    // Fallback to single column (vertical stack) if container width is not yet measured
    // This prevents a huge single row from causing horizontal overflow initially
    if (containerWidth === 0) return { maxWidth: CARD_FULL_WIDTH_PX + 2, cardWidth: CARD_WIDTH_PX, cols: 1 };

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
  }, []);

  const handleGiveDebugCard = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.GiveDebugCard, gameCode);
    }
  };

  const handleDevDrawCard = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.GiveSafeCard, gameCode);
    }
  };

  const handlePutCardBack = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.PutCardBack, gameCode);
    }
  };

  const handleShowDeck = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.ShowDeck, gameCode);
    }
  };

  const handleShowRemovedPile = () => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.ShowRemovedPile, gameCode);
    }
  };

  const handleDrawClick = useCallback(() => {
    if (!socket || !gameState) return;

    if (isDrawingRef.current) return;
    if (drawingAnimation?.active) return;

    const currentPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
    if (currentPlayerId !== playerId) {
      console.log("Cannot draw: not your turn");
      return; // Or show toast
    }

    if (gameState.turnPhase !== TurnPhase.Action) {
      console.log("Cannot draw: not in action phase");
      return;
    }

    isDrawingRef.current = true;
    setTimeout(() => { isDrawingRef.current = false; }, 1000);

    socket.emit(SocketEvent.DrawCard, gameCode);
  }, [socket, gameState, playerId, gameCode, drawingAnimation]);

  useEffect(() => {
    if (!socket) return;

    const onDrawCardAnimation = (data: { drawingPlayerId: string, card?: Card, duration: number, nextCardImageUrl?: string }) => {
      console.debug(SocketEvent.DrawCardAnimation, data);
      const currentPileImageUrl = gameStateRef.current?.drawPileImage || "/art/back.png";
      setDrawingAnimation({ active: true, card: data.card, playerId: data.drawingPlayerId, duration: data.duration, nextCardImageUrl: data.nextCardImageUrl, currentPileImageUrl });

      // Show overlay slightly before animation ends to avoid gap/flicker
      setTimeout(() => {
        if (data.card) {
          setOverlayCard(data.card);

          let dismissDelay = data.duration;
          setTimeout(() => {
            setOverlayCard(null);
          }, dismissDelay);
        }
      }, Math.max(250, data.duration - 666));

      // Clear animation after duration
      setTimeout(() => {
        setDrawingAnimation(null);
      }, data.duration);
    };

    socket.on(SocketEvent.DrawCardAnimation, onDrawCardAnimation);

    return () => {
      socket.off(SocketEvent.DrawCardAnimation, onDrawCardAnimation);
    };
  }, [socket]);

  const onDragEnd = (result: DropResult) => {
    setIsDragging(false);
    setTimeout(() => { isDraggingRef.current = false; }, 1000);
    console.debug('onDragEnd', result);
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

    // Handle reordering within hand
    if (source.droppableId.startsWith('hand-row-') && destination.droppableId.startsWith('hand-row-')) {
      const { cols } = calculateHandLayout(myHand.length, handAreaWidth);
      const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
      const destRowIndex = parseInt(destination.droppableId.replace('hand-row-', ''), 10);

      const sourceGlobalIndex = sourceRowIndex * cols + source.index;
      let destGlobalIndex = destRowIndex * cols + destination.index;

      // Fix row offset for cross-row drags
      if (destRowIndex > sourceRowIndex) {
        destGlobalIndex -= 1;
      }

      const draggedCard = myHand[sourceGlobalIndex];
      // Check if dragging a card that is part of the selection
      const isMultiMove = selectedCards.length > 1 && selectedCards.some(c => c.id === draggedCard.id);

      let newHand: Card[];

      if (isMultiMove) {
        // Get selected IDs for quick lookup
        const selectedIds = new Set(selectedCards.map(c => c.id));

        // Get ordered selection (to maintain relative order)
        const orderedSelection = myHand.filter(c => selectedIds.has(c.id));

        // Hand without ANY selected cards (final base)
        const handWithoutSelection = myHand.filter(c => !selectedIds.has(c.id));

        // Hand with ONLY the dragged card removed (for dnd reference)
        const handWithoutAnchor = myHand.filter(c => c.id !== draggedCard.id);

        console.debug('Multi-move trace', {
          destGlobalIndex,
          handWithoutAnchorLength: handWithoutAnchor.length,
          handWithoutAnchorIds: handWithoutAnchor.map(c => c.id),
          selectedIds: Array.from(selectedIds)
        });

        // Determine insertion reference
        // dndDestIndex points to an index in handWithoutAnchor
        // We need to find the first non-selected card at or after this position
        let trueReferenceCard: Card | null = null;

        // Start looking from the drop index
        // Handle append case
        if (destGlobalIndex >= handWithoutAnchor.length) {
          trueReferenceCard = null;
        } else {
          for (let i = destGlobalIndex; i < handWithoutAnchor.length; i++) {
            const candidate = handWithoutAnchor[i];
            if (!selectedIds.has(candidate.id)) {
              trueReferenceCard = candidate;
              break;
            }
          }
        }

        console.debug('trueReferenceCard', trueReferenceCard?.id);

        // Find insertion index in the clean hand
        let insertIndex = handWithoutSelection.length;
        if (trueReferenceCard) {
          const idx = handWithoutSelection.findIndex(c => c.id === trueReferenceCard!.id);
          if (idx !== -1) insertIndex = idx;
        }

        console.debug('insertIndex', insertIndex);

        newHand = [...handWithoutSelection];
        newHand.splice(insertIndex, 0, ...orderedSelection);

      } else {
        newHand = Array.from(myHand);
        const [reorderedItem] = newHand.splice(sourceGlobalIndex, 1);
        newHand.splice(destGlobalIndex, 0, reorderedItem);
      }

      // Ensure selection persists
      const currentSelection = selectedCards;
      setMyHand(newHand); // Optimistic update to prevent flicker
      if (currentSelection.length > 0) {
        setSelectedCards(currentSelection);
      }
      socket?.emit(SocketEvent.ReorderHand, { gameCode, newHand });
      return;
    }

    // Handle discard pile drop
    if (destination.droppableId === 'discard-pile') {
      const { cols } = calculateHandLayout(myHand.length, handAreaWidth);
      const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
      const sourceGlobalIndex = sourceRowIndex * cols + source.index;
      const draggedCard = myHand[sourceGlobalIndex];

      let cardsToPlay: Card[] = [];
      let newSelectedCards: Card[] = [];

      // Case 0: No Selection
      if (selectedCards.length === 0) {
        cardsToPlay = [draggedCard];
        newSelectedCards = [draggedCard];
      }
      // Case 1: Single Selection
      else if (selectedCards.length === 1) {
        const selected = selectedCards[0];
        // Dragging the selected card
        if (selected.id === draggedCard.id) {
          cardsToPlay = [draggedCard];
          newSelectedCards = [draggedCard];
        }
        // Dragging a different card
        else {
          // Check Shift-Drag for Developer Combo
          if (isShiftKeyPressed.current &&
                  selected.class === CardClass.Developer &&
                  draggedCard.class === CardClass.Developer &&
                  selected.name === draggedCard.name) {

            // "the second card is also selected and both cards are played"
            cardsToPlay = [selected, draggedCard];
            newSelectedCards = [selected, draggedCard];
          } else {
            // "the selected card is deselected and the second card is selected and played"
            cardsToPlay = [draggedCard];
            newSelectedCards = [draggedCard];
          }
        }
      }
      // Case 2: Combo Selection
      else if (selectedCards.length === 2) {
        // Dragging one of the combo cards
        if (selectedCards.some(c => c.id === draggedCard.id)) {
          cardsToPlay = selectedCards;
          newSelectedCards = selectedCards;
        } else {
          // "the combo is deselected and the new card is selected and played"
          cardsToPlay = [draggedCard];
          newSelectedCards = [draggedCard];
        }
      } else {
        // Fallback (shouldn't happen with max 2 selection)
        cardsToPlay = [draggedCard];
        newSelectedCards = [draggedCard];
      }

      // Update selection UI immediately
      setSelectedCards(newSelectedCards);

      // Now handle the actual play
      if (cardsToPlay.length > 0) {
        // Intercept FAVOR play
        if (cardsToPlay.length === 1 && cardsToPlay[0].class === CardClass.Favor) {
            setFavorVictimModalOpen(true);
            return;
        }

        // Intercept DEVELOPER combo
        if (cardsToPlay.length === 2 && cardsToPlay[0].class === CardClass.Developer && cardsToPlay[1].class === CardClass.Developer) {
             setDeveloperVictimModalOpen(true);
             return;
        }

        // Use centralized isCardPlayable logic for consistency
        const isAllowed = cardsToPlay.every(c => isCardPlayable(c));

        if (!isAllowed) {
          console.log(`Play blocked client-side: isCardPlayable returned false`);
          return;
        }

        // Emit the appropriate event to the server
        if (gameCode) {
          if (cardsToPlay.length === 1) {
            console.debug(`Emitting playCard: code=${gameCode}, card=${cardsToPlay[0].id}`);
            socket?.emit(SocketEvent.PlayCard, { gameCode, cardId: cardsToPlay[0].id, nonce: dragStartNonceRef.current });
          } else if (cardsToPlay.length === 2) {
            console.debug('Emitting playCombo for DEVELOPER cards');
            socket?.emit(SocketEvent.PlayCombo, { gameCode, cardIds: cardsToPlay.map(c => c.id), nonce: dragStartNonceRef.current });
          }
        } else {
          console.error("Game code not found, cannot play card.");
          return;
        }

        // Optimistic update and clear selection for successful plays
        // Delay update to avoid "Unable to find drag handle" warning from dnd library trying to restore focus to unmounted item.
        setTimeout(() => {
          setSelectedCards([]);
          setMyHand((prevHand: Card[]) => prevHand.filter(c => !cardsToPlay.some(pc => pc.id === c.id)));
        }, 50);
      }
      return; // Ensure we exit after handling the drop
    }
  };

  const onDragStart = (start: DragStart) => {
    if (drawingAnimation?.active) return;

    isDraggingRef.current = true;
    setIsDragging(true);
    if (gameState) dragStartNonceRef.current = gameState.nonce;
    console.debug('onDragStart', start);

    if (start.source.droppableId.startsWith('hand-row-')) {
      const { cols } = calculateHandLayout(myHand.length, handAreaWidth);
      const sourceRowIndex = parseInt(start.source.droppableId.replace('hand-row-', ''), 10);
      const sourceGlobalIndex = sourceRowIndex * cols + start.source.index;
      const draggedCard = myHand[sourceGlobalIndex];

      if (!draggedCard) return;

      // If Shift is held, try to add to selection (Combo)
      if (isShiftKeyPressed.current) {
        // "If there is a single DEVELOPER card selected and the player shift-clicks and drags another identical card..."
        if (selectedCards.length === 1) {
          const selected = selectedCards[0];
          if (selected.class === CardClass.Developer &&
                      draggedCard.class === CardClass.Developer &&
                      selected.name === draggedCard.name &&
                      selected.id !== draggedCard.id) {

            // Add to selection
            setSelectedCards([selected, draggedCard]);
          }
        }
      } else {
        // No Shift.
        // If dragged card is NOT in selection, select it (switch selection).
        if (!selectedCards.some(c => c.id === draggedCard.id)) {
          setSelectedCards([draggedCard]);
        }
      }
    }
  };
  const onDragUpdate = () => console.debug('onDragUpdate');

  if (!gameState || !socket) {
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

  const getPlayerClassName = (player: Player) => {
    let className = '';
    if (player.id === currentPlayerId) className += 'bg-success-subtle';
    if (player.isOut) className += ' text-decoration-line-through text-muted';
    if (player.isDisconnected) className += ' text-muted opacity-50';
    return className.trim();
  };

  const playersToDisplay = gameState.players;

  let turnStatus = '';
  let turnStatusBgColor = '';
  let turnStatusColor = 'black';

  if (gameState && me && currentPlayer) {
    if (me.isOut) {
      turnStatus = "You are OUT";
      turnStatusBgColor = 'lightcoral';
    } else {
      // Find the next VALID player (skip eliminated/disconnected)
      let nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
      let nextPlayerId = gameState.turnOrder[nextTurnIndex];

      for (let i = 0; i < gameState.turnOrder.length; i++) {
         const candidateId = gameState.turnOrder[nextTurnIndex];
         const candidate = gameState.players.find(p => p.id === candidateId);
         if (candidate && !candidate.isOut && !candidate.isDisconnected) {
             nextPlayerId = candidateId;
             break;
         }
         nextTurnIndex = (nextTurnIndex + 1) % gameState.turnOrder.length;
      }
      const nextPlayer = gameState.players.find(p => p.id === nextPlayerId);

      if (me.id === currentPlayerId) {
        if (gameState.turnPhase === TurnPhase.Exploding) {
          turnStatus = `Your cluster is exploding - debug it!`;
          turnStatusBgColor = 'red';
          turnStatusColor = 'white';
        } else {
          turnStatus = `It's your turn, ${nextPlayer.name} is next`;
          turnStatusBgColor = 'lightgreen';
          turnStatusColor = 'black'; // Default
        }
      } else if (me.id === nextPlayerId) {
        turnStatus = `It's ${currentPlayer.name}'s turn, your turn is next`;
        turnStatusBgColor = '#FFD580'; // light orange
      } else {
        turnStatus = `It's ${currentPlayer.name}'s turn`;
        turnStatusBgColor = 'lightblue';
      }
    }
  }

  const renderDiscardPile = () => {
    return (
      <Droppable droppableId="discard-pile">
        {(provided, snapshot) => (
          <div
            data-areaname="discard-pile"
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              width: getCardSize().width,
              height: getCardSize().height,
              border: (gameState && gameState.topDiscardCard)
                ? 'none'
                : (snapshot.isDraggingOver ? '2px dashed #00FF00' : '2px dashed #FFA500'),
              borderRadius: '25px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <h5 style={{ color: '#FFA500', position: 'absolute' }}>Discard Pile</h5>
            {gameState && gameState.topDiscardCard && (
              <Image
                src={gameState.topDiscardCard.imageUrl}
                alt={`${gameState.topDiscardCard.class}: ${gameState.topDiscardCard.name}`}
                fill
                sizes="(max-width: 768px) 100px, 150px"
                style={{ objectFit: 'contain', borderRadius: '10px' }}
                data-cardclass={gameState.topDiscardCard.class}
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
    const rows: Card[][] = [];
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
        data-areaname="hand"
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
                  <Draggable key={card.id} draggableId={card.id} index={index} isDragDisabled={!!drawingAnimation?.active}>
                    {(providedDraggable, snapshot) => {
                      const isSelected = selectedCards.some(sc => sc.id === card.id);
                      const shouldHide = isDragging && isSelected && !snapshot.isDragging;
                      const playable = isCardPlayable(card);

                      return (
                        <div
                          ref={providedDraggable.innerRef}
                          {...providedDraggable.draggableProps}
                          {...providedDraggable.dragHandleProps}
                          data-cardclass={card.class}
                          data-playable={playable}
                          onMouseDown={(e) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (providedDraggable.dragHandleProps as any)?.onMouseDown?.(e);
                            clickStartPosRef.current = { x: e.clientX, y: e.clientY };
                          }}
                          onClickCapture={(e) => {
                            if (isDraggingRef.current) {
                              e.stopPropagation();
                              e.preventDefault();
                            }
                          }}
                          className="m-1"
                          style={{
                            boxShadow: isSelected ? '0 0 0 3px blue' : 'none',
                            outline: 'none', // Prevent browser focus ring
                            borderRadius: '5px',
                            width: `${cardWidth}px`,
                            height: `${cardWidth * 1.4}px`,
                            boxSizing: 'content-box',
                            cursor: playable ? 'pointer' : 'default',
                            position: 'relative',
                            opacity: shouldHide ? 0 : (playable ? 1 : 0.6),
                            ...providedDraggable.draggableProps.style,
                          }}
                          onClick={(event) => handleCardClick(card, event)}
                          onDoubleClick={() => handleCardDoubleClick(card)}
                        >
                          {snapshot.isDragging && selectedCards.length > 1 && isSelected && (
                            <>
                              {selectedCards.filter(sc => sc.id !== card.id).map((sc, i) => (
                                <div
                                  key={sc.id}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    transform: `translate(${15 * (i + 1)}px, ${15 * (i + 1)}px) rotate(${5 * (i + 1)}deg)`,
                                    zIndex: -1 - i,
                                    borderRadius: '5px',
                                    boxShadow: '0 0 0 3px blue',
                                    background: 'white',
                                  }}
                                >
                                  <Image
                                    src={sc.imageUrl}
                                    alt={`${sc.class}: ${sc.name}`}
                                    width={cardWidth}
                                    height={cardWidth * 1.4}
                                    draggable={false}
                                  />
                                </div>
                              ))}
                            </>
                          )}
                          <Image
                            src={card.imageUrl}
                            alt={`${card.class}: ${card.name} (${playable ? 'playable' : 'not playable'})`}
                            width={cardWidth}
                            height={cardWidth * 1.4}
                            draggable={false}
                            style={{ zIndex: 1, position: 'relative', backgroundColor: 'white', borderRadius: '5px' }}
                          />
                        </div>
                      );
                    }}
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

  // Determine which card to show in overlay: Drawing card takes precedence over inspection
  let activeOverlayCard = overlayCard;
  if ((gameState?.turnPhase === TurnPhase.Exploding || gameState?.turnPhase === TurnPhase.Upgrading) && gameState?.overlayCard) {
    // Only show persistent overlay for players who are NOT the active player
    // AND suppress it if animation is active (so they see the animation instead)
    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId && !drawingAnimation?.active) {
      activeOverlayCard = gameState.overlayCard;
    }
  }

  // "Game play is paused" - block dismiss if drawing
  const isDrawingPause = !!drawingAnimation?.active;

  return (
    <DragDropContext onDragEnd={onDragEnd} onDragStart={onDragStart} onDragUpdate={onDragUpdate}>
      <Container fluid className="p-3 d-flex flex-column" style={{ height: '100vh', overflow: 'hidden' }}>
        {activeOverlayCard && (
          <div
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              zIndex: 1000,
            }}
            onClick={() => {
              if (isDrawingPause) {
                setDrawingAnimation(null);
              } else {
                setOverlayCard(null);
              }
            }}
          >
            <Image src={activeOverlayCard.imageUrl}
              alt={`${activeOverlayCard.class}: ${activeOverlayCard.name}`}
              width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
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
                  <Image src={card.imageUrl}
                    alt={`${card.class}: ${card.name}`}
                    width={100} height={140} />
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
                  <Image src={card.imageUrl}
                    alt={`${card.class}: ${card.name}`}
                    width={100} height={140} />
                  <div style={{color: 'white', textAlign: 'center'}}>{index}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Row className="flex-grow-1">
          <Col md={3}>
            <h5>Players</h5>
            <ListGroup
              data-areaname="player-list"
            >
              {playersToDisplay.map((player) => (
                <ListGroup.Item key={player.id} className={getPlayerClassName(player)}>
                  <div>
                    <span>{player.name} {player.id === playerId && "(that's you)"} {player.isDisconnected && '(Disconnected)'}</span>
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
                  disabled={(gameState.debugCardsCount ?? 0) === 0}
                >
                  Give me a DEBUG card
                </Button>
                <Button variant="warning" size="sm" onClick={handleDevDrawCard} disabled={(gameState.safeCardsCount ?? 0) === 0}>Give me a safe card</Button>
                <Button variant="warning" size="sm" onClick={handlePutCardBack} disabled={myHand.length === 0}>Put a card back</Button>
                <Button variant="info" size="sm" onClick={handleShowDeck}>Show the deck</Button>
                <Button variant="info" size="sm" onClick={handleShowRemovedPile}>Show removed cards</Button>
              </div>
            )}
            {/* Timer Area */}
            <div className="timer-area mt-3 text-center"
              data-areaname="timer"
              data-turnphase={gameState.turnPhase}
            >
              {(gameState.turnPhase === TurnPhase.Reaction) && countdown > 0 && (
                <>
                  {(gameState.lastActorName && me?.name === gameState.lastActorName) ? (
                    <h4 className="text-success">Waiting for other players to react</h4>
                  ) : (
                    <h4 className="text-warning">Want to react? Act fast!</h4>
                  )}
                  <h2 className="display-3">{countdown}</h2>
                </>
              )}
              {(gameState.turnPhase === TurnPhase.Exploding) && (
                 <>
                   {playerId === gameState.turnOrder[gameState.currentTurnIndex] ? (
                     <h4 className="text-danger">PLAY A DEBUG CARD!</h4>
                   ) : (
                     <h4 className="text-warning">Waiting for {gameState.players.find(p => p.id === gameState.turnOrder[gameState.currentTurnIndex])?.name} to debug their cluster...</h4>
                   )}
                 </>
              )}
            </div>
          </Col>
          <Col md={9} className="d-flex flex-column position-relative" style={{ backgroundColor: '#228B22', borderRadius: '10px', padding: `${FIXED_TABLE_PADDING}px`, overflow: 'hidden', minHeight: 0 }} ref={tableAreaRef}>
            <div
              className="d-flex justify-content-center align-items-center flex-grow-1"
              style={{ gap: `${FIXED_PILE_GAP}px` }}
            >
              {/* Draw Pile */}
              <div className="d-flex flex-column align-items-center">
                <div
                  className="draw-pile position-relative" 
                  data-areaname="draw-pile"
                  style={{ 
                    width: getCardSize().width, 
                    height: getCardSize().height,
                    cursor: 'pointer',
                    borderRadius: '5px' 
                  }}
                  onClick={handleDrawClick}
                >
                  <Image
                    src={(drawingAnimation?.active && drawingAnimation.nextCardImageUrl) || gameState?.drawPileImage || "/art/back.png"}
                    alt={`Draw Pile: ${gameState.topDrawPileCard ? gameState.topDrawPileCard.class : 'Face-down card'}`}
                    data-cardclass={gameState.topDrawPileCard ? gameState.topDrawPileCard.class : 'UNKNOWN'}
                    width={getCardSize().width}
                    height={getCardSize().height} />

                  {(drawingAnimation?.active) && (
                    <div className="static-card-vanish" style={{ animationDuration: `${drawingAnimation.duration}ms` }}>
                       <Image
                         src={drawingAnimation.currentPileImageUrl || "/art/back.png"}
                         alt={`Draw Pile: next card'}`}
                         width={getCardSize().width}
                         height={getCardSize().height} />
                    </div>
                  )}

                  {(drawingAnimation?.active) && (
                    <div className="hand-animation" style={{
                      animation: `${drawingAnimation.card ? 'drawCardSelf' : 'drawCard'} ${drawingAnimation.duration ? drawingAnimation.duration/1000 : 4}s ease-in-out forwards`,
                      transform: `translateX(-50%) ${drawingAnimation.card ? 'rotate(180deg)' : ''}`
                    }}>
                      <div className="hand-open" style={{ animation: `handReachIn ${drawingAnimation.duration ? drawingAnimation.duration*0.75/1000 : 2}s step-end forwards` }}>
                        <Image src="/art/hand_open.png" alt="Hand Open" width={250} height={500} />
                      </div>
                      <div className="hand-closed" style={{ animation: `handPullBack ${drawingAnimation.duration ? drawingAnimation.duration*0.75/1000 : 2}s step-start forwards` }}>
                        <Image src="/art/hand_closed.png" alt="Hand Closed" width={250} height={500} />
                      </div>
                      <div className="hand-card" style={{
                        animation: `handPullBack ${drawingAnimation.duration ? drawingAnimation.duration*0.75/1000 : 2}s step-start forwards`
                      }}>
                        <Image
                          src={drawingAnimation.currentPileImageUrl || "/art/back.png"}
                          alt={`${gameState.topDrawPileCard ? gameState.topDrawPileCard.class : 'Face-down card'}`}
                          width={getCardSize().width}
                          height={getCardSize().height}
                          style={{
                            position: 'absolute', 
                            left: `${(100 - getCardSize().width) / 2}px`,
                            top: `${(180 - getCardSize().height) / 2}px`,
                            transform: drawingAnimation.card ? 'rotate(180deg)' : 'none'
                          }} /* Centered within hand div */
                        />
                      </div>
                    </div>
                  )}
                  {gameState.devMode && <div className="text-white position-absolute start-50 translate-middle-x draw-pile-count" style={{ top: '100%' }}>({gameState.drawPileCount !== undefined ? gameState.drawPileCount : '??'} cards)</div>}
                </div>
              </div>

              {/* Discard Pile */}
              <div className="d-flex flex-column align-items-center">
                <div style={{ width: getCardSize().width, height: getCardSize().height, position: 'relative' }}>
                  {renderDiscardPile()}
                  {gameState.devMode && <div className="text-white position-absolute start-50 translate-middle-x discard-pile-count" style={{ top: '100%' }}>({gameState.discardPileCount !== undefined ? gameState.discardPileCount : '??'} cards)</div>}
                </div>
              </div>
            </div>
          </Col>
        </Row>
        <Row style={{ flexGrow: isSpectator ? 1 : 0 }}>
          <Col className="d-flex flex-column">
            <div
              data-areaname="message"
              style={{
                backgroundColor: '#f0f0f0',
                borderRadius: '5px', margin: '0.5rem 0', padding: '0.5rem',
                height: isSpectator ? 'auto' : '120px',
                flexGrow: isSpectator ? 1 : 0,
                display: 'flex', flexDirection: 'column',
              }}
            >
              <div
                data-areaname="turn"
                style={{
                  textAlign: 'center', padding: '0.25rem',
                  backgroundColor: turnStatusBgColor,
                  color: turnStatusColor,
                  borderRadius: '5px', flexShrink: 0,
                }}
              >
                <strong>{turnStatus}</strong>
              </div>

              <div
                ref={messageAreaRef}
                data-areaname="log"
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
          <div className="bg-light p-3 d-flex flex-column position-relative"
            style={{
              borderTop: '1px solid #ccc',
              flexShrink: 0,
              height: '35vh',
              minHeight: '250px'
            }}
            onClick={() => {
              if (isDraggingRef.current) return;
              setSelectedCards([]);
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
              style={{ zIndex: 10 }}
              onClick={() => setShowLeaveModal(true)}
            >
              Leave Game
            </Button>
          </div>
        )}
        {isSpectator && (
          <Row className="bg-light p-3 position-relative" style={{ borderTop: '1px solid #ccc', flexShrink: 0 }}>
            <div className="d-flex justify-content-end w-100">
              <Button
                variant="secondary"
                className="w-auto"
                style={{ zIndex: 10 }}
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

        <Modal show={!!replayModal?.show} onHide={() => setReplayModal(null)}>
          <Modal.Header closeButton>
            <Modal.Title>Game Updated</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>{replayModal?.reason}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setReplayModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleReplayConfirm} autoFocus>Play it!</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={!!upgradeInsertionModal?.show} onHide={() => {}} backdrop="static" keyboard={false}>
          <Modal.Header>
            <Modal.Title>Put the UPGRADE CLUSTER card back into the deck</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>You can put this card back into the deck anywhere you like.</p>
            <p>There are {gameState?.drawPileCount !== undefined ? gameState.drawPileCount : '??'} cards in the deck, where do you want to put the UPGRADE CLUSTER card?</p>
            <p>Position 0 is the top of the deck, {gameState?.drawPileCount !== undefined ? gameState.drawPileCount : '??'} is the bottom.</p>
            <Form.Control
              type="number"
              min={0}
              max={gameState?.drawPileCount || 50}
              value={insertionIndex}
              onChange={(e) => setInsertionIndex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = parseInt(String(insertionIndex), 10);
                  const max = gameState?.drawPileCount ?? 50;
                  if (!isNaN(val) && val >= 0 && val <= max) {
                    handleUpgradeInsertConfirm();
                  }
                }
              }}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="primary"
              onClick={handleUpgradeInsertConfirm}
              disabled={(() => {
                const val = parseInt(String(insertionIndex), 10);
                const max = gameState?.drawPileCount ?? 50;
                return isNaN(val) || val < 0 || val > max;
              })()}
            >OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={!!insertionModal?.show} onHide={() => {}} backdrop="static" keyboard={false}>
          <Modal.Header>
            <Modal.Title>You&apos;re safe, for now</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>You can put this card back into the deck anywhere you like.</p>
            <p>There are {gameState?.drawPileCount !== undefined ? gameState.drawPileCount : '??'} cards in the deck, where do you want to hide the EXPLODING CLUSTER card?</p>
            <p>Position 0 is the top of the deck, {gameState?.drawPileCount !== undefined ? gameState.drawPileCount : '??'} is the bottom.</p>
            <Form.Control
              type="number"
              min={0}
              max={insertionModal?.maxIndex}
              value={insertionIndex}
              onChange={(e) => setInsertionIndex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = parseInt(String(insertionIndex), 10);
                  const max = insertionModal?.maxIndex ?? 50;
                  if (!isNaN(val) && val >= 0 && val <= max) {
                    handleInsertConfirm();
                  }
                }
              }}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="primary"
              onClick={handleInsertConfirm}
              disabled={(() => {
                const val = parseInt(String(insertionIndex), 10);
                const max = insertionModal?.maxIndex ?? 50;
                return isNaN(val) || val < 0 || val > max;
              })()}
            >OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={!!seeTheFutureCards} onHide={handleDismissSeeTheFuture} backdrop="static" keyboard={false} centered fullscreen={true}>
          <Modal.Header>
            <Modal.Title>See The Future</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="d-flex flex-wrap justify-content-center" style={{ gap: '20px' }}>
              {seeTheFutureCards?.map((card, index) => (
                <Image
                  key={index}
                  src={card.imageUrl}
                  alt={card.name}
                  width={getEnlargedCardSize().width * 0.5}
                  height={getEnlargedCardSize().height * 0.5}
                  style={{ minWidth: getCardSize().width, maxWidth: '40vw', height: 'auto', objectFit: 'contain' }}
                />
              ))}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={handleDismissSeeTheFuture} autoFocus>Done</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={favorVictimModalOpen} onHide={() => setFavorVictimModalOpen(false)} backdrop="static" keyboard={false} centered>
          <Modal.Header>
            <Modal.Title>Ask for a Favor</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Choose a player to ask for a favor:</p>
            <div className="list-group">
              {gameState?.players.filter(p => p.id !== playerId && !p.isOut && p.cards > 0).map(p => (
                <button
                  key={p.id}
                  className={`list-group-item list-group-item-action ${favorVictimSelection === p.id ? 'active' : ''}`}
                  onClick={() => setFavorVictimSelection(p.id)}
                >
                  {p.name} ({p.cards} cards)
                </button>
              ))}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setFavorVictimModalOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!favorVictimSelection} onClick={() => {
                const favorCard = myHand.find(c => c.class === CardClass.Favor);
                if (favorCard && gameCode) {
                    socket?.emit(SocketEvent.PlayCard, { gameCode, cardId: favorCard.id, nonce: gameState?.nonce, victimId: favorVictimSelection });
                    setFavorVictimModalOpen(false);
                    setFavorVictimSelection(null);
                    setSelectedCards([]);
                }
            }}>Ask Favor</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={favorCardChoiceModalOpen} onHide={() => {}} backdrop="static" keyboard={false} centered>
          <Modal.Header>
            <Modal.Title>Grant a Favor ({favorCountdown}s)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Someone asked you for a favor! Choose a card to give them:</p>
            <div className="d-flex flex-wrap justify-content-center" style={{ gap: '10px' }}>
              {myHand.map((card, index) => (
                <div 
                  key={index} 
                  onClick={() => setFavorSelectedCardId(card.id)}
                  style={{ 
                    border: favorSelectedCardId === card.id ? '3px solid blue' : '1px solid gray',
                    borderRadius: '5px',
                    cursor: 'pointer'
                  }}
                >
                  <Image src={card.imageUrl} alt={card.name} width={80} height={112} />
                </div>
              ))}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" disabled={!favorSelectedCardId} onClick={() => {
              if (gameCode && favorSelectedCardId) {
                socket?.emit(SocketEvent.ResolveFavorCard, { gameCode, cardId: favorSelectedCardId });
                setFavorCardChoiceModalOpen(false);
                setFavorSelectedCardId(null);
              }
            }}>Give Card</Button>
          </Modal.Footer>
        </Modal>

        {favorOutcomeCard && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
          }}>
            <h2>You received:</h2>
            <Image src={favorOutcomeCard.imageUrl} alt={favorOutcomeCard.name} width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
          </div>
        )}

        <Modal show={developerVictimModalOpen} onHide={() => setDeveloperVictimModalOpen(false)} backdrop="static" keyboard={false} centered>
          <Modal.Header>
            <Modal.Title>Steal a Card</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Choose a player to steal from:</p>
            <div className="list-group">
              {gameState?.players.filter(p => p.id !== playerId && !p.isOut && p.cards > 0).map(p => (
                <button
                  key={p.id}
                  className={`list-group-item list-group-item-action ${favorVictimSelection === p.id ? 'active' : ''}`}
                  onClick={() => setFavorVictimSelection(p.id)}
                >
                  {p.name} ({p.cards} cards)
                </button>
              ))}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setDeveloperVictimModalOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!favorVictimSelection} onClick={() => {
                if (selectedCards.length === 2 && gameCode && favorVictimSelection) {
                    socket?.emit(SocketEvent.PlayCombo, { gameCode, cardIds: selectedCards.map(c => c.id), nonce: gameState?.nonce, victimId: favorVictimSelection });
                    setDeveloperVictimModalOpen(false);
                    setFavorVictimSelection(null);
                    setSelectedCards([]);
                }
            }}>Steal Card</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={developerCardChoiceCount !== null} onHide={() => {}} backdrop="static" keyboard={false} centered>
          <Modal.Header>
            <Modal.Title>Choose a Card to Steal</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Pick a card from the victim&apos;s hand:</p>
            <div className="d-flex flex-wrap justify-content-center" style={{ gap: '10px' }}>
              {Array.from({ length: developerCardChoiceCount || 0 }).map((_, index) => (
                <div 
                    key={index} 
                    onClick={() => {
                        if (gameCode) {
                            socket?.emit(SocketEvent.ResolveDeveloperCard, { gameCode, index });
                            setDeveloperCardChoiceCount(null);
                        }
                    }}
                    style={{ 
                        border: '1px solid gray',
                        borderRadius: '5px',
                        cursor: 'pointer'
                    }}
                >
                    <Image src="/art/back.png" alt="Card Back" width={80} height={112} />
                </div>
              ))}
            </div>
          </Modal.Body>
        </Modal>

        {developerStolenCard && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 2000,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
          }}>
            <h2>{gameState?.lastActorName} stole your:</h2>
            <Image src={developerStolenCard.imageUrl} alt={developerStolenCard.name} width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
          </div>
        )}

        <Modal show={!!gameEndData} onHide={handleGameEndConfirm} backdrop="static" keyboard={false} centered>
          <Modal.Header>
            <Modal.Title>
              {
                gameEndData?.winner === playerName
                  ? "You win!"
                  : `${gameEndData?.winner} wins!`
              }
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              {
                gameEndData?.winner === playerName
                  ? (gameEndData?.winType === WinType.Explosion
                    ? "You have the last operational cluster."
                    : (gameEndData?.winType === WinType.Attrition
                      ? "Winning by attrition is still winning."
                      : `Unknown win condition: ${gameEndData?.winType}.`))
                  : `${gameEndData?.winner} wins, with the last operational cluster.`
              }
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={handleGameEndConfirm} autoFocus>OK</Button>
          </Modal.Footer>
        </Modal>
      </Container>
    </DragDropContext>
  );
}
