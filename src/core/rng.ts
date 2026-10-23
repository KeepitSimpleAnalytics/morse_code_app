/**
 * Seedable RNG (SPEC §5.5): mulberry32, seeded from the session ID, so a session
 * can be replayed exactly and tests are deterministic.
 */

export interface Rng {
  /** The 32-bit seed this generator started from. */
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  intBetween(min: number, max: number): number;
  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
}

export function mulberry32(seed: number): Rng {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`);
  const start = seed >>> 0;
  let state = start;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    seed: start,
    next,
    int,
    intBetween(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`invalid range [${min}, ${max}]`);
      }
      return min + int(max - min + 1);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("cannot pick from an empty array");
      return items[int(items.length)] as T;
    },
  };
}

/** Derives a 32-bit seed from a string such as a session ID (FNV-1a). */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
