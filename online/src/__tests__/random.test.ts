// Copyright 2025 Tim Hockin

import { PseudoRandom, SecureRandom } from '../utils/PseudoRandom';

describe('Random Generators', () => {
  describe('PseudoRandom', () => {
    it('should be reproducible with the same seed', () => {
      const prng1 = new PseudoRandom(12345);
      const prng2 = new PseudoRandom(12345);

      for (let i = 0; i < 100; i++) {
        expect(prng1.random()).toBe(prng2.random());
      }
    });

    it('should be different with different seeds', () => {
      const prng1 = new PseudoRandom(12345);
      const prng2 = new PseudoRandom(54321);

      expect(prng1.random()).not.toBe(prng2.random());
    });

    it('should produce numbers between 0 and 1', () => {
      const prng = new PseudoRandom();
      for (let i = 0; i < 1000; i++) {
        const val = prng.random();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe('SecureRandom', () => {
    it('should produce numbers between 0 and 1', () => {
      const sr = new SecureRandom();
      for (let i = 0; i < 1000; i++) {
        const val = sr.random();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it('should be different on consecutive calls', () => {
      const sr = new SecureRandom();
      const val1 = sr.random();
      const val2 = sr.random();
      expect(val1).not.toBe(val2);
    });
  });
});
