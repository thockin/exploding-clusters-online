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
      { id: 'NAK_a', name: 'nak1', class: CardClass.Nak, imageUrl: '' },
      { id: 'SHUFFLE_a', name: 'shuffle1', class: CardClass.Shuffle, imageUrl: '' },
      { id: 'FAVOR_a', name: 'favor1', class: CardClass.Favor, imageUrl: '' },
      { id: 'SEE_a', name: 'see1', class: CardClass.SeeTheFuture, imageUrl: '' },
      { id: 'ATTACK_a', name: 'attack1', class: CardClass.Attack, imageUrl: '' },
      { id: 'SKIP_a', name: 'skip1', class: CardClass.Skip, imageUrl: '' },
      { id: 'EXP_a', name: 'exp1', class: CardClass.ExplodingCluster, imageUrl: '' }, // First Exploding
      { id: 'DEV_a', name: 'dev1', class: CardClass.Developer, imageUrl: '' }, // 1st Dev
      { id: 'DEV_b', name: 'dev2', class: CardClass.Developer, imageUrl: '' }, // 2nd Dev
      { id: 'DEV_c', name: 'dev3', class: CardClass.Developer, imageUrl: '' }, // 3rd Dev
      { id: 'DEV_d', name: 'dev4', class: CardClass.Developer, imageUrl: '' }, // 4th Dev
      { id: 'DEV_e', name: 'dev5', class: CardClass.Developer, imageUrl: '' }, // 5th Dev
      { id: 'EXP_b', name: 'exp2', class: CardClass.ExplodingCluster, imageUrl: '' }, // Second Exploding
      { id: 'UPGRADE_a', name: 'upgrade1', class: CardClass.UpgradeCluster, imageUrl: '' },
      { id: 'DEV_f', name: 'dev6', class: CardClass.Developer, imageUrl: '' }, // 6th Dev
      { id: 'filler_a', name: 'f1', class: CardClass.Debug, imageUrl: '' },
      { id: 'filler_b', name: 'f2', class: CardClass.Debug, imageUrl: '' },
      { id: 'DEV_g', name: 'dev6', class: CardClass.Developer, imageUrl: '' }, // 7th Dev
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
  });
});
