/**
 * The Stats dashboard's numbers (SPEC §7.10, trimmed in §15): practice time,
 * recent accuracy, what each character is confused with, and the characters
 * for "Practise my weak characters".
 */

/** Local midnight at the start of the day containing `ts`. */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Local midnight `days` calendar days before the day containing `ts`. Counts
 * by the calendar, not in 24-hour steps, so a clock change between doesn't
 * shift it by an hour. `daysBefore(now, 6)` starts "the last 7 days".
 */
export function daysBefore(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export interface SessionTotals {
  readonly startedAt: number;
  readonly activeMs: number;
  readonly sentChars: number;
  readonly errors: number;
}

/** Practice time in sessions started at or after `since`, ms. */
export function practiceMsSince(sessions: readonly SessionTotals[], since: number): number {
  return sessions.reduce((n, s) => (s.startedAt >= since ? n + s.activeMs : n), 0);
}

/**
 * Accuracy over sessions started at or after `since`, by §8.2 over every sent
 * character, so a long session counts for more than a short one. Null with
 * nothing sent.
 */
export function accuracySince(sessions: readonly SessionTotals[], since: number): number | null {
  let sent = 0;
  let errors = 0;
  for (const s of sessions) {
    if (s.startedAt < since) continue;
    sent += s.sentChars;
    errors += s.errors;
  }
  return sent > 0 ? Math.max(0, 1 - errors / sent) : null;
}

export interface Confusion {
  /** What was typed instead. */
  readonly typed: string;
  readonly count: number;
  /** count ÷ attempts at the character. */
  readonly share: number;
}

export interface OutcomeTally {
  readonly outcome: "correct" | "substituted" | "missed";
  readonly typed: string | null;
  readonly count: number;
}

/**
 * What a character was heard as, most often first ("You hear H as S 23% of
 * the time"), from its events counted by outcome and what was typed.
 */
export function confusions(tallies: readonly OutcomeTally[], attempts: number): Confusion[] {
  if (attempts <= 0) return [];
  const by = new Map<string, number>();
  for (const t of tallies) {
    if (t.outcome === "substituted" && t.typed !== null) {
      by.set(t.typed, (by.get(t.typed) ?? 0) + t.count);
    }
  }
  return [...by.entries()]
    .map(([typed, count]) => ({ typed, count, share: count / attempts }))
    .sort((a, b) => b.count - a.count || (a.typed < b.typed ? -1 : 1));
}

/** How many times nothing was typed for the character. */
export function missedCount(tallies: readonly OutcomeTally[]): number {
  return tallies.reduce((n, t) => (t.outcome === "missed" ? n + t.count : n), 0);
}

export interface CharAccuracy {
  readonly ch: string;
  readonly ewmaAcc: number;
  readonly attempts: number;
}

export const WEAK_COUNT = 6;
export const WEAK_MIN_ATTEMPTS = 20;

/**
 * "Practise my weak characters" (§7.10): the weakest characters with at least
 * 20 attempts, up to six, then filled up to six from the learned Koch
 * characters, weakest first (unpractised ones count as 0.5, the starting
 * accuracy). Empty when no character has 20 attempts yet.
 */
export function weakForPractice(
  stats: readonly CharAccuracy[],
  learned: readonly string[],
  count = WEAK_COUNT,
  minAttempts = WEAK_MIN_ATTEMPTS,
): string[] {
  const byAcc = (a: { acc: number; ch: string }, b: { acc: number; ch: string }) =>
    a.acc - b.acc || (a.ch < b.ch ? -1 : 1);
  const weak = stats
    .filter((s) => s.attempts >= minAttempts)
    .map((s) => ({ ch: s.ch, acc: s.ewmaAcc }))
    .sort(byAcc)
    .slice(0, count)
    .map((s) => s.ch);
  if (weak.length === 0) return [];
  const acc = new Map(stats.map((s) => [s.ch, s.ewmaAcc]));
  const filler = learned
    .filter((ch) => !weak.includes(ch))
    .map((ch) => ({ ch, acc: acc.get(ch) ?? 0.5 }))
    .sort(byAcc)
    .slice(0, Math.max(0, count - weak.length))
    .map((s) => s.ch);
  return [...weak, ...filler];
}
