/**
 * Seeded pseudo-random number generator.
 *
 * `Math.random` is a bug anywhere in this package. Every draw the engine makes
 * must be reproducible, because:
 *
 *   - Daily Ranked replays the same sequence for every player worldwide;
 *   - the Worker re-derives any round to verify a guess;
 *   - the simulation harness needs repeatable runs to tune the ramp.
 *
 * mulberry32 is used rather than anything fancier: it is 32-bit integer
 * arithmetic only, so Node, the browser and workerd produce byte-identical
 * output. That cross-runtime agreement is the whole point — see the
 * determinism test.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). Returns 0 when maxExclusive <= 0. */
  int(maxExclusive: number): number;
  /** Uniform pick. Returns undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** A new array, shuffled. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * FNV-1a, 32-bit. Turns a string seed into the generator's initial state.
 * Not a cryptographic hash — it only needs to spread similar strings apart.
 */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[int(items.length)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const a = out[i];
        const b = out[j];
        // Guarded for noUncheckedIndexedAccess; both indices are always in range.
        if (a !== undefined && b !== undefined) {
          out[i] = b;
          out[j] = a;
        }
      }
      return out;
    },
  };
}
