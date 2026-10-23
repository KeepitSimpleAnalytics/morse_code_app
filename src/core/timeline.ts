import type { Rng } from "./rng";
import type { Timing } from "./timing";
import type { Token } from "./tokenize";

/**
 * Timeline (SPEC §5.4): the single source of truth for audio scheduling, visual
 * highlighting, WAV export and decoder tests.
 *
 * Elements cover the whole message from the first key-down to the last key-up.
 * Silences between elements are included as `on: false` elements. There is no
 * element for the lead-in or for any trailing silence.
 */
export interface TimelineElement {
  readonly on: boolean;
  /** ms from the start of playback (including the lead-in). */
  readonly start: number;
  readonly dur: number;
  /** Index into the token array: the character keyed, or the gap token for word gaps. */
  readonly tokenIndex: number;
}

export interface TimelineOptions {
  /** Silence before the first element, ms. Default 100 (SPEC §4 defect 6). */
  readonly leadIn?: number;
  /** Whole-message speed variation, 0–0.1 (0–10%). Requires `rng` when above 0. */
  readonly speedJitter?: number;
  readonly rng?: Rng;
}

export const DEFAULT_LEAD_IN_MS = 100;
export const MAX_SPEED_JITTER = 0.1;

/** Picks the per-message duration scale for the given jitter. 1.0 means no change. */
function jitterScale(speedJitter: number, rng: Rng | undefined): number {
  if (!Number.isFinite(speedJitter) || speedJitter < 0 || speedJitter > MAX_SPEED_JITTER) {
    throw new RangeError(`speedJitter must be within 0–0.1, got ${speedJitter}`);
  }
  if (speedJitter === 0) return 1;
  if (!rng) throw new Error("speedJitter > 0 needs an rng so the message can be replayed");
  // Speed varies by ±jitter, so durations scale by its inverse.
  const speedFactor = 1 + (rng.next() * 2 - 1) * speedJitter;
  return 1 / speedFactor;
}

export function buildTimeline(
  tokens: readonly Token[],
  timing: Timing,
  { leadIn = DEFAULT_LEAD_IN_MS, speedJitter = 0, rng }: TimelineOptions = {},
): TimelineElement[] {
  if (!Number.isFinite(leadIn) || leadIn < 0) {
    throw new RangeError(`leadIn must be ≥ 0, got ${leadIn}`);
  }
  const scale = jitterScale(speedJitter, rng);
  const out: TimelineElement[] = [];
  let t = leadIn;
  // Silence owed before the next key-down, and the token it belongs to.
  let pendingGap: { dur: number; tokenIndex: number } | null = null;

  const pushOff = () => {
    if (pendingGap && out.length > 0) {
      const dur = pendingGap.dur * scale;
      out.push({ on: false, start: t, dur, tokenIndex: pendingGap.tokenIndex });
      t += dur;
    }
    pendingGap = null;
  };

  tokens.forEach((token, tokenIndex) => {
    if (token.type === "gap") {
      pendingGap = { dur: timing.wordGap, tokenIndex };
      return;
    }
    [...token.symbol.pattern].forEach((el, i) => {
      if (i > 0) pendingGap = { dur: timing.elementGap, tokenIndex };
      pushOff();
      const dur = (el === "-" ? timing.dah : timing.dot) * scale;
      out.push({ on: true, start: t, dur, tokenIndex });
      t += dur;
    });
    pendingGap = { dur: timing.charGap, tokenIndex };
  });

  return out;
}

/** Time at which the last element ends (0 for an empty timeline). */
export function timelineEnd(elements: readonly TimelineElement[]): number {
  const last = elements[elements.length - 1];
  return last ? last.start + last.dur : 0;
}
