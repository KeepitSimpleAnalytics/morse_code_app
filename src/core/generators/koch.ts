import { kochChars, newestKochChar, type KochOrder } from "../koch";
import type { Rng } from "../rng";
import { generateGroups, type GroupLength } from "./groups";

export const DEFAULT_NEWEST_WEIGHT = 2;
export const NEWEST_WEIGHT_MIN = 1;
export const NEWEST_WEIGHT_MAX = 4;

export interface KochGroupsOptions {
  readonly rng: Rng;
  readonly order: KochOrder;
  readonly level: number;
  readonly count: number;
  /** Default: fixed 5-character groups. */
  readonly length?: GroupLength;
  /**
   * Adaptive weights (§8.3) for the learned characters. Without them every
   * character starts at weight 1.
   */
  readonly weights?: ReadonlyMap<string, number>;
  /** Multiplier for the newest character, 1–4 (default 2). */
  readonly newestWeight?: number;
  /** Optionally restrict further, e.g. to drill a subset. Must leave ≥ 2 characters. */
  readonly allowedChars?: readonly string[];
}

/** Groups drawn from the first N+1 characters of the order (SPEC §7.1). */
export function generateKochGroups({
  rng,
  order,
  level,
  count,
  length = { kind: "fixed", length: 5 },
  weights,
  newestWeight = DEFAULT_NEWEST_WEIGHT,
  allowedChars,
}: KochGroupsOptions): string[] {
  if (
    !Number.isFinite(newestWeight) ||
    newestWeight < NEWEST_WEIGHT_MIN ||
    newestWeight > NEWEST_WEIGHT_MAX
  ) {
    throw new RangeError(`newestWeight must be within 1–4, got ${newestWeight}`);
  }
  const learned = kochChars(order, level);
  const allowed = allowedChars ? new Set(allowedChars) : null;
  const chars = allowed ? learned.filter((c) => allowed.has(c)) : learned;
  const newest = newestKochChar(order, level);

  const w = new Map<string, number>();
  for (const ch of chars) {
    const base = weights ? weights.get(ch) : 1;
    if (base === undefined) throw new Error(`no adaptive weight for ${ch}`);
    w.set(ch, ch === newest ? base * newestWeight : base);
  }
  return generateGroups({ rng, allowedChars: chars, weights: w, count, length });
}
