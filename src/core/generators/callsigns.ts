import type { Rng } from "../rng";

/**
 * Callsigns (SPEC §7.5): a weighted prefix, a digit, then a suffix of letters.
 * A format "2×3" is a 2-character prefix and a 3-letter suffix, as in DL1ABC.
 */

export const CALLSIGN_FORMATS = ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3"] as const;
export type CallsignFormat = (typeof CALLSIGN_FORMATS)[number];

export interface Prefix {
  readonly prefix: string;
  readonly entity: string;
  /** Rough on-air activity; only the ratios matter. */
  readonly weight: number;
  /** United States, for "US only". */
  readonly us?: boolean;
  /**
   * The digits this prefix takes, when only some of them mean this entity
   * (HB0 is Liechtenstein, not Switzerland). Default: any digit.
   */
  readonly digits?: string;
}

export interface CallsignsOptions {
  readonly rng: Rng;
  readonly prefixes: readonly Prefix[];
  readonly formats: readonly CallsignFormat[];
  /** Draw from US prefixes only (v1 behaviour). */
  readonly usOnly: boolean;
  readonly count: number;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function shape(format: CallsignFormat): { prefixLen: number; suffixLen: number } {
  const [p, s] = format.split("x");
  return { prefixLen: Number(p), suffixLen: Number(s) };
}

/** The prefixes that can be drawn with these options, e.g. for a preview. */
export function eligiblePrefixes(
  prefixes: readonly Prefix[],
  formats: readonly CallsignFormat[],
  usOnly: boolean,
): Prefix[] {
  const lengths = new Set(formats.map((f) => shape(f).prefixLen));
  return prefixes.filter((p) => (!usOnly || p.us === true) && lengths.has(p.prefix.length));
}

export function generateCallsigns({
  rng,
  prefixes,
  formats,
  usOnly,
  count,
}: CallsignsOptions): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  if (formats.length === 0) throw new RangeError("choose at least one callsign format");
  const pool = eligiblePrefixes(prefixes, formats, usOnly);
  if (pool.length === 0) throw new RangeError("no prefixes fit the chosen formats");
  for (const p of pool) {
    if (!Number.isFinite(p.weight) || p.weight <= 0) {
      throw new RangeError(`weight for ${p.prefix} must be positive, got ${p.weight}`);
    }
    if (p.digits !== undefined && !/^\d+$/.test(p.digits)) {
      throw new RangeError(`digits for ${p.prefix} must be digits, got "${p.digits}"`);
    }
  }
  const total = pool.reduce((sum, p) => sum + p.weight, 0);

  const pickPrefix = (): Prefix => {
    let r = rng.next() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r < 0) return p;
    }
    return pool[pool.length - 1] as Prefix; // floating-point remainder
  };

  return Array.from({ length: count }, () => {
    const prefix = pickPrefix();
    const fits = formats.filter((f) => shape(f).prefixLen === prefix.prefix.length);
    const { suffixLen } = shape(rng.pick(fits));
    let suffix = "";
    for (let i = 0; i < suffixLen; i++) suffix += LETTERS.charAt(rng.int(LETTERS.length));
    const digit = prefix.digits
      ? (prefix.digits[rng.int(prefix.digits.length)] as string)
      : rng.int(10);
    return `${prefix.prefix}${digit}${suffix}`;
  });
}
