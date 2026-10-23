import type { Rng } from "../rng";
import { createPicker } from "./adaptive";

/** Group length: fixed (1–10) or random within [min, max] (SPEC §5.5). */
export type GroupLength =
  | { readonly kind: "fixed"; readonly length: number }
  | { readonly kind: "random"; readonly min: number; readonly max: number };

export const GROUP_LENGTH_MIN = 1;
export const GROUP_LENGTH_MAX = 10;

export interface GroupsOptions {
  readonly rng: Rng;
  /** Symbols to draw from, e.g. ["K", "M", "<AR>"]. */
  readonly allowedChars: readonly string[];
  readonly weights?: ReadonlyMap<string, number>;
  readonly count: number;
  readonly length: GroupLength;
}

function checkLength(n: number, what: string): void {
  if (!Number.isInteger(n) || n < GROUP_LENGTH_MIN || n > GROUP_LENGTH_MAX) {
    throw new RangeError(`${what} must be an integer within 1–10, got ${n}`);
  }
}

export function validateGroupLength(length: GroupLength): void {
  if (length.kind === "fixed") {
    checkLength(length.length, "group length");
  } else {
    checkLength(length.min, "min group length");
    checkLength(length.max, "max group length");
    if (length.min > length.max) throw new RangeError("min group length exceeds max");
  }
}

/** Random groups. Each item is one group, with prosigns written as "<AR>". */
export function generateGroups({
  rng,
  allowedChars,
  weights,
  count,
  length,
}: GroupsOptions): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  validateGroupLength(length);
  const picker = createPicker(allowedChars, rng, weights);
  return Array.from({ length: count }, () => {
    const n = length.kind === "fixed" ? length.length : rng.intBetween(length.min, length.max);
    let group = "";
    for (let i = 0; i < n; i++) group += picker.next();
    return group;
  });
}
