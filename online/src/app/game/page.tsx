// Copyright 2025 Tim Hockin

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Row, Col, ListGroup, Button, Modal, Form } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { Card, Player, SocketEvent, CardClass, TurnPhase, WinType } from '../../api';
import { DragDropContext, Droppable, Draggable, DropResult, DragStart } from '@hello-pangea/dnd';
import Image from 'next/image';

const FIXED_TABLE_PADDING = 20; // px
const FIXED_PILE_GAP = 30; // px

// Card size bounds (in the hand area)
const CARD_MIN_WIDTH_PX = 85;
const CARD_MAX_WIDTH_PX = 200;
const CARD_ASPECT_RATIO = 1024 / 1434; // width / height of art
const CARD_MARGIN_X_PX = 4; // m-1 means 0.25rem, assuming 1rem=16px, so 4px on each side
const MAX_CARDS_PER_ROW = 12;

// Fallback values
const CARD_DEFAULT_WIDTH_PX = 100;

// Minimum visibility threshold for rows (percentage)
const MIN_ROW_VISIBILITY = 0.66;

// How long a card is displayed after being drawn or stolen
const CARD_DISMISS_TIMEOUT_MS = 2500;

// How long before auto-dismiss for client-only choice dialogs (no server timer)
const CHOICE_DISMISS_TIMEOUT_S = 15;

export default function GameScreen() {
  const router = useRouter();
  const { socket, gameCode, gameState, playerName, playerId, myHand, setMyHand, resetState, isLoading, gameEndData, gameMessages } = useSocket();

  // Helper function to assert required values and log BUGs when they're missing
  const assertDefined = <T,>(value: T | null | undefined, name: string, context?: string): T => {
    if (value === null || value === undefined) {
      const msg = `BUG: ${name} is ${value === null ? 'null' : 'undefined'}${context ? ` in ${context}` : ''}`;
      console.error(msg);
      // In production, you might want to show a user-visible error or send to error tracking
      throw new Error(msg);
    }
    return value;
  };

  // Helper function to check if a given player is the current player
  // Returns true if the playerId matches the current player's ID, false otherwise
  // Logs an error if the current player index is invalid
  // Accepts gameState (which may be null/undefined) and playerId (which may be null/undefined)
  // This centralizes the logic and error checking for current player comparisons
  const isCurrentPlayer = (gs: typeof gameState, pid: string | null | undefined): boolean => {
    if (!gs || !pid) return false;
    if (gs.currentPlayer < 0 || gs.currentPlayer >= gs.players.length) {
      console.error(`BUG: Current player index ${gs.currentPlayer} is out of bounds`);
      return false;
    }
    const currentPlayer = gs.players[gs.currentPlayer];
    if (!currentPlayer) {
      console.error(`BUG: Current player at index ${gs.currentPlayer} is null/undefined`);
      return false;
    }
    return currentPlayer.id === pid;
  };

  // Tracks the current window height for responsive card sizing
  // Updated on window resize to recalculate card dimensions
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  // Percentage height of the upper half of the screen (players/table area)
  // User can drag the resize bar to adjust this between 20% and 80%
  // Lower half shows messages and hand
  const [upperHalfHeight, setUpperHalfHeight] = useState<number>(50);
  // Percentage height of the log area within the lower half (rest is hand area)
  // User can drag the resize bar to adjust this between 20% and 80% of the lower half
  const [lowerHalfLogHeight, setLowerHalfLogHeight] = useState<number>(50);
  // Stores the dimensions of the table area (where draw/discard piles are displayed)
  // Used to calculate optimal card sizes for the table cards
  const [tableAreaSize, setTableAreaSize] = useState({ width: 0, height: 0 });
  // Stores the current width of the hand container
  // Used to calculate how many cards fit per row in the hand layout
  const [handAreaWidth, setHandAreaWidth] = useState(0);
  // Stores the current height of the hand container
  // Used to calculate how many rows of cards fit in the hand layout
  const [handAreaHeight, setHandAreaHeight] = useState(0);

  // Refs to DOM elements - these don't trigger re-renders when accessed, used for direct DOM manipulation
  // Reference to the table area div, used to measure its size for card layout calculations
  const tableAreaRef = useRef<HTMLDivElement>(null);
  // Reference to the message log area, used to auto-scroll to bottom when new messages arrive
  const messageAreaRef = useRef<HTMLDivElement>(null);
  // Track if user has scrolled up from the bottom (if false, we should auto-scroll)
  const isUserScrolledUpRef = useRef(false);
  // Reference to the hand container, used to measure its size for card layout calculations
  const handAreaRef = useRef<HTMLDivElement>(null);

  // Refs for resize drag tracking - these store values that don't need to trigger re-renders
  // Tracks whether the user is currently dragging the resize bar between upper and lower halves
  const isResizingHalfRef = useRef(false);
  // Stores the mouse Y position when resize drag started (upper/lower split)
  const resizeHalfStartPosRef = useRef({ y: 0 });
  // Stores the upper half height percentage when resize drag started
  const resizeHalfStartHeightRef = useRef(50);
  // Tracks whether the user is currently dragging the resize bar between log and hand areas
  const isResizingLowerHalfRef = useRef(false);
  // Stores the mouse Y position when resize drag started (log/hand split)
  const resizeLowerHalfStartPosRef = useRef({ y: 0 });
  // Stores the lower half log height percentage when resize drag started
  const resizeLowerHalfStartHeightRef = useRef(50);

  // A ref that always holds the latest gameState value
  // Used in event handlers/callbacks to avoid stale closures (getting old gameState values)
  // Unlike gameState (which triggers re-renders), this ref can be accessed without causing re-renders
  const gameStateRef = useRef(gameState);

  // Controls visibility of the "Leave Game" confirmation modal
  const [showLeaveGameModal, setShowLeaveGameModal] = useState(false);
  // Stores currently selected cards in the hand (for single card or combo selection)
  // Used to highlight selected cards and determine which cards to play when dropped
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  // Stores the card currently being inspected (shown in enlarged overlay)
  // Set when user double-clicks a card or when a card is drawn/stolen
  const [inspectCardOverlay, setInspectCardOverlay] = useState<Card | null>(null);
  // Countdown timer (in seconds) for the reaction phase
  // Shows how much time players have to play reaction cards (NAK, NOW cards)
  const [reactionCountdown, setReactionCountdown] = useState(0);
  // Stores the interval ID for the reaction countdown timer
  // Used to clear the interval when the countdown ends or component unmounts
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Countdown timer (in seconds) for choice modals (victim selection, card choice)
  // Used to show how much time is left to make a choice before auto-closing
  const [choiceCountdown, setChoiceCountdown] = useState(0);

  // Tracks if a card drag operation is currently in progress
  // Used to hide selected cards during drag and prevent click events
  const [isDragging, setIsDragging] = useState(false);
  // Stores the card currently being dragged
  // Used to show drag preview and determine drop target validity
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  // Refs for drag-and-drop state - these don't trigger re-renders, avoiding unnecessary updates during drags
  // Tracks if a drag operation is in progress (used to prevent click events during drag)
  const isDraggingRef = useRef(false);
  // Stores mouse position when mouse down occurs, used to distinguish clicks from drags
  const clickStartPosRef = useRef({ x: 0, y: 0 });
  // Stores the game nonce when an operation (play card, etc.) started
  // Used to detect if game state changed during the operation (prevents race conditions)
  const opStartNonceRef = useRef<string>('');
  // Tracks if Shift key is currently held down (for combo card selection)
  const isShiftKeyPressed = useRef(false);

  // Stores animation state when a card is being drawn
  // Contains card data, player ID, duration, and image URLs for the animation
  // When set, triggers the hand animation that shows a card being drawn from the pile
  const [drawCardAnimation, setDrawCardAnimation] = useState<{ card?: Card, playerId?: string, duration?: number, nextCardImageUrl?: string, currentPileImageUrl?: string } | null>(null);
  // Stores error information when a game operation conflicts with server state
  // Shows a modal explaining why an action was rejected (e.g., game state changed)
  const [opConflictModal, setOpConflictModal] = useState<{ reason: string, cardId?: string, cardIds?: string[] } | null>(null);
  // Controls the modal for reinserting an EXPLODING CLUSTER card
  // When set, shows a modal asking where to put the card back in the deck (0 to maxIndex)
  const [explodingReinsertModal, setExplodingReinsertModal] = useState<{ maxIndex: number } | null>(null);
  // Controls the modal for reinserting an UPGRADE CLUSTER card
  // When set, shows a modal asking where to put the card back in the deck (0 to maxIndex)
  const [upgradeReinsertModal, setUpgradeReinsertModal] = useState<{ maxIndex: number } | null>(null);
  // The position in the deck where the player wants to reinsert a cluster card
  // Can be a number (0 = top, maxIndex = bottom) or a string (from input field before parsing)
  const [reinsertIndex, setReinsertIndex] = useState<string | number>(0);
  // Stores the cards shown in the "See The Future" overlay
  // When set, displays an overlay showing the top N cards of the deck
  const [seeTheFutureCards, setSeeTheFutureCards] = useState<Card[] | null>(null);
  // Controls visibility of the "Choose a victim for Favor" modal
  // Opens when player plays a FAVOR card and there are multiple possible victims
  const [favorVictimModalOpen, setFavorVictimModalOpen] = useState(false);
  // Stores the selected player ID when choosing a Favor victim
  // Used to track which player the user has selected in the victim selection modal
  const [favorVictimSelection, setFavorVictimSelection] = useState<string | null>(null);
  // Controls the modal where a player chooses which card to give for a Favor
  // Contains the name of the player who asked for the favor
  const [favorCardChoiceModal, setFavorCardChoiceModal] = useState<{ stealerName?: string } | null>(null);
  // Stores the card received from a Favor action
  // When set, shows an overlay displaying the card that was received
  const [favorResultCardOverlay, setFavorResultCardOverlay] = useState<Card | null>(null);
  // Controls visibility of the "Choose a victim to steal from" modal
  // Opens when player plays a DEVELOPER combo and there are multiple possible victims
  const [stealCardVictimModalOpen, setStealCardVictimModalOpen] = useState(false);
  // Controls the modal where a player chooses which card to steal
  // Contains the victim's name and hand size (number of face-down cards to choose from)
  const [stealCardChoiceModal, setStealCardChoiceModal] = useState<{ handSize: number, victimName?: string } | null>(null);
  // Stores the card stolen via DEVELOPER combo
  // When set, shows an overlay displaying the card that was stolen
  const [stealCardResultOverlay, setStealCardResultOverlay] = useState<Card | null>(null);
  // Controls visibility of error modal when no valid victims exist
  // Shows when trying to play FAVOR or DEVELOPER combo but no players have cards
  const [noPossibleVictimModalOpen, setNoPossibleVictimModalOpen] = useState(false);
  // Stores the message to show when this player becomes the game owner
  // Set when the previous game owner leaves and this player is promoted
  const [hostPromotionModal, setHostPromotionModal] = useState<string | null>(null);
  // Tracks if the mouse is hovering over the discard pile during a drag
  // Used to change cursor style and show visual feedback for valid/invalid drop targets
  const [isHoveringDiscard, setIsHoveringDiscard] = useState(false);

  // DEVMODE state
  // Stores all cards in the draw pile (dev mode only)
  // When set, shows an overlay displaying all cards in the deck in order
  const [deckCardsOverlay, setDeckCardsOverlay] = useState<Card[] | null>(null);
  // Stores all cards in the removed pile (dev mode only)
  // When set, shows an overlay displaying all cards that have been removed from the game
  const [removedCardsOverlay, setRemovedCardsOverlay] = useState<Card[] | null>(null);

  // Track Shift key state for combo card selection
  // Registers global keyboard listeners to track when Shift is pressed/released
  // Empty dependency array means this only runs once on mount
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

  // Countdown timer for "Grant a Favor" card choice modal
  // When the modal opens, starts a 1-second interval that decrements the countdown
  // When countdown reaches 0, automatically closes the modal
  useEffect(() => {
    if (favorCardChoiceModal) {
      // Don't set choiceCountdown here, use the value from the event handler
      const interval = setInterval(() => {
        setChoiceCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setFavorCardChoiceModal(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [favorCardChoiceModal]);

  // Countdown timer for "Choose a Card to Steal" modal
  // When the modal opens, starts a 1-second interval that decrements the countdown
  // When countdown reaches 0, automatically closes the modal
  useEffect(() => {
    if (stealCardChoiceModal !== null) {
      // Don't set choiceCountdown here, use the value from the event handler
      const interval = setInterval(() => {
        setChoiceCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setStealCardChoiceModal(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [stealCardChoiceModal]);

  // Countdown timer for victim selection modals (Favor and Steal Card)
  // When either modal opens, starts a 1-second interval that decrements the countdown
  // When countdown reaches 0, automatically closes both modals
  useEffect(() => {
    if (favorVictimModalOpen || stealCardVictimModalOpen) {
      const interval = setInterval(() => {
        setChoiceCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setFavorVictimModalOpen(false);
            setStealCardVictimModalOpen(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [favorVictimModalOpen, stealCardVictimModalOpen]);

  // Detect when this player becomes the game owner (host promotion)
  // Compares previous and current gameState to detect ownership change
  // Shows a modal congratulating the player on their promotion
  useEffect(() => {
    const prevGameState = gameStateRef.current;
    if (prevGameState && gameState) {
      if (prevGameState.gameOwnerId !== playerId && gameState.gameOwnerId === playerId) {
        const prevOwner = prevGameState.players.find(p => p.id === prevGameState.gameOwnerId);
        const prevOwnerName = prevOwner ? prevOwner.name : 'The previous host';
        setTimeout(() => {
          setHostPromotionModal(`${prevOwnerName} left the game, so you have been selected as the new game owner. Congratulations on your promotion!`);
        }, 0);
      }
    }
  }, [gameState, playerId]);

  // Keep gameStateRef in sync with gameState
  // This ensures event handlers always have access to the latest game state
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // Redirect to home page if game state is lost (e.g., server disconnected, game ended)
  // Only redirects if not loading and not showing game end data
  useEffect(() => {
    if (!gameState && !isLoading && !gameEndData) {
      router.push('/');
    }
  }, [gameState, isLoading, router, gameEndData, myHand, playerId, gameCode]);

  // Show/hide the "reinsert exploding cluster" modal based on game phase
  // When it's this player's turn and the phase is ExplodingReinserting, opens the modal
  // Closes the modal when phase changes or it's not this player's turn
  useEffect(() => {
    if (!gameState) return; // Early return if gameState not loaded yet

    // Detect if we are in ExplodingReinserting phase and need to show Insertion Modal
    if (gameState.turnPhase === TurnPhase.ExplodingReinserting) {
      if (isCurrentPlayer(gameState, playerId)) {
        if (!explodingReinsertModal) {
          const maxReinsert = gameState.maxReinsert;
          if (maxReinsert === undefined || maxReinsert === null) {
            console.error('BUG: maxReinsert is undefined in ExplodingReinserting phase');
          }
          // I know we are not supposed to set state from an effect, but I
          // don't know enough to do this "right" and AIs have all failed to
          // help.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setExplodingReinsertModal({ maxIndex: maxReinsert ?? 50 });
        }
      }
    } else {
      if (explodingReinsertModal) setExplodingReinsertModal(null);
    }
  }, [gameState, playerId, myHand, explodingReinsertModal, inspectCardOverlay]);

  // Show/hide the "reinsert upgrade cluster" modal based on game phase
  // When it's this player's turn and the phase is Upgrading, opens the modal
  // Closes the modal when phase changes or it's not this player's turn
  useEffect(() => {
    if (!gameState) return; // Early return if gameState not loaded yet

    // Detect if we are in Upgrading phase and need to show Insertion Modal
    if (gameState.turnPhase === TurnPhase.Upgrading) {
      if (isCurrentPlayer(gameState, playerId)) {
        if (!upgradeReinsertModal) {
          const maxReinsert = gameState.maxReinsert;
          if (maxReinsert === undefined || maxReinsert === null) {
            console.error('BUG: maxReinsert is undefined in Upgrading phase');
          }
          // I know we are not supposed to set state from an effect, but I
          // don't know enough to do this "right" and AIs have all failed to
          // help.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setUpgradeReinsertModal({ maxIndex: maxReinsert ?? 50 });
        }
      }
    } else {
      if (upgradeReinsertModal) setUpgradeReinsertModal(null);
    }
  }, [gameState, playerId, upgradeReinsertModal, inspectCardOverlay]);

  // Debugging for inspectCardOverlay changes
  //useEffect(() => {
  //  if (inspectCardOverlay) {
  //    console.debug(`inspect-card overlay activated: ${inspectCardOverlay.id}`);
  //  } else {
  //    console.debug("inspect-card overlay deactivated");
  //  }
  //}, [inspectCardOverlay]);

  // Register Socket.IO event listeners for game events
  // Sets up handlers for various game events (deck data, card choices, timers, etc.)
  // Returns cleanup function that unregisters all listeners when socket or gameCode changes
  useEffect(() => {
    if (!socket) return;

    const onDeckData = ({ deck }: { deck: Card[] }) => setDeckCardsOverlay(deck);
    const onRemovedData = ({ removedPile }: { removedPile: Card[] }) => setRemovedCardsOverlay(removedPile);
    const onPlayError = (data: { reason: string, cardId?: string, cardIds?: string[] }) => {
      setOpConflictModal(data); // use data directly
    };

    const onSeeTheFutureData = (data: { cards: Card[], timeout?: number }) => {
      setSeeTheFutureCards(data.cards);
      // The server SHOULD tell us the max time we can delay the game,
      const timeout = data.timeout || 2000;
      setTimeout(() => {
        setSeeTheFutureCards(null);
        if (socket && gameCode) {
          socket.emit(SocketEvent.DismissSeeTheFuture, gameCode); // Auto-dismiss triggers server dismiss
        }
      }, timeout);
    };

    const onChooseFavorCard = (data: { stealerName?: string, timeout: number }) => {
      setChoiceCountdown(Math.ceil(data.timeout / 1000));
      setFavorCardChoiceModal({ stealerName: data.stealerName });
    };

    const onFavorResult = (data: { card: Card }) => {
      setFavorResultCardOverlay(data.card);
      setTimeout(() => {
        setFavorResultCardOverlay(null);
      }, CARD_DISMISS_TIMEOUT_MS);
    };

    const onChooseStealCard = (data: { victimName: string, handCount: number, timeout: number }) => {
      setChoiceCountdown(Math.ceil(data.timeout / 1000));
      setStealCardChoiceModal({ handSize: data.handCount, victimName: data.victimName });
    };

    const onStealResult = (data: { card: Card }) => {
      setStealCardResultOverlay(data.card);
      setTimeout(() => {
        setStealCardResultOverlay(null);
      }, CARD_DISMISS_TIMEOUT_MS);
    };

    const onReactionTimerUpdate = ({ duration, phase }: { duration: number, phase: TurnPhase }) => {
      if (phase === TurnPhase.Reaction) {
        setReactionCountdown(duration);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = setInterval(() => {
          setReactionCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownIntervalRef.current!);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else if (phase === TurnPhase.Action) {
        setReactionCountdown(0);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
    };

    console.debug('Registering Socket event listeners.');
    socket.on(SocketEvent.DeckData, onDeckData);
    socket.on(SocketEvent.RemovedData, onRemovedData);
    socket.on(SocketEvent.PlayError, onPlayError);
    socket.on(SocketEvent.SeeTheFutureData, onSeeTheFutureData);
    socket.on(SocketEvent.ChooseFavorCard, onChooseFavorCard);
    socket.on(SocketEvent.FavorResult, onFavorResult);
    socket.on(SocketEvent.ChooseStealCard, onChooseStealCard);
    socket.on(SocketEvent.StealResult, onStealResult);
    socket.on(SocketEvent.ReactionTimerUpdate, onReactionTimerUpdate);

    return () => {
      socket.off(SocketEvent.DeckData, onDeckData);
      socket.off(SocketEvent.RemovedData, onRemovedData);
      socket.off(SocketEvent.PlayError, onPlayError);
      socket.off(SocketEvent.SeeTheFutureData, onSeeTheFutureData);
      socket.off(SocketEvent.ChooseFavorCard, onChooseFavorCard);
      socket.off(SocketEvent.FavorResult, onFavorResult);
      socket.off(SocketEvent.ChooseStealCard, onChooseStealCard);
      socket.off(SocketEvent.StealResult, onStealResult);
      socket.off(SocketEvent.ReactionTimerUpdate, onReactionTimerUpdate);
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [socket, gameCode]);

  // Callback to dismiss the "See The Future" overlay
  // Emits a socket event to notify the server, then clears the local state
  // useCallback memoizes this function so it doesn't change unless socket or gameCode changes
  const handleDismissSeeTheFuture = useCallback(() => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.DismissSeeTheFuture, gameCode);
      setSeeTheFutureCards(null);
    }
  }, [socket, gameCode]);

  // Global Escape key handler to dismiss overlays
  // Pressing Escape closes any open overlay (card inspection, deck view, etc.)
  // Empty dependency array means this only runs once on mount
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        //console.debug("inspect-card overlay dismissed by escape");
        setInspectCardOverlay(null);
        setDeckCardsOverlay(null);
        setRemovedCardsOverlay(null);
        setSeeTheFutureCards(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-scroll message log to bottom when new messages arrive
  // Only auto-scrolls if the user is already at or near the bottom (hasn't scrolled up)
  // This allows users to scroll up to read old messages without being interrupted
  useEffect(() => {
    if (messageAreaRef.current && !isUserScrolledUpRef.current) {
      const element = messageAreaRef.current;
      element.scrollTop = element.scrollHeight;
    }
  }, [gameMessages]);

  // Track user scroll position to determine if we should auto-scroll
  // If user scrolls up, we stop auto-scrolling until they scroll back to bottom
  useEffect(() => {
    const element = messageAreaRef.current;
    if (!element) return;

    const handleScroll = () => {
      if (!element) return;
      // Check if user is at or near the bottom (within 50px threshold)
      const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50;
      isUserScrolledUpRef.current = !isAtBottom;
    };

    element.addEventListener('scroll', handleScroll);
    // Initial check
    handleScroll();

    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Track window and table area dimensions for responsive layout
  // Updates windowHeight and tableAreaSize when window is resized or game state changes
  // Also measures table area size on initial load
  useEffect(() => {
    if (typeof window === 'undefined') return; // Early return for SSR

    const handleResize = () => {
      setWindowHeight(window.innerHeight);
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
  }, [isLoading, gameState]);

  // Track hand area dimensions using ResizeObserver
  // Updates handAreaWidth and handAreaHeight when the hand container is resized
  // Skips updates during drag operations to prevent layout flicker
  useEffect(() => {
    if (handAreaRef.current) {
      const observer = new ResizeObserver(entries => {
        if (entries[0] && !isDraggingRef.current) {
          const entry = entries[0];
          let width = entry.contentRect.width - 20;
          let height = entry.contentRect.height;
          // Check if borderBoxSize is supported and available
          if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
            const bs = entry.borderBoxSize[0];
            width = bs.inlineSize;
            height = bs.blockSize;
          }
          setHandAreaWidth(width);
          setHandAreaHeight(height);
        }
      });
      observer.observe(handAreaRef.current);
      return () => observer.disconnect();
    }
  }, [gameState]);

  // Handle mouse drag for resizing both the upper/lower half split and the log/hand split
  // Tracks mouse movement during resize drag and updates the appropriate height percentage
  // Empty dependency array means this only runs once on mount
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingHalfRef.current) {
        const container = document.querySelector('.container-fluid');
        if (container) {
          const containerHeight = container.clientHeight;
          const deltaY = e.clientY - resizeHalfStartPosRef.current.y;
          const deltaPercent = (deltaY / containerHeight) * 100;
          // Dragging down (positive deltaY) increases upper half, decreases lower half
          // Dragging up (negative deltaY) decreases upper half, increases lower half
          const newHeight = Math.max(20, Math.min(80, resizeHalfStartHeightRef.current + deltaPercent));
          setUpperHalfHeight(newHeight);
        }
      }

      if (isResizingLowerHalfRef.current) {
        // Get the lower half container to calculate relative position
        const lowerHalfContainer = document.querySelector('[data-lower-half-container]') as HTMLElement;
        if (lowerHalfContainer) {
          const lowerHalfHeight = lowerHalfContainer.clientHeight;
          const deltaY = e.clientY - resizeLowerHalfStartPosRef.current.y;
          const deltaPercent = (deltaY / lowerHalfHeight) * 100;
          // Dragging down (positive deltaY) increases log area, decreases hand area
          // Dragging up (negative deltaY) decreases log area, increases hand area
          const newHeight = Math.max(20, Math.min(80, resizeLowerHalfStartHeightRef.current + deltaPercent));
          setLowerHalfLogHeight(newHeight);
        }
      }
    };

    const handleMouseUp = () => {
      isResizingHalfRef.current = false;
      isResizingLowerHalfRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleHalfResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingHalfRef.current = true;
    resizeHalfStartPosRef.current = { y: e.clientY };
    resizeHalfStartHeightRef.current = upperHalfHeight;
  };

  const handleLowerHalfResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLowerHalfRef.current = true;
    resizeLowerHalfStartPosRef.current = { y: e.clientY };
    resizeLowerHalfStartHeightRef.current = lowerHalfLogHeight;
  };

  // Callback to confirm reinserting an UPGRADE CLUSTER card
  // Emits socket event with the chosen index position, then closes the modal
  // useCallback memoizes this function so it doesn't change unless dependencies change
  const handleUpgradeInsertConfirm = useCallback(() => {
    if (!socket || !gameCode || !gameState) return;
    const index = typeof reinsertIndex === 'string' ? parseInt(reinsertIndex, 10) : reinsertIndex;
    socket.emit(SocketEvent.ReinsertUpgradeCard, { gameCode, index, nonce: gameState.nonce });
    setUpgradeReinsertModal(null);
  }, [socket, gameCode, gameState, reinsertIndex]);

  // Callback to handle game end modal confirmation
  // Resets all game state and navigates back to the home page
  const handleGameEndConfirm = useCallback(() => {
    resetState();
    router.push('/');
  }, [resetState, router]);

  // Callback to confirm reinserting an EXPLODING CLUSTER card
  // Emits socket event with the chosen index position, then closes the modal
  // useCallback memoizes this function so it doesn't change unless dependencies change
  const handleExplodingInsertConfirm = useCallback(() => {
    if (!socket || !gameCode || !gameState) return;
    const index = typeof reinsertIndex === 'string' ? parseInt(reinsertIndex, 10) : reinsertIndex;
    socket.emit(SocketEvent.ReinsertExplodingCard, { gameCode, index, nonce: gameState.nonce });
    setExplodingReinsertModal(null);
  }, [socket, gameCode, gameState, reinsertIndex]);

  // Determines if a card can be played in the current game state
  // Checks turn phase, player turn, card type, and special rules (e.g., Developer combos)
  // Returns true if the card is playable, false otherwise
  // useCallback memoizes this function to avoid recreating it on every render
  const isCardPlayable = useCallback((card: Card) => {
    if (!gameState || !playerId) {
      if (!gameState) console.error('BUG: isCardPlayable called with null gameState');
      if (!playerId) console.error('BUG: isCardPlayable called with null playerId');
      return false;
    }
    const isMyTurn = isCurrentPlayer(gameState, playerId);
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
        return false;
      case TurnPhase.ExplodingReinserting:
        return false;
      case TurnPhase.SeeingTheFuture:
        // Block all players from playing cards while one player is seeing the future
        return false;
      case TurnPhase.ChoosingFavorCard:
        return false;
      case TurnPhase.ChoosingDeveloperCard:
        return false;
      default:
        return false;
    }
  }, [gameState, playerId, myHand, playerName]);

  // Calculates the size (width/height) of cards based on available space
  // If enlarged=true, calculates size for overlay/modal cards (70% of window height)
  // Otherwise, calculates size for table cards based on tableAreaSize
  // useCallback memoizes this function to avoid recalculating on every render
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

  // Calculates optimal card layout for modals (e.g., "See The Future", card choice modals)
  // Determines card width, height, and container width based on number of cards and viewport size
  // Tries to fit cards without scrolling, but allows scrolling if cards would be too small
  // useCallback memoizes this function to avoid recalculating on every render
  const calculateAdaptiveLayout = useCallback((count: number) => {
    // Default fallback
    const fallback = { cardWidth: 100, cardHeight: 140, containerWidth: 'auto' };
    if (typeof window === 'undefined') return fallback;

    const target = getCardSize();
    const aspectRatio = 5 / 7;
    const gap = 8; // Slight reduction in gap

    // Vertical overhead: Modal Header + Body Text + Margins + Safety Buffer
    // Aggressively increased to ensure "bottom row" doesn't get cut off.
    const heightPadding = 320;
    // Horizontal overhead
    const widthPadding = 60;

    const maxW = window.innerWidth;
    // Fit in 85% of height to be safe
    const maxH = window.innerHeight * 0.85;

    if (count === 0) return { cardWidth: target.width, cardHeight: target.height, containerWidth: 'auto' };

    // Helper to find best fit given constraints
    const findBestFit = (limitH: number) => {
      let bestW = 0;
      let bestCols = 1;

      // Prefer fewer rows (more columns), so iterate cols down
      for (let cols = count; cols >= 1; cols--) {
        const rows = Math.ceil(count / cols);

        const availableW = maxW - widthPadding - (cols - 1) * gap;
        if (availableW <= 0) continue;
        const wByWidth = availableW / cols;

        let w = wByWidth;

        // Apply height constraint if not infinite
        if (limitH !== Infinity) {
          const availableH = limitH - heightPadding - (rows - 1) * gap;
          if (availableH <= 0) continue; // Cannot fit vertically
          const wByHeight = availableH * aspectRatio / rows;
          w = Math.min(w, wByHeight);
        }

        // Cap at the target (draw pile) size
        w = Math.min(w, target.width);

        // We iterate from max cols down.
        // We want the widest card possible.
        // If we find a wider card, we take it (implies fewer cols / more rows).
        // If the width is the same (e.g. capped by target.width), we DO NOT update,
        // effectively preferring the earlier result (more cols).
        if (w > bestW) {
          bestW = w;
          bestCols = cols;
        }
      }
      return { w: Math.floor(bestW), cols: bestCols };
    };

    // 1. Try to fit in viewport
    let { w: fitW, cols: fitCols } = findBestFit(maxH);

    // 2. Check criteria to allow scrolling
    const MIN_READABLE_WIDTH = CARD_MIN_WIDTH_PX;
    const shouldScroll = fitW < MIN_READABLE_WIDTH;

    if (shouldScroll) {
      // Recalculate with infinite height allowed (scrolling)
      const scrollFit = findBestFit(Infinity);
      // If we gain significant size by scrolling, do it.
      // But if even scrolling keeps us small, we just do our best.
      if (scrollFit.w > fitW) {
        fitW = scrollFit.w;
        fitCols = scrollFit.cols;
      }
    }

    if (fitW === 0) return fallback;

    const fitH = fitW / aspectRatio;
    const containerWidth = fitCols * fitW + (fitCols - 1) * gap;

    return {
      cardWidth: fitW,
      cardHeight: fitH,
      containerWidth: Math.ceil(containerWidth) + 'px'
    };
  }, [getCardSize]);

  // Callback to handle leaving the game
  // Emits socket event to notify server, closes modal, resets state, and navigates home
  const handleLeaveGame = useCallback(() => {
    if (socket && gameCode) {
      socket.emit(SocketEvent.LeaveGame, gameCode);
    }
    setShowLeaveGameModal(false);
    resetState();
    router.push('/');
  }, [socket, gameCode, resetState, router]);

  // Handles clicking on a card in the hand
  // Supports single selection and combo selection (Shift+click for Developer cards)
  // Distinguishes clicks from drags by checking mouse movement distance
  // useCallback memoizes this function to avoid recreating it on every render
  const handleCardClick = useCallback((card: Card, event: React.MouseEvent) => {
    event.stopPropagation();

    if (isDraggingRef.current) {
      return;
    }

    if (!isCardPlayable(card)) {
      return;
    }

    // Calculate distance moved to distinguish click from drag
    const moveX = Math.abs(event.clientX - clickStartPosRef.current.x);
    const moveY = Math.abs(event.clientY - clickStartPosRef.current.y);
    if (moveX > 30 || moveY > 30) {
      return;
    }
    console.debug('handleCardClick', card.id, card.name, 'shift:', event.shiftKey, 'selected:', selectedCards.map(c => c.id));

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

  // Handles double-clicking on a card to inspect it
  // Opens the card inspection overlay showing an enlarged version
  // Empty dependency array means this function never changes
  const handleCardDoubleClick = useCallback((card: Card) => {
    setInspectCardOverlay(card);
  }, []);

  // Helper function to convert row/card indices to global hand array index
  // layout is an array like [4, 3, 3] representing cards per row
  const getGlobalIndex = (rowIndex: number, cardIndex: number, layout: number[]): number => {
    let globalIndex = 0;
    // Sum all cards in previous rows
    for (let i = 0; i < rowIndex; i++) {
      globalIndex += layout[i];
    }
    // Add the card index in the current row
    globalIndex += cardIndex;
    return globalIndex;
  };

  // Helper function to calculate layout constraints
  // Calculates the optimal layout for cards in the hand area
  // Determines card width and how many cards per row based on available space
  // Uses binary search to find the largest card size that fits without scrolling
  // Returns card width and layout array (e.g., [10, 10, 5] means 10 cards in row 1, 10 in row 2, 5 in row 3)
  // Empty dependency array means this function never changes
  const calculateHandLayout = useCallback((
    numCards: number,
    containerWidth: number,
    containerHeight: number
  ): { cardWidth: number, layout: number[] } => {
    if (numCards === 0) return { cardWidth: CARD_DEFAULT_WIDTH_PX, layout: [0] };

    // Fallback to window dimensions if container is not yet measured
    let effectiveWidth = containerWidth;
    let effectiveHeight = containerHeight;
    if (effectiveWidth === 0 && typeof window !== 'undefined') {
      effectiveWidth = window.innerWidth;
    }
    if (effectiveHeight === 0 && typeof window !== 'undefined') {
      effectiveHeight = window.innerHeight * 0.3; // Estimate
    }
    // If still 0 (SSR), fallback to defaults
    if (effectiveWidth === 0) return { cardWidth: CARD_DEFAULT_WIDTH_PX, layout: [0] };

    const availableHeight = Math.max(100, effectiveHeight);
    const rowGap = 8; // Gap between rows

    // Calculate card size based on vertical space
    // Find the largest card size that fits within constraints

    // Layout cards function - returns array of cards per row (e.g., [10, 10, 5])
    // Fills rows sequentially: first row completely, then second row, etc.
    const layoutCards = (nCards: number, cardWidth: number): number[] => {
      const cardFullWidth = cardWidth + (CARD_MARGIN_X_PX * 2);
      const maxCols = Math.floor(effectiveWidth / cardFullWidth);
      if (maxCols === 0) return [nCards]; // All in one row if no space

      const cardsPerRow: number[] = [];
      let remaining = nCards;

      // Fill rows sequentially
      while (remaining > 0) {
        const cardsInThisRow = Math.min(maxCols, remaining);
        cardsPerRow.push(cardsInThisRow);
        remaining -= cardsInThisRow;
      }
      return cardsPerRow;
    };

    // Check if there's vertical room for the layout at the given card width
    const hasRoomForLayout = (cardWidth: number, layout: number[]): boolean => {
      const targetRows = Math.max(1, layout.length - (1 - MIN_ROW_VISIBILITY));
      const cardHeight = cardWidth / CARD_ASPECT_RATIO;
      const requiredHeight = targetRows * cardHeight + (targetRows - 1) * rowGap;
      return requiredHeight <= availableHeight;
    };

    // Calculate effective minimum width based on max cards per row constraint
    // This ensures we don't exceed MAX_CARDS_PER_ROW cards per row
    // To fit MAX_CARDS_PER_ROW cards: MAX_CARDS_PER_ROW * (cardWidth + 2*CARD_MARGIN_X_PX) <= effectiveWidth
    // Solving for cardWidth: cardWidth <= (effectiveWidth - MAX_CARDS_PER_ROW * 2*CARD_MARGIN_X_PX) / MAX_CARDS_PER_ROW
    const absoluteMin = CARD_MIN_WIDTH_PX;
    const imposedMin = (effectiveWidth - (MAX_CARDS_PER_ROW * 2 * CARD_MARGIN_X_PX)) / MAX_CARDS_PER_ROW;
    const effectiveMin = Math.max(absoluteMin, imposedMin);

    // First try to fit the hand area without scrolling.
    // Binary search to find the largest width that satisfies hasRoomForLayout
    // Use effectiveMin as the lower bound to respect max cards per row
    let minWidth = effectiveMin;
    let maxWidth = CARD_MAX_WIDTH_PX;
    let bestWidth = CARD_DEFAULT_WIDTH_PX;
    let bestLayout = layoutCards(numCards, CARD_DEFAULT_WIDTH_PX);

    let found = false;
    while (maxWidth - minWidth > 1) {
      const testWidth = Math.floor((minWidth + maxWidth) / 2);
      const testLayout = layoutCards(numCards, testWidth);

      if (hasRoomForLayout(testWidth, testLayout)) {
        // It fits - try larger
        bestWidth = testWidth;
        bestLayout = testLayout;
        minWidth = testWidth;
        found = true;
      } else {
        // Doesn't fit - try smaller
        maxWidth = testWidth;
      }
      //console.debug(`[HandLayout] tried:`, {
      //  numCards,
      //  cardWidth: testWidth,
      //  cardHeight: testWidth / CARD_ASPECT_RATIO,
      //  layout: testLayout,
      //});
    }

    // Check the final candidate (maxWidth) if we haven't tested it yet
    if (maxWidth > bestWidth) {
      const finalLayout = layoutCards(numCards, maxWidth);
      if (hasRoomForLayout(maxWidth, finalLayout)) {
        bestWidth = maxWidth;
        bestLayout = finalLayout;
        found = true;
      }
    }

    // If no solution found that fits without scrolling, use effectiveMin
    if (!found) {
      bestWidth = effectiveMin;
      bestLayout = layoutCards(numCards, effectiveMin);
    }
    console.debug('[HandLayout]:', {
      numCards,
      availableWidth: effectiveWidth,
      availableHeight,
      effectiveMin,
      cardWidth: bestWidth,
      cardHeight: bestWidth / CARD_ASPECT_RATIO,
      layout: bestLayout,
    });
    return { cardWidth: bestWidth, layout: bestLayout };
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

  // Handles clicking the draw pile to draw a card
  // Validates that it's the player's turn and the game is in Action phase
  // Emits socket event to request drawing a card
  const handleDrawClick = useCallback(() => {
    if (!socket) {
      console.error("BUG: handleDrawClick called with no socket");
      return;
    }
    if (!gameState) {
      console.error("BUG: handleDrawClick called with no gameState");
      return;
    }
    if (!gameCode) {
      console.error("BUG: handleDrawClick called with no gameCode");
      return;
    }
    if (!playerId) {
      console.error("BUG: handleDrawClick called with no playerId");
      return;
    }

    if (drawCardAnimation) {
      console.debug("Cannot draw: animation is active");
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayer];
    if (!currentPlayer) {
      console.error(`BUG: Current player index ${gameState.currentPlayer} is invalid in handleDrawClick`);
      return;
    }

    if (currentPlayer.id !== playerId) {
      console.debug("Cannot draw: not your turn");
      return;
    }

    if (gameState.turnPhase !== TurnPhase.Action) {
      console.debug("Cannot draw: not in action phase");
      return;
    }

    socket.emit(SocketEvent.DrawCard, gameCode);
  }, [socket, gameState, playerId, gameCode, drawCardAnimation]);

  // Register socket listener for card draw events
  // When a card is drawn, starts the drawing animation and shows card overlay if it's an exploding cluster
  // Uses gameStateRef.current to get latest game state without causing re-renders
  useEffect(() => {
    if (!socket) return;

    const onCardDrawn = (data: { drawingPlayerId: string, card?: Card, duration: number, nextCardImageUrl?: string }) => {
      console.debug(`received event: ${SocketEvent.CardDrawn}: ${data.card ? data.card.id : 'by another player'}`);
      const currentGameState = gameStateRef.current;
      if (!currentGameState) {
        console.error('BUG: gameStateRef.current is null in onCardDrawn');
      }
      const currentPileImageUrl = currentGameState?.drawPileImage || (() => { console.error('BUG: drawPileImage is missing in onCardDrawn'); return "/art/back.png"; })();

      // Start the animation to run for duration
      setDrawCardAnimation({ card: data.card, playerId: data.drawingPlayerId, duration: data.duration, nextCardImageUrl: data.nextCardImageUrl, currentPileImageUrl });

      // Clear animation after duration
      setTimeout(() => {
        setDrawCardAnimation(null);
      }, data.duration);

      // If there is a card to overlay (e.g. EXPLODING CLUSTER), that starts
      // when the animation ends.
      if (data.card) {
        setTimeout(() => {
          setInspectCardOverlay(data.card!);

          setTimeout(() => {
            // React calls the passed function with the current value.
            setInspectCardOverlay((current) => {
              if (current && data.card && current.id === data.card.id) {
                //console.debug("inspect-card overlay dismissed by timeout");
                return null;
              }
              return current;
            });
          }, CARD_DISMISS_TIMEOUT_MS);
        }, Math.max(500, data.duration - 500)); // show early to avoid flicker
      }

    };

    socket.on(SocketEvent.CardDrawn, onCardDrawn);

    return () => {
      socket.off(SocketEvent.CardDrawn, onCardDrawn);
    };
  }, [socket]);

  const onDragEnd = (result: DropResult) => {
    setIsDragging(false);
    setDraggedCard(null);
    setTimeout(() => { // Debounce
      isDraggingRef.current = false;
    }, 100);
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
      const { layout } = calculateHandLayout(myHand.length, handAreaWidth, handAreaHeight);
      const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
      const destRowIndex = parseInt(destination.droppableId.replace('hand-row-', ''), 10);

      const sourceGlobalIndex = getGlobalIndex(sourceRowIndex, source.index, layout);
      let destGlobalIndex = getGlobalIndex(destRowIndex, destination.index, layout);

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
      if (!socket) {
        console.error('BUG: socket is null in onDragEnd');
        return;
      }
      if (!gameCode) {
        console.error('BUG: gameCode is null in onDragEnd');
        return;
      }
      socket.emit(SocketEvent.ReorderHand, { gameCode, newHand });
      return;
    }

    // Handle discard pile drop
    if (destination.droppableId === 'discard-pile') {
      const { layout } = calculateHandLayout(myHand.length, handAreaWidth, handAreaHeight);
      const sourceRowIndex = parseInt(source.droppableId.replace('hand-row-', ''), 10);
      const sourceGlobalIndex = getGlobalIndex(sourceRowIndex, source.index, layout);
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

            // The second card is also selected and both cards are played
            cardsToPlay = [selected, draggedCard];
            newSelectedCards = [selected, draggedCard];
          } else {
            // The selected card is deselected and the second card is selected and played
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
          // The combo is deselected and the new card is selected and played
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
        const getValidVictims = () => {
          if (!currentGameState) {
            console.error('BUG: currentGameState is null in getValidVictims');
            return [];
          }
          return currentGameState.players.filter(p => p.id !== playerId && !p.isOut && !p.isDisconnected && p.cards > 0);
        };
        let victimIdToUse: string | undefined;

        // Intercept FAVOR play
        if (cardsToPlay.length === 1 && cardsToPlay[0].class === CardClass.Favor) {
          const victims = getValidVictims();
          if (victims.length === 0) {
            setNoPossibleVictimModalOpen(true);
            return; // Reject
          }
          if (victims.length === 1) {
            victimIdToUse = victims[0].id;
          } else {
            opStartNonceRef.current = currentGameState.nonce;
            setFavorVictimModalOpen(true);
            setChoiceCountdown(CHOICE_DISMISS_TIMEOUT_S);
            return;
          }
        }

        // Intercept DEVELOPER combo
        if (cardsToPlay.length === 2 && cardsToPlay[0].class === CardClass.Developer && cardsToPlay[1].class === CardClass.Developer) {
          const victims = getValidVictims();
          if (victims.length === 0) {
            setNoPossibleVictimModalOpen(true);
            return; // Reject
          }
          if (victims.length === 1) {
            victimIdToUse = victims[0].id;
          } else {
            opStartNonceRef.current = currentGameState.nonce;
            setStealCardVictimModalOpen(true);
            setChoiceCountdown(CHOICE_DISMISS_TIMEOUT_S);
            return;
          }
        }

        // --- Client-side Play Validation ---
        const isAllowed = cardsToPlay.every(c => isCardPlayable(c));

        if (!isAllowed) {
          console.log(`Play blocked client-side: isCardPlayable returned false`);
          return;
        }

        // Optimistic update and clear selection for successful plays
        // Delay update to avoid "Unable to find drag handle" warning from dnd
        // library trying to restore focus to unmounted item.
        setTimeout(() => {
          // Emit the appropriate event to the server
          if (!gameCode) {
            console.error("BUG: gameCode is null when trying to play card");
            return;
          }
          if (!socket) {
            console.error("BUG: socket is null when trying to play card");
            return;
          }
          if (cardsToPlay.length === 1) {
            console.debug(`Emitting playCard: code=${gameCode}, card=${cardsToPlay[0].id}`);
            socket.emit(SocketEvent.PlayCard, { gameCode, cardId: cardsToPlay[0].id, nonce: opStartNonceRef.current, victimId: victimIdToUse });
          } else if (cardsToPlay.length === 2) {
            console.debug('Emitting playCombo for DEVELOPER cards');
            socket.emit(SocketEvent.PlayCombo, { gameCode, cardIds: cardsToPlay.map(c => c.id), nonce: opStartNonceRef.current, victimId: victimIdToUse });
          }

          setSelectedCards([]);
          setMyHand((prevHand: Card[]) => prevHand.filter(c => !cardsToPlay.some(pc => pc.id === c.id)));
        }, 50);
      }
      return; // Ensure we exit after handling the drop
    }
  };

  const onDragStart = (start: DragStart) => {
    if (drawCardAnimation) return;

    isDraggingRef.current = true;
    setIsDragging(true);
    const currentGameState = gameStateRef.current;
    if (currentGameState) opStartNonceRef.current = currentGameState.nonce;
    console.debug('onDragStart', start, "nonce", opStartNonceRef.current);

    if (start.source.droppableId.startsWith('hand-row-')) {
      const { layout } = calculateHandLayout(myHand.length, handAreaWidth, handAreaHeight);
      const sourceRowIndex = parseInt(start.source.droppableId.replace('hand-row-', ''), 10);
      const sourceGlobalIndex = getGlobalIndex(sourceRowIndex, start.source.index, layout);
      const draggedCard = myHand[sourceGlobalIndex];

      if (!draggedCard) return;

      setDraggedCard(draggedCard);

      // If Shift is held, try to add to selection (Combo)
      if (isShiftKeyPressed.current) {
        // If there is a single DEVELOPER card selected and the player
        // shift-clicks and drags another identical card...
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

  // Memoized rendering of the player's hand
  // Calculates card layout, splits hand into rows, and renders draggable cards
  // Only recalculates when hand, dimensions, selection, or other dependencies change
  // This prevents expensive re-renders when unrelated state changes
  const renderedHand = useMemo(() => {
    const { cardWidth, layout } = calculateHandLayout(myHand.length, handAreaWidth, handAreaHeight);

    // Split hand into rows
    const rows: Card[][] = [];
    if (!layout) {
      console.error('BUG: calculateHandLayout returned null/undefined layout');
      return <div>BUG: Layout calculation failed</div>;
    }
    const nRows = layout.length;
    let longest = 0;
    for (let row = 0, i = 0; row < nRows; row++) {
      const cards = layout[row];
      if (cards > 0) {
        if (cards > longest) longest = cards;
        rows.push(myHand.slice(i, i + cards));
      } else {
        rows.push(myHand);
      }
      i += cards;
    }
    if (rows.length === 0) {
      rows.push([]);
    }

    return (
      <div
        data-areaname="hand"
        style={{
          maxWidth: `${longest * cardWidth}px`,
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
                  minHeight: `${(cardWidth / CARD_ASPECT_RATIO) + 10}px`, // Ensure height for drop target + margin
                  width: '100%',
                }}
              >
                {rowCards.map((card, index) => (
                  <Draggable key={card.id} draggableId={card.id} index={index}>
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
                            height: `${(cardWidth / CARD_ASPECT_RATIO) - 10}px`, // -10 to offset +10 above?
                            boxSizing: 'content-box',
                            cursor: 'grab',
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
                                    height={cardWidth / CARD_ASPECT_RATIO}
                                    draggable={false}
                                    style={{
                                      width: '100%', height: 'auto',
                                      objectFit: 'contain'
                                    }}
                                  />
                                </div>
                              ))}
                            </>
                          )}
                          <Image
                            src={card.imageUrl}
                            alt={`${card.class}: ${card.name} (${playable ? 'playable' : 'not playable'})`}
                            width={cardWidth}
                            height={cardWidth / CARD_ASPECT_RATIO}
                            draggable={false}
                            style={{
                              width: '100%', height: 'auto',
                              zIndex: 1,
                              position: 'relative',
                              backgroundColor: 'white',
                              borderRadius: '5px',
                              objectFit: 'contain'
                            }}
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
  }, [myHand, handAreaWidth, handAreaHeight, selectedCards, isDragging, isCardPlayable, handleCardClick, handleCardDoubleClick, calculateHandLayout]);

  // During initial load or reconnection, some values may be null/undefined
  // Only assert after we've confirmed the game is loaded
  if (!gameState || !socket || !playerId || !playerName) {
    return <div>Loading game...</div>;
  }

  // Assert that required values are defined - if we get here, these should never be null/undefined
  // If they are, it's a serious bug that needs to be logged and fixed
  const safeGameState = assertDefined(gameState, 'gameState', 'GameScreen render');
  const safeSocket = assertDefined(socket, 'socket', 'GameScreen render');
  const safePlayerId = assertDefined(playerId, 'playerId', 'GameScreen render');
  const safePlayerName = assertDefined(playerName, 'playerName', 'GameScreen render');

  const me = safeGameState.players.find(p => p.id === safePlayerId);
  if (!me) {
    console.error(`BUG: Player ${safePlayerId} not found in game state`);
  }
  const currentPlayer = safeGameState.players[safeGameState.currentPlayer];
  if (!currentPlayer) {
    console.error(`BUG: Current player index ${safeGameState.currentPlayer} is invalid`);
  }

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
    if (currentPlayer && player.id === currentPlayer.id) className += 'bg-success-subtle';
    if (player.isOut) className += ' text-decoration-line-through text-muted';
    if (player.isDisconnected) className += ' text-muted opacity-50';
    return className.trim();
  };

  const playersToDisplay = safeGameState.players;

  let turnStatus = '';
  let turnStatusBgColor = '';
  let turnStatusColor = 'black';

  if (!me || !currentPlayer) {
    turnStatus = 'BUG: Invalid game state';
    turnStatusBgColor = 'red';
    turnStatusColor = 'white';
  } else {
    if (me.isOut) {
      turnStatus = "You are OUT";
      turnStatusBgColor = 'lightcoral';
    } else {
      // Find the next VALID player (skip eliminated/disconnected)
      let nextPlayerIndex = (safeGameState.currentPlayer + 1) % safeGameState.players.length;
      let nextPlayer = safeGameState.players[nextPlayerIndex];

      let attempts = 0;
      while (attempts < safeGameState.players.length) {
        if (!nextPlayer.isOut && !nextPlayer.isDisconnected) {
          break;
        }
        nextPlayerIndex = (nextPlayerIndex + 1) % safeGameState.players.length;
        nextPlayer = safeGameState.players[nextPlayerIndex];
        attempts++;
      }

      if (me.id === currentPlayer.id) {
        if (safeGameState.turnPhase === TurnPhase.Exploding || safeGameState.turnPhase === TurnPhase.ExplodingReinserting) {
          turnStatus = `Your cluster is exploding - debug it!`;
          turnStatusBgColor = 'red';
          turnStatusColor = 'white';
        } else if (safeGameState.attackTurns > 0) {
          const turnsText = safeGameState.attackTurns === 1 ? 'turn' : 'turns';
          const moreText = safeGameState.attackTurnsTaken > 0 ? ' more' : '';
          turnStatus = `You have been attacked! You must take ${safeGameState.attackTurns}${moreText} ${turnsText}`;
          turnStatusBgColor = 'red';
          turnStatusColor = 'white';
        } else {
          turnStatus = `It's your turn, ${nextPlayer.name} is next`;
          turnStatusBgColor = 'lightgreen';
          turnStatusColor = 'black'; // Default
        }
      } else if (me.id === nextPlayer.id) {
        turnStatus = `It's ${currentPlayer.name}'s turn, your turn is next`;
        turnStatusBgColor = '#FFD580'; // light orange
      } else {
        turnStatus = `It's ${currentPlayer.name}'s turn`;
        turnStatusBgColor = 'lightblue';
      }
    }
  }

  const renderDiscardPile = () => {
    let isPlayable = false;
    if (draggedCard) {
      // Single DEVELOPER cards are playable in that they can be selected, but
      // they cannot be played on the discard pile alone.
      if (draggedCard.class !== CardClass.Developer || selectedCards.length > 1) {
        isPlayable = isCardPlayable(draggedCard);
      }
    }
    return (
      <Droppable droppableId="discard-pile" isDropDisabled={!isPlayable}>
        {(provided, snapshot) => {
          let border = '2px dashed #FFA500'; // Default orange
          if (safeGameState.topDiscardCard) {
            border = 'none';
          } else if (snapshot.isDraggingOver) {
            border = '2px dashed #00FF00';
          }
          let cursor = 'auto';
          if (draggedCard) {
            if (isPlayable) {
              cursor = 'grabbing';
            } else if (isHoveringDiscard || snapshot.isDraggingOver) {
              cursor = 'not-allowed';
            }
          }

          return (
            <div
              data-areaname="discard-pile"
              ref={provided.innerRef}
              {...provided.droppableProps}
              onMouseEnter={() => {
                if (isDragging || draggedCard) {
                  setIsHoveringDiscard(true);
                }
              }}
              onMouseLeave={() => {
                if (isDragging || draggedCard) {
                  setIsHoveringDiscard(false);
                }
              }}
              style={{
                width: getCardSize().width,
                height: getCardSize().height,
                border: border,
                cursor: cursor,
                borderRadius: '31px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <h5 style={{ color: '#FFA500', position: 'absolute' }}>Discard Pile</h5>
              {safeGameState.topDiscardCard && (
                <Image
                  src={safeGameState.topDiscardCard.imageUrl}
                  alt={`${safeGameState.topDiscardCard.class}: ${safeGameState.topDiscardCard.name}`}
                  fill
                  sizes="(max-width: 768px) 100px, 150px"
                  style={{ objectFit: 'contain', borderRadius: '10px' }}
                  data-cardclass={safeGameState.topDiscardCard.class}
                />
              )}
              {provided.placeholder}
            </div>
          );
        }}
      </Droppable>
    );
  };

  const isSpectator = !safeGameState.players.some(p => p.id === safePlayerId);

  // Determine which card to show in overlay
  let activeOverlayCard = inspectCardOverlay;
  const turnPhase = safeGameState.turnPhase;
  if (turnPhase === TurnPhase.Exploding || turnPhase === TurnPhase.ExplodingReinserting || turnPhase === TurnPhase.Upgrading) {
    if (safeGameState.playBlockingCard) {
      // Only show persistent overlay for players who are NOT the current player
      // AND suppress it if animation is in progress (so they see the animation instead)
      if (!isCurrentPlayer(safeGameState, safePlayerId) && !drawCardAnimation) {
        activeOverlayCard = safeGameState.playBlockingCard;
      }
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd} onDragStart={onDragStart} onDragUpdate={onDragUpdate}>
      <Container fluid className="p-3 d-flex flex-column" style={{ height: '100vh', overflow: 'hidden' }}>
        {activeOverlayCard && (
          <div
            data-overlayname="inspect-card"
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              zIndex: 1000,
            }}
            onClick={() => {
              if (drawCardAnimation) return; // can't cancel the animation
              //console.debug("inspect-card overlay dismissed by click");
              setInspectCardOverlay(null);
            }}
          >
            <div style={{ position: 'relative', width: getEnlargedCardSize().width, height: getEnlargedCardSize().height }}>
              <Image src={activeOverlayCard.imageUrl}
                alt={`${activeOverlayCard.class}: ${activeOverlayCard.name}`}
                fill
                sizes="(max-width: 768px) 90vw, 70vw" /* Large overlay image */
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>
        )}

        {deckCardsOverlay && (
          <div
            data-overlayname="show-deck"
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              zIndex: 1000, overflowY: 'auto', padding: '20px'
            }}
            onClick={() => setDeckCardsOverlay(null)}
          >
            <h2 style={{color: 'white'}}>Draw Pile ({deckCardsOverlay.length} cards)</h2>
            <div className="d-flex flex-wrap justify-content-center">
              {deckCardsOverlay.map((card, index) => (
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

        {removedCardsOverlay && (
          <div
            data-overlayname="show-removed"
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              zIndex: 1000, overflowY: 'auto', padding: '20px'
            }}
            onClick={() => setRemovedCardsOverlay(null)}
          >
            <h2 style={{color: 'white'}}>Removed Pile ({removedCardsOverlay.length} cards)</h2>
            <div className="d-flex flex-wrap justify-content-center">
              {removedCardsOverlay.map((card, index) => (
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

        {/* Upper half */}
        <div style={{
          height: `${upperHalfHeight}%`,
          minHeight: '200px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <Row className="flex-grow-1" style={{ margin: 0, height: '100%' }}>
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

              {safeGameState.devMode && !isSpectator && (
                <div className="mt-3 d-grid gap-2">
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={handleGiveDebugCard}
                    disabled={(() => {
                      const count = safeGameState.debugCardsCount;
                      if (count === undefined || count === null) {
                        console.error('BUG: debugCardsCount is missing');
                      }
                      return (count ?? 0) === 0;
                    })()}
                  >
                    Give me a DEBUG card
                  </Button>
                  <Button variant="warning" size="sm" onClick={handleDevDrawCard} disabled={(() => {
                      const count = safeGameState.safeCardsCount;
                      if (count === undefined || count === null) {
                        console.error('BUG: safeCardsCount is missing');
                      }
                      return (count ?? 0) === 0;
                    })()}>Give me a safe card</Button>
                  <Button variant="warning" size="sm" onClick={handlePutCardBack} disabled={myHand.length === 0}>Put a card back</Button>
                  <Button variant="info" size="sm" onClick={handleShowDeck}>Show the deck</Button>
                  <Button variant="info" size="sm" onClick={handleShowRemovedPile}>Show removed cards</Button>
                </div>
              )}
              {/* Timer Area */}
              <div className="timer-area mt-3 text-center"
                data-areaname="timer"
                data-turnphase={safeGameState.turnPhase}
              >
                {(safeGameState.turnPhase === TurnPhase.Reaction) && reactionCountdown >= 0 && (
                  <>
                    {(safeGameState.lastActorName && me && me.name === safeGameState.lastActorName) ? (
                      <h4 className="text-success">Waiting for other players to react</h4>
                    ) : (
                      <h4 className="text-warning">Want to react? Act fast!</h4>
                    )}
                    <h2 className="display-3">{reactionCountdown}</h2>
                  </>
                )}
                {(safeGameState.turnPhase === TurnPhase.Exploding) && (
                  <>
                    {isCurrentPlayer(safeGameState, safePlayerId) ? (
                      <h4 className="text-danger">PLAY A DEBUG CARD!</h4>
                    ) : (
                      <h4 className="text-warning">Waiting for {safeGameState.players[safeGameState.currentPlayer]?.name || 'BUG: unknown player'} to debug their cluster...</h4>
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
                    className={`draw-pile position-relative ${!draggedCard && isCurrentPlayer(safeGameState, safePlayerId) && safeGameState.turnPhase === TurnPhase.Action ? 'draw-pile-clickable' : ''}`}
                    data-areaname="draw-pile"
                    data-drawcount={safeGameState.drawCount ?? 0}
                    style={{
                      width: getCardSize().width,
                      height: getCardSize().height,
                      cursor: draggedCard ? 'not-allowed' : (
                        (isCurrentPlayer(safeGameState, safePlayerId) && safeGameState.turnPhase === TurnPhase.Action) ? 'pointer' : 'not-allowed'
                      ),
                      borderRadius: '5px'
                    }}
                    onClick={handleDrawClick}
                  >
                    <Image
                      src={drawCardAnimation?.nextCardImageUrl || safeGameState.drawPileImage || (() => { console.error('BUG: drawPileImage is missing'); return "/art/back.png"; })()}
                      alt={`Draw Pile: ${safeGameState.topDrawPileCard ? safeGameState.topDrawPileCard.class : 'Face-down card'}`}
                      data-cardclass={safeGameState.topDrawPileCard ? safeGameState.topDrawPileCard.class : 'UNKNOWN'}
                      width={getCardSize().width}
                      height={getCardSize().height} />

                    {drawCardAnimation && (
                      <div className="static-card-vanish" style={{ animationDuration: `${drawCardAnimation.duration}ms` }}>
                        <Image
                          src={drawCardAnimation.currentPileImageUrl || (() => { console.error('BUG: currentPileImageUrl is missing in drawCardAnimation'); return "/art/back.png"; })()}
                          alt={`Draw Pile: next card'}`}
                          width={getCardSize().width}
                          height={getCardSize().height} />
                      </div>
                    )}

                    {drawCardAnimation && (
                      <div className="hand-animation" style={{
                        animation: `${drawCardAnimation.card ? 'drawCardSelf' : 'drawCard'} ${drawCardAnimation.duration ? drawCardAnimation.duration/1000 : 4}s ease-in-out forwards`,
                        transform: `translateX(-50%) ${drawCardAnimation.card ? 'rotate(180deg)' : ''}`
                      }}>
                        <div className="hand-open" style={{ animation: `handReachIn ${drawCardAnimation.duration ? drawCardAnimation.duration*0.75/1000 : 2}s step-end forwards` }}>
                          <Image src="/art/hand_open.png" alt="Hand Open" width={250} height={500} />
                        </div>
                        <div className="hand-closed" style={{ animation: `handPullBack ${drawCardAnimation.duration ? drawCardAnimation.duration*0.75/1000 : 2}s step-start forwards` }}>
                          <Image src="/art/hand_closed.png" alt="Hand Closed" width={250} height={500} />
                        </div>
                        <div className="hand-card" style={{
                          animation: `handPullBack ${drawCardAnimation.duration ? drawCardAnimation.duration*0.75/1000 : 2}s step-start forwards`
                        }}>
                          <Image
                            src={drawCardAnimation.currentPileImageUrl || (() => { console.error('BUG: currentPileImageUrl is missing in drawCardAnimation'); return "/art/back.png"; })()}
                            alt={`${safeGameState.topDrawPileCard ? safeGameState.topDrawPileCard.class : 'Face-down card'}`}
                            width={getCardSize().width}
                            height={getCardSize().height}
                            style={{
                              position: 'absolute',
                              left: `${(100 - getCardSize().width) / 2}px`,
                              top: `${(180 - getCardSize().height) / 2}px`,
                              transform: drawCardAnimation.card ? 'rotate(180deg)' : 'none'
                            }} /* Centered within hand div */
                          />
                        </div>
                      </div>
                    )}
                    {safeGameState.devMode && <div className="text-white position-absolute start-50 translate-middle-x draw-pile-count" style={{ top: '100%' }}>({safeGameState.drawPileCount !== undefined ? safeGameState.drawPileCount : '??'} cards)</div>}
                  </div>
                </div>

                {/* Discard Pile */}
                <div className="d-flex flex-column align-items-center">
                  <div style={{ width: getCardSize().width, height: getCardSize().height, position: 'relative' }}>
                    {renderDiscardPile()}
                    {safeGameState.devMode && <div className="text-white position-absolute start-50 translate-middle-x discard-pile-count" style={{ top: '100%' }}>({safeGameState.discardPileCount !== undefined ? safeGameState.discardPileCount : '??'} cards)</div>}
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </div>

        {/* Resize bar */}
        <div
          onMouseDown={handleHalfResizeStart}
          style={{
            width: '100%',
            height: '6px',
            cursor: 'row-resize',
            backgroundColor: 'transparent',
            zIndex: 100,
            userSelect: 'none',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            paddingTop: '0.5rem'
          }}
        >
          <div
            style={{
              width: '100%',
              height: '3px',
              backgroundColor: 'rgba(150, 150, 150, 0.6)',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(100, 100, 100, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(150, 150, 150, 0.6)';
            }}
          />
        </div>

        {/* Lower half */}
        <div
          data-lower-half-container
          style={{
            height: `${100 - upperHalfHeight}%`,
            minHeight: '200px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Log area (upper part of lower half) */}
          <Row style={{
            flex: `0 0 ${lowerHalfLogHeight}%`,
            margin: 0,
            minHeight: 0,
            maxHeight: `${lowerHalfLogHeight}%`,
            overflow: 'hidden'
          }}>
            <Col className="d-flex flex-column" style={{ minHeight: 0, height: '100%', padding: '0' }}>
              <div
                data-areaname="message"
                style={{
                  backgroundColor: '#f0f0f0',
                  borderRadius: '10px',
                  margin: '0.5rem 0',
                  padding: '0.5rem',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  overflow: 'hidden', // Prevent parent from scrolling
                  position: 'relative'
                }}
              >
                <div
                  data-areaname="turn"
                  style={{
                    textAlign: 'center',
                    padding: '0.25rem',
                    backgroundColor: turnStatusBgColor,
                    color: turnStatusColor,
                    borderRadius: '5px',
                    flexShrink: 0,
                  }}
                >
                  <strong>{turnStatus}</strong>
                </div>

                <div
                  ref={messageAreaRef}
                  data-areaname="log"
                  className="scrollable-area"
                  style={{
                    textAlign: 'left',
                    padding: '0.25rem',
                    paddingRight: '0.5rem', // Extra padding to move scrollbar further from edge
                    overflowY: 'auto',
                    flexGrow: 1,
                    flexShrink: 1,
                    minHeight: 0, // Critical for flex scrolling
                    borderTop: '1px solid #ccc', marginTop: '0.25rem'
                  }}
                >
                  {gameMessages.map((msg, i) => (
                    <div key={i}>{msg}</div>
                  ))}
                </div>
                {!isSpectator && (
                  <Button
                    variant="secondary"
                    className="position-absolute"
                    style={{
                      bottom: '1rem',
                      right: 'calc(1rem + 12px)', // Offset for scrollbar width
                      zIndex: 100
                    }}
                    onClick={() => setShowLeaveGameModal(true)}
                  >
                    Leave Game
                  </Button>
                )}
              </div>
            </Col>
          </Row>

          {/* Resize bar between log and hand */}
          {!isSpectator && (
            <div
              onMouseDown={handleLowerHalfResizeStart}
              style={{
                width: '100%',
                height: '4px',
                cursor: 'row-resize',
                backgroundColor: 'transparent',
                zIndex: 100,
                userSelect: 'none',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '3px',
                  backgroundColor: 'rgba(150, 150, 150, 0.6)',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(100, 100, 100, 0.9)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(150, 150, 150, 0.6)';
                }}
              />
            </div>
          )}

          {/* Hand area (lower part of lower half) */}
          {!isSpectator && (
            <Row style={{
              margin: 0,
              flex: `0 0 ${100 - lowerHalfLogHeight}%`,
              minHeight: 0,
              maxHeight: `${100 - lowerHalfLogHeight}%`,
              overflow: 'hidden',
              height: `${100 - lowerHalfLogHeight}%`
            }}>
              <Col className="d-flex flex-column" style={{ minHeight: 0, height: '100%', padding: '0' }}>
                <div className="bg-light d-flex flex-column position-relative"
                  style={{
                    borderRadius: '10px',
                    margin: '0.5rem 0',
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    padding: '0.5rem'
                  }}
                  onClick={() => {
                    if (isDraggingRef.current) return;
                    setSelectedCards([]);
                  }}
                >
                  <h5 className="text-start mb-2 flex-shrink-0">Your Hand</h5>
                  <div
                    ref={handAreaRef}
                    className="flex-grow-1 scrollable-area"
                    style={{
                      overflowY: 'auto',
                      width: '100%',
                      minHeight: 0,
                      paddingRight: '0.5rem' // Extra padding to move scrollbar further from edge (matches log area)
                    }}
                  >
                    {renderedHand}
                  </div>
                </div>
              </Col>
            </Row>
          )}
          {isSpectator && (
            <Row className="bg-light p-3 position-relative" style={{ borderTop: '1px solid #ccc', flexShrink: 0 }}>
              <div className="d-flex justify-content-end w-100">
                <Button
                  variant="secondary"
                  className="w-auto"
                  style={{ zIndex: 10 }}
                  onClick={() => setShowLeaveGameModal(true)}
                >
                  Leave Game
                </Button>
              </div>
            </Row>
          )}
        </div>

        {/* Modals... */}
        <Modal
          data-modalname="host-promotion"
          show={!!hostPromotionModal}
          onHide={() => setHostPromotionModal(null)}
        >
          <Modal.Header closeButton>
            <Modal.Title>You are now the game owner</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>{hostPromotionModal}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={() => setHostPromotionModal(null)}>OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="leave-game"
          show={!!showLeaveGameModal}
          onHide={() => setShowLeaveGameModal(false)}
          backdrop="static"
        >
          <Modal.Header closeButton>
            <Modal.Title>Leave Game?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Are you sure you want to leave the game?</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowLeaveGameModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleLeaveGame} autoFocus>Leave Game</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="operation-conflict"
          show={!!opConflictModal}
          onHide={() => setOpConflictModal(null)}
        >
          <Modal.Header closeButton>
            <Modal.Title>Game State Updated</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>{opConflictModal ? opConflictModal.reason : 'BUG: opConflictModal is null'}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={() => setOpConflictModal(null)}>OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="upgrade-reinsert"
          show={!!upgradeReinsertModal && !inspectCardOverlay}
          onHide={() => {}}
          backdrop="static"
          keyboard={false}
        >
          <Modal.Header>
            <Modal.Title>Put the UPGRADE CLUSTER card back into the deck</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>You can put this card back into the deck anywhere you like.</p>
            <p>There are {upgradeReinsertModal?.maxIndex ?? '<BUG>'} cards in the deck, where do you want to put the UPGRADE CLUSTER card?</p>
            <p>Position 0 is the top of the deck, {upgradeReinsertModal?.maxIndex ?? '<BUG>'} is the bottom.</p>
            <Form.Control
              id="upgrade-reinsert-index"
              type="number"
              min={0}
              max={upgradeReinsertModal?.maxIndex ?? 50}
              value={reinsertIndex}
              onChange={(e) => setReinsertIndex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = parseInt(String(reinsertIndex), 10);
                  const max = upgradeReinsertModal?.maxIndex ?? 50;
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
                const val = parseInt(String(reinsertIndex), 10);
                const max = upgradeReinsertModal?.maxIndex ?? 50;
                return isNaN(val) || val < 0 || val > max;
              })()}
            >OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="exploding-reinsert"
          show={!!explodingReinsertModal && !inspectCardOverlay}
          onHide={() => {}}
          backdrop="static"
          keyboard={false}
        >
          <Modal.Header>
            <Modal.Title>You&apos;re safe, for now</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>You can put this card back into the deck anywhere you like.</p>
            <p>There are { explodingReinsertModal?.maxIndex ?? '<BUG>'} cards in the deck, where do you want to hide the EXPLODING CLUSTER card?</p>
            <p>Position 0 is the top of the deck, {explodingReinsertModal?.maxIndex ?? '<BUG>'} is the bottom.</p>
            <Form.Control
              id="exploding-reinsert-index"
              type="number"
              min={0}
              max={explodingReinsertModal?.maxIndex ?? 50}
              value={reinsertIndex}
              onChange={(e) => setReinsertIndex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = parseInt(String(reinsertIndex), 10);
                  const max = explodingReinsertModal?.maxIndex ?? 50;
                  if (!isNaN(val) && val >= 0 && val <= max) {
                    handleExplodingInsertConfirm();
                  }
                }
              }}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="primary"
              onClick={handleExplodingInsertConfirm}
              disabled={(() => {
                const val = parseInt(String(reinsertIndex), 10);
                const max = explodingReinsertModal?.maxIndex ?? 50;
                return isNaN(val) || val < 0 || val > max;
              })()}
            >OK</Button>
          </Modal.Footer>
        </Modal>

        {seeTheFutureCards && (
          <div
            data-overlayname="see-the-future"
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000, overflowY: 'auto', padding: '20px'
            }}
            onClick={handleDismissSeeTheFuture}
          >
            <h2 style={{ color: 'white', marginBottom: '20px' }}>See The Future</h2>
            <div className="d-flex flex-wrap justify-content-center" style={{ gap: '20px' }}>
              {seeTheFutureCards.map((card, index) => (
                <div
                  key={index}
                  style={{
                    position: 'relative',
                    width: getEnlargedCardSize().width * 0.5,
                    height: getEnlargedCardSize().height * 0.5,
                    minWidth: getCardSize().width,
                    maxWidth: '40vw'
                  }}
                >
                  <Image
                    src={card.imageUrl}
                    alt={`${card.class}: ${card.name}`}
                    fill
                    sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw" /* See The Future cards in a flex wrap */
                    style={{ objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <Modal
          data-modalname="favor-choose-victim"
          show={!!favorVictimModalOpen}
          onHide={() => setFavorVictimModalOpen(false)}
          backdrop="static"
          keyboard={false}
          centered
        >
          <Modal.Header>
            <Modal.Title>Ask for a Favor ({choiceCountdown}s)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Choose a player to ask for a favor:</p>
            <div className="list-group">
              {safeGameState.players.filter(p => p.id !== safePlayerId && !p.isOut && p.cards > 0).map(p => (
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
                socket?.emit(SocketEvent.PlayCard, { gameCode, cardId: favorCard.id, nonce: opStartNonceRef.current, victimId: favorVictimSelection });
                setFavorVictimModalOpen(false);
                setFavorVictimSelection(null);
                setSelectedCards([]);
              }
            }}>Ask Favor</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="favor-choose-card"
          show={!!favorCardChoiceModal}
          onHide={() => {}}
          backdrop="static"
          keyboard={false}
          centered
          dialogClassName="modal-fit-content"
        >
          <Modal.Header>
            <Modal.Title>Grant a Favor ({choiceCountdown}s)</Modal.Title>
          </Modal.Header>
          <Modal.Body className="bg-light">
            <p>{`Choose a card to give to ${favorCardChoiceModal?.stealerName ?? "<BUG>"}`}:</p>
            <div className="d-flex justify-content-center w-100">
              {(() => {
                const { cardWidth, cardHeight, containerWidth } = calculateAdaptiveLayout(myHand.length);
                return (
                  <div className="d-flex flex-wrap justify-content-center" style={{ gap: '8px', width: containerWidth, maxWidth: '100%' }}>
                    {myHand.map((card, index) => (
                      <div
                        key={index}
                        onClick={() => {
                          if (gameCode) {
                            socket?.emit(SocketEvent.GiveFavorCard, { gameCode, cardId: card.id });
                            setFavorCardChoiceModal(null);
                          }
                        }}
                        style={{
                          borderRadius: '5px',
                          cursor: 'pointer'
                        }}
                      >
                        <Image src={card.imageUrl} alt={card.name} width={cardWidth} height={cardHeight} />
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </Modal.Body>
        </Modal>

        {favorResultCardOverlay && (
          <div
            data-overlayname="favor-result"
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.8)',
              zIndex: 1000,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
            }}
          >
            <h2>You received:</h2>
            <Image src={favorResultCardOverlay.imageUrl} alt={favorResultCardOverlay.name} width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
          </div>
        )}

        <Modal
          data-modalname="steal-choose-victim"
          show={!!stealCardVictimModalOpen}
          onHide={() => setStealCardVictimModalOpen(false)}
          backdrop="static"
          keyboard={false}
          centered
        >
          <Modal.Header>
            <Modal.Title>Steal a Card ({choiceCountdown}s)</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Choose a player to steal from:</p>
            <div className="list-group">
              {safeGameState.players.filter(p => p.id !== safePlayerId && !p.isOut && p.cards > 0).map(p => (
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
            <Button variant="secondary" onClick={() => setStealCardVictimModalOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!favorVictimSelection} onClick={() => {
              if (selectedCards.length === 2 && gameCode && favorVictimSelection) {
                socket?.emit(SocketEvent.PlayCombo, { gameCode, cardIds: selectedCards.map(c => c.id), nonce: opStartNonceRef.current, victimId: favorVictimSelection });
                setStealCardVictimModalOpen(false);
                setFavorVictimSelection(null);
                setSelectedCards([]);
              }
            }}>Steal Card</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="steal-choose-card"
          show={!!stealCardChoiceModal}
          onHide={() => {}}
          backdrop="static"
          keyboard={false}
          centered
          dialogClassName="modal-fit-content"
        >
          <Modal.Header>
            <Modal.Title>Choose a Card to Steal ({choiceCountdown}s)</Modal.Title>
          </Modal.Header>
          <Modal.Body className="bg-light">
            <p>{`Pick a card from ${stealCardChoiceModal?.victimName ?? "<BUG>"}'s hand`}:</p>
            <div className="d-flex justify-content-center w-100">
              {(() => {
                const count = stealCardChoiceModal?.handSize || 0;
                const { cardWidth, cardHeight, containerWidth } = calculateAdaptiveLayout(count);
                return (
                  <div className="d-flex flex-wrap justify-content-center" style={{ gap: '8px', width: containerWidth, maxWidth: '100%' }}>
                    {Array.from({ length: count }).map((_, index) => (
                      <div
                        key={index}
                        onClick={() => {
                          if (gameCode) {
                            socket?.emit(SocketEvent.StealCard, { gameCode, index });
                            setStealCardChoiceModal(null);
                          }
                        }}
                        style={{
                          borderRadius: '5px',
                          cursor: 'pointer'
                        }}
                      >
                        <Image src="/art/back.png" alt="Card Back" width={cardWidth} height={cardHeight} />
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </Modal.Body>
        </Modal>

        {stealCardResultOverlay && (
          <div
            data-overlayname="combo-result"
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.8)',
              zIndex: 1000,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
            }}
          >
            <h2>
              {
                isCurrentPlayer(safeGameState, safePlayerId)
                  ? "You stole:"
                  : `${safeGameState.lastActorName || "BUG: unknown actor"} stole your:`
              }
            </h2>
            <Image src={stealCardResultOverlay.imageUrl} alt={stealCardResultOverlay.name} width={getEnlargedCardSize().width} height={getEnlargedCardSize().height} />
          </div>
        )}

        <Modal
          data-modalname="victim-has-no-cards"
          show={!!noPossibleVictimModalOpen}
          onHide={() => setNoPossibleVictimModalOpen(false)}
          centered
        >
          <Modal.Header>
            <Modal.Title>Can&apos;t steal a card</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>No other player has cards left!</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={() => setNoPossibleVictimModalOpen(false)} autoFocus>OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal
          data-modalname="game-end"
          show={!!gameEndData}
          onHide={handleGameEndConfirm}
          backdrop="static"
          keyboard={false}
          centered
        >
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
                      : `<BUG: ${gameEndData?.winType}>`))
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
