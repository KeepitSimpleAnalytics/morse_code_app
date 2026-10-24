import { ALPHABET, lookupSymbol } from "./alphabet";

/**
 * Instant Character Recognition (SPEC §7.2): one character plays, the user
 * answers with one keypress, and the response time is measured from the end of
 * the character's sound.
 */

export const ICR_TIMEOUT_MIN_MS = 500;
export const ICR_TIMEOUT_MAX_MS = 5000;
export const ICR_TIMEOUT_DEFAULT_MS = 1500;
/** "Target" never tightens the timeout below this. */
export const ICR_TARGET_FLOOR_MS = 300;
/** Pause after a correct answer before the next character. */
export const ICR_NEXT_DELAY_MS = 300;

export const ICR_COUNT_MIN = 10;
export const ICR_COUNT_MAX = 200;
export const ICR_COUNT_DEFAULT = 50;
export const ICR_MINUTES_MIN = 1;
export const ICR_MINUTES_MAX = 10;

/** Recent correct ICR answers the Target timeout's median is taken over. */
export const TARGET_SAMPLE = 200;

export type IcrRound =
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "minutes"; readonly minutes: number };

/** Every character that can be answered with a single key: everything but prosigns. */
export const SINGLE_KEY_CHARS: readonly string[] = ALPHABET.filter((s) => s.kind !== "prosign").map(
  (s) => s.symbol,
);

/**
 * The ICR set from a source set: prosigns are left out (they can't be typed
 * with one key, §7.2). Returns what was left out, so the UI can say so.
 */
export function icrChars(source: readonly string[]): { chars: string[]; excluded: string[] } {
  const chars: string[] = [];
  const excluded: string[] = [];
  for (const ch of source) {
    const sym = lookupSymbol(ch);
    if (sym && sym.kind !== "prosign") {
      if (!chars.includes(ch)) chars.push(ch);
    } else if (!excluded.includes(ch)) {
      excluded.push(ch);
    }
  }
  return { chars, excluded };
}

/** The character a key press answers with, or null for keys that aren't one (Shift, Tab, F1…). */
export function keyToChar(key: string): string | null {
  if ([...key].length !== 1) return null;
  const sym = lookupSymbol(key.toUpperCase());
  return sym && sym.kind !== "prosign" ? sym.symbol : null;
}

/**
 * The "Target" timeout: the median response time minus 10%, at least 300 ms,
 * and never looser than the set timeout. Without a median, the set timeout.
 */
export function targetTimeout(medianMs: number | null, timeoutMs: number): number {
  if (medianMs === null) return timeoutMs;
  return Math.round(Math.min(timeoutMs, Math.max(ICR_TARGET_FLOOR_MS, medianMs * 0.9)));
}

/** Nearest-rank percentile (p in 0–100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("percentile of an empty list");
  if (!(p >= 0 && p <= 100)) throw new RangeError(`p must be within 0–100, got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

/** Median: the mean of the middle two for an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export interface IcrAttempt {
  readonly ch: string;
  /** The key's character, or null on a timeout. */
  readonly typed: string | null;
  readonly correct: boolean;
  /** ms from the end of the sound. A timeout counts as the timeout value. */
  readonly responseMs: number;
}

export interface IcrCharSummary {
  readonly ch: string;
  readonly attempts: number;
  readonly correct: number;
  readonly medianMs: number;
  readonly p90Ms: number;
  readonly slowestMs: number;
}

export interface IcrSummary {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
  /** Over all attempts; null with none. */
  readonly medianMs: number | null;
  readonly p90Ms: number | null;
  /** Slowest first. */
  readonly perChar: readonly IcrCharSummary[];
}

/** The round summary (§7.2): accuracy, and median, p90 and slowest time per character. */
export function icrSummary(attempts: readonly IcrAttempt[]): IcrSummary {
  const by = new Map<string, IcrAttempt[]>();
  for (const a of attempts) {
    const list = by.get(a.ch);
    if (list) list.push(a);
    else by.set(a.ch, [a]);
  }
  const perChar = [...by.entries()]
    .map(([ch, list]) => {
      const times = list.map((a) => a.responseMs);
      return {
        ch,
        attempts: list.length,
        correct: list.filter((a) => a.correct).length,
        medianMs: median(times),
        p90Ms: percentile(times, 90),
        slowestMs: Math.max(...times),
      };
    })
    .sort((a, b) => b.medianMs - a.medianMs || (a.ch < b.ch ? -1 : 1));
  const correct = attempts.filter((a) => a.correct).length;
  const times = attempts.map((a) => a.responseMs);
  return {
    attempts: attempts.length,
    correct,
    accuracy: attempts.length > 0 ? correct / attempts.length : 0,
    medianMs: times.length > 0 ? median(times) : null,
    p90Ms: times.length > 0 ? percentile(times, 90) : null,
    perChar,
  };
}
