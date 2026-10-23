/**
 * Character and effective speed, with v1's "linked" behaviour (SPEC §10.2).
 *
 * v1 defect #1: v1 stored `farnsworthLocked` separately, and on load it overwrote
 * the saved effective speed. Here "linked" is never stored. It is derived as
 * effWpm >= charWpm, and hydration returns exactly what was saved.
 */

export interface Speeds {
  readonly charWpm: number;
  readonly effWpm: number;
}

export const CHAR_WPM_MIN = 5;
export const CHAR_WPM_MAX = 60;
export const EFF_WPM_MIN = 3;
export const DEFAULT_SPEEDS: Speeds = { charWpm: 20, effWpm: 15 };

export function isLinked(s: Speeds): boolean {
  return s.effWpm >= s.charWpm;
}

/** The speed a listener actually experiences (v1's "Actual WPM" indicator). */
export function actualWpm(s: Speeds): number {
  return isLinked(s) ? s.charWpm : s.effWpm;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Moving character speed: effective follows while linked, and never exceeds it. */
export function withCharWpm(s: Speeds, charWpm: number): Speeds {
  const c = clampInt(charWpm, CHAR_WPM_MIN, CHAR_WPM_MAX);
  return { charWpm: c, effWpm: isLinked(s) ? c : Math.min(s.effWpm, c) };
}

/** Moving effective speed: at or above character speed re-links the two. */
export function withEffWpm(s: Speeds, effWpm: number): Speeds {
  const e = clampInt(effWpm, EFF_WPM_MIN, CHAR_WPM_MAX);
  return { charWpm: s.charWpm, effWpm: e >= s.charWpm ? s.charWpm : e };
}

export class InvalidSpeedsError extends Error {
  override readonly name = "InvalidSpeedsError";
}

/**
 * Validates saved speeds and returns them unchanged. Bad data is an error for
 * the caller to surface, never something to quietly repair.
 */
export function hydrateSpeeds(raw: unknown): Speeds {
  if (typeof raw !== "object" || raw === null)
    throw new InvalidSpeedsError("speeds must be an object");
  const { charWpm, effWpm } = raw as Record<string, unknown>;
  if (
    typeof charWpm !== "number" ||
    !Number.isInteger(charWpm) ||
    charWpm < CHAR_WPM_MIN ||
    charWpm > CHAR_WPM_MAX
  ) {
    throw new InvalidSpeedsError(`charWpm must be an integer within 5–60, got ${String(charWpm)}`);
  }
  if (
    typeof effWpm !== "number" ||
    !Number.isInteger(effWpm) ||
    effWpm < EFF_WPM_MIN ||
    effWpm > charWpm
  ) {
    throw new InvalidSpeedsError(
      `effWpm must be an integer within 3–${charWpm}, got ${String(effWpm)}`,
    );
  }
  return { charWpm, effWpm };
}
