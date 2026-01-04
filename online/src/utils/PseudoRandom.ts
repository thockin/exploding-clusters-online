// Copyright 2025 Tim Hockin

import { randomInt } from 'crypto';

/**
 * Interface for random number generation.
 */
export interface RandomSource {
  /**
   * Returns a random number between 0 (inclusive) and 1 (exclusive).
   */
  random(): number;
}

/**
 * A cryptographically secure random number generator.
 */
export class SecureRandom implements RandomSource {
  public random(): number {
    // 2**48 - 1 is the limit for randomInt
    const max = 0xFFFFFFFFFFFF;
    return randomInt(0, max) / max;
  }
}

// A simple Linear Congruential Generator (LCG) for reproducible pseudo-random numbers.
// This is not cryptographically secure and should only be used for game logic in DEVMODE.
export class PseudoRandom implements RandomSource {
  private seedValue: number;

  // Parameters for LCG (values from Numerical Recipes)
  private readonly m = 0x80000000; // 2**31
  private readonly a = 1103515245;
  private readonly c = 12345;

  constructor(seed?: number) {
    this.seedValue = seed === undefined ? Date.now() : seed % this.m;
    if (this.seedValue <= 0) {
      this.seedValue = 1; // Ensure seed is positive
    }
  }

  /**
   * Resets the PRNG with a new seed.
   * @param newSeed The new seed value.
   */
  public seed(newSeed: number): void {
    this.seedValue = newSeed % this.m;
    if (this.seedValue <= 0) {
      this.seedValue = 1;
    }
  }

  /**
   * Returns a pseudo-random number between 0 (inclusive) and 1 (exclusive).
   */
  public random(): number {
    this.seedValue = (this.a * this.seedValue + this.c) % this.m;
    return this.seedValue / (this.m);
  }
}
