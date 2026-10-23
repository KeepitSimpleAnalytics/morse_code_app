import { MAX_RUN } from "../adaptive";
import type { Rng } from "../rng";

/**
 * Weighted random selection over a character set (SPEC §8.3). Weights are
 * normalized, draws use the seeded RNG, and no character is drawn more than
 * MAX_RUN times in a row.
 */
export interface Picker {
  next(): string;
}

export function createPicker(
  chars: readonly string[],
  rng: Rng,
  weights?: ReadonlyMap<string, number>,
): Picker {
  const unique = [...new Set(chars)];
  if (unique.length < 2) {
    throw new RangeError(
      `need at least 2 distinct characters to avoid runs longer than ${MAX_RUN}, got ${unique.length}`,
    );
  }
  const w = unique.map((ch) => {
    const value = weights ? weights.get(ch) : 1;
    if (value === undefined) throw new Error(`no weight for ${ch}`);
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`weight for ${ch} must be positive, got ${value}`);
    }
    return value;
  });

  let last: string | null = null;
  let run = 0;

  const draw = (exclude: string | null): string => {
    let total = 0;
    unique.forEach((ch, i) => {
      if (ch !== exclude) total += w[i] as number;
    });
    let r = rng.next() * total;
    let fallback = "";
    for (let i = 0; i < unique.length; i++) {
      const ch = unique[i] as string;
      if (ch === exclude) continue;
      fallback = ch;
      r -= w[i] as number;
      if (r < 0) return ch;
    }
    return fallback; // floating-point remainder lands on the last eligible character
  };

  return {
    next() {
      const ch = draw(run >= MAX_RUN ? last : null);
      run = ch === last ? run + 1 : 1;
      last = ch;
      return ch;
    },
  };
}
