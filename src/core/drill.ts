import type { TrialScore } from "./scoring";
import type { TimelineElement } from "./timeline";

/**
 * Per-item copy sessions (SPEC §7, "Common pattern"): one item plays, the user
 * types and submits, and each item is its own trial. Used by Random Groups,
 * Words, Callsigns and Custom Practice.
 */

export const DRILL_ITEMS_MIN = 5;
export const DRILL_ITEMS_MAX = 50;
export const DRILL_ITEMS_DEFAULT = 10;

/** Silence before each item plays, ms. */
export const ITEM_LEAD_IN_MS = 400;

export type ScoreTotals = Omit<TrialScore, "ops" | "chars">;

/** Session totals over its items. Accuracy follows §8.2 over all sent characters. */
export function totalScores(scores: readonly TrialScore[]): ScoreTotals {
  const sum = (pick: (s: TrialScore) => number) => scores.reduce((n, s) => n + pick(s), 0);
  const sentCharCount = sum((s) => s.sentCharCount);
  const errors = sum((s) => s.errors);
  return {
    sentCharCount,
    correct: sum((s) => s.correct),
    substitutions: sum((s) => s.substitutions),
    misses: sum((s) => s.misses),
    insertions: sum((s) => s.insertions),
    errors,
    accuracy: sentCharCount > 0 ? Math.max(0, 1 - errors / sentCharCount) : 0,
  };
}

/** Sounding time of a timeline: from the first key-down to the last key-up, ms. */
export function audioSpanMs(elements: readonly TimelineElement[]): number {
  const on = elements.filter((e) => e.on);
  const first = on[0];
  const last = on[on.length - 1];
  return first && last ? last.start + last.dur - first.start : 0;
}
