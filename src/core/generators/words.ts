import type { Rng } from "../rng";
import { tokenize } from "../tokenize";

/** Words from a word list (SPEC §7.4). */

export interface WordItem {
  readonly word: string;
  /** Shown after the answer, for lists that have meanings (CW abbreviations, Q-codes). */
  readonly meaning?: string;
}

/** The symbols in a word: "73" → ["7", "3"]. Throws on characters with no Morse code. */
export function wordSymbols(word: string): string[] {
  const { tokens, unsupported } = tokenize(word);
  if (unsupported.length > 0) {
    throw new Error(`"${word}" has characters with no Morse code`);
  }
  return tokens.flatMap((t) => (t.type === "char" ? [t.symbol.symbol] : []));
}

/**
 * The words made only of `allowedChars` ("only learned Koch characters"). Without
 * `allowedChars`, every word.
 */
export function wordsUsing(
  items: readonly WordItem[],
  allowedChars?: readonly string[],
): WordItem[] {
  if (!allowedChars) return [...items];
  const allowed = new Set(allowedChars);
  return items.filter((w) => wordSymbols(w.word).every((s) => allowed.has(s)));
}

export interface WordsOptions {
  readonly rng: Rng;
  readonly items: readonly WordItem[];
  readonly allowedChars?: readonly string[];
  readonly count: number;
}

/** Draws `count` words uniformly. The same word never comes twice in a row, unless it's the only one. */
export function generateWords({ rng, items, allowedChars, count }: WordsOptions): WordItem[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  const pool = wordsUsing(items, allowedChars);
  if (pool.length === 0) throw new RangeError("no words use only the allowed characters");
  const out: WordItem[] = [];
  let last = -1;
  for (let i = 0; i < count; i++) {
    let idx = rng.int(pool.length);
    if (pool.length > 1 && idx === last) {
      // Skip over the previous word: uniform over the others.
      idx = (idx + 1 + rng.int(pool.length - 1)) % pool.length;
    }
    last = idx;
    out.push(pool[idx] as WordItem);
  }
  return out;
}
