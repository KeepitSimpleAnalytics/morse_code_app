/**
 * Adaptive weighting (SPEC §8.3). Per-character exponentially weighted accuracy and
 * response time drive how often each character is drawn.
 */

export const INITIAL_EWMA_ACC = 0.5;
export const ALPHA_ACC = 0.08;
export const ALPHA_RT = 0.1;
export const RECENCY_BONUS = 0.5;
export const MAX_RUN = 3;

export interface CharStat {
  readonly ch: string;
  readonly ewmaAcc: number;
  /** ms; null until a timed (ICR) response is recorded. */
  readonly ewmaRt: number | null;
  readonly attempts: number;
  readonly correct: number;
  /** Epoch ms of the last attempt. */
  readonly lastSeen: number;
}

export interface CharEventInput {
  readonly ch: string;
  readonly correct: boolean;
  /** Present for timed modes (ICR). Timeouts are recorded at the timeout value. */
  readonly responseMs?: number | null;
  readonly ts: number;
}

export function updateCharStat(prev: CharStat | undefined, ev: CharEventInput): CharStat {
  if (prev && prev.ch !== ev.ch) {
    throw new Error(`stat for ${prev.ch} updated with an event for ${ev.ch}`);
  }
  const acc = prev?.ewmaAcc ?? INITIAL_EWMA_ACC;
  const hit = ev.correct ? 1 : 0;
  let ewmaRt = prev?.ewmaRt ?? null;
  if (ev.responseMs != null) {
    ewmaRt = ewmaRt === null ? ev.responseMs : ewmaRt + ALPHA_RT * (ev.responseMs - ewmaRt);
  }
  return {
    ch: ev.ch,
    ewmaAcc: acc + ALPHA_ACC * (hit - acc),
    ewmaRt,
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + hit,
    lastSeen: Math.max(prev?.lastSeen ?? 0, ev.ts),
  };
}

/**
 * Rebuilds the char_stats cache from char_events (Settings → Data → Rebuild).
 * Events are applied in time order; equal timestamps keep their given order.
 */
export function rebuildCharStats(events: readonly CharEventInput[]): Map<string, CharStat> {
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.ts - b.e.ts || a.i - b.i);
  const stats = new Map<string, CharStat>();
  for (const { e } of ordered) stats.set(e.ch, updateCharStat(stats.get(e.ch), e));
  return stats;
}

export interface WeightContext {
  /** ICR adds a response-time factor; copy modes don't. */
  readonly mode: "icr" | "copy";
  /**
   * Start time of the third most recent session, or null when there have been fewer
   * than three. A character not seen since then gets the recency bonus.
   */
  readonly recentSessionsSince: number | null;
}

export function charWeight(stat: CharStat | undefined, ctx: WeightContext): number {
  const acc = stat?.ewmaAcc ?? INITIAL_EWMA_ACC;
  const rt = stat?.ewmaRt ?? null;
  const rtFactor =
    ctx.mode === "icr" && rt !== null ? Math.min(2, Math.max(0, (rt - 600) / 600)) : 0;
  const seenRecently =
    stat !== undefined &&
    (ctx.recentSessionsSince === null || stat.lastSeen >= ctx.recentSessionsSince);
  return 1 + 3 * (1 - acc) + rtFactor + (seenRecently ? 0 : RECENCY_BONUS);
}

/** Adaptive weights for a character set. Missing stats count as unseen. */
export function adaptiveWeights(
  chars: readonly string[],
  stats: ReadonlyMap<string, CharStat>,
  ctx: WeightContext,
): Map<string, number> {
  return new Map(chars.map((ch) => [ch, charWeight(stats.get(ch), ctx)]));
}
