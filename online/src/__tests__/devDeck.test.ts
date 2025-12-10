import { GameManager } from '../gameManager';
import { Card, CardClass } from '../api';
import { Server } from 'socket.io';

// Mock Server
const mockServer = {
  on: jest.fn(),
  emit: jest.fn(),
} as unknown as Server;

describe('DEVMODE Deck Setup', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(mockServer);
  });

  test('setupDevModeDeck forces extended sequence (multiple Developers)', () => {
    // Create a dummy deck with multiple instances, including 3 Developers
    const deck: Card[] = [
      { id: 'NAK_1', name: 'nak1', class: CardClass.Nak, imageUrl: '' },
      { id: 'SHUFFLE_1', name: 'shuffle1', class: CardClass.Shuffle, imageUrl: '' },
      { id: 'FAVOR_1', name: 'favor1', class: CardClass.Favor, imageUrl: '' },
      { id: 'SEE_1', name: 'see1', class: CardClass.SeeTheFuture, imageUrl: '' },
      { id: 'ATTACK_1', name: 'attack1', class: CardClass.Attack, imageUrl: '' },
      { id: 'SKIP_1', name: 'skip1', class: CardClass.Skip, imageUrl: '' },
      { id: 'EXP_1', name: 'exp1', class: CardClass.ExplodingCluster, imageUrl: '' },
      { id: 'DEV_1', name: 'dev1', class: CardClass.Developer, imageUrl: '' },
      { id: 'DEV_2', name: 'dev2', class: CardClass.Developer, imageUrl: '' },
      { id: 'DEV_3', name: 'dev3', class: CardClass.Developer, imageUrl: '' },
      { id: 'DEV_4', name: 'dev4', class: CardClass.Developer, imageUrl: '' },
      { id: 'DEV_5', name: 'dev5', class: CardClass.Developer, imageUrl: '' },
      { id: 'EXP_2', name: 'exp2', class: CardClass.ExplodingCluster, imageUrl: '' },
      { id: 'UPGRADE_1', name: 'upgrade1', class: CardClass.UpgradeCluster, imageUrl: '' },
      { id: 'DEV_6', name: 'dev6', class: CardClass.Developer, imageUrl: '' },
      { id: 'DEV_7', name: 'dev7', class: CardClass.Developer, imageUrl: '' },
      { id: 'UPGRADE_2', name: 'upgrade2', class: CardClass.UpgradeCluster, imageUrl: '' },
      { id: 'filler_1', name: 'f1', class: CardClass.Debug, imageUrl: '' },
      { id: 'filler_2', name: 'f2', class: CardClass.Debug, imageUrl: '' },
    ];

    gameManager.setupDevModeDeck(deck);

    const len = deck.length;
    let expectedIndex = len - 1;

    // Expected popping order:
    expect(deck[expectedIndex--].class).toBe(CardClass.Nak);                // 1
    expect(deck[expectedIndex--].class).toBe(CardClass.Shuffle);            // 2
    expect(deck[expectedIndex--].class).toBe(CardClass.Favor);              // 3
    expect(deck[expectedIndex--].class).toBe(CardClass.SeeTheFuture);       // 4
    expect(deck[expectedIndex--].class).toBe(CardClass.Attack);             // 5
    expect(deck[expectedIndex--].class).toBe(CardClass.Skip);               // 6
    expect(deck[expectedIndex--].class).toBe(CardClass.ExplodingCluster);   // 7
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 8
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 9
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 10
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 11
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 12
    expect(deck[expectedIndex--].class).toBe(CardClass.ExplodingCluster);   // 13
    expect(deck[expectedIndex--].class).toBe(CardClass.UpgradeCluster);     // 14
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 15
    expect(deck[expectedIndex--].class).toBe(CardClass.Developer);          // 16
    expect(deck[expectedIndex--].class).toBe(CardClass.UpgradeCluster);     // 17
  });
});
