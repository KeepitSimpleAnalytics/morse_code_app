import type { TimelineElement } from "./timeline";

/**
 * Keying envelope (SPEC §6). Each key-down rises along a raised-cosine curve and
 * falls along its mirror image. Live audio, offline rendering and direct WAV
 * synthesis all use these exact curves.
 */

export const CURVE_POINTS = 64;
export const RISE_MS_MIN = 2;
export const RISE_MS_MAX = 10;
export const DEFAULT_RISE_MS = 5;
/** Rise time may be at most this fraction of the shortest element, so curves never overlap. */
export const MAX_RISE_FRACTION = 0.4;

function raisedCosine(points: number): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / (points - 1));
  return curve;
}

export const RISE_CURVE: Float32Array = raisedCosine(CURVE_POINTS);
export const FALL_CURVE: Float32Array = RISE_CURVE.slice().reverse();

/**
 * The rise time actually used: the setting (2–10 ms), clamped to 0.4 × the shortest
 * on-element so that a rise and a fall can never overlap (that would throw in Web Audio).
 */
export function effectiveRiseMs(riseMs: number, elements: readonly TimelineElement[]): number {
  if (!Number.isFinite(riseMs) || riseMs < RISE_MS_MIN || riseMs > RISE_MS_MAX) {
    throw new RangeError(`rise time must be within 2–10 ms, got ${riseMs}`);
  }
  let shortest = Number.POSITIVE_INFINITY;
  for (const el of elements) if (el.on && el.dur < shortest) shortest = el.dur;
  return Math.min(riseMs, shortest * MAX_RISE_FRACTION);
}

/**
 * Gain at time t for a curve that starts at `start` and lasts `dur`, matching the
 * Web Audio setValueCurveAtTime definition: linear interpolation between points,
 * holding the last value afterwards.
 */
export function curveValueAt(curve: Float32Array, start: number, dur: number, t: number): number {
  const n = curve.length;
  if (t <= start) return curve[0] as number;
  if (t >= start + dur) return curve[n - 1] as number;
  const pos = ((n - 1) * (t - start)) / dur;
  const k = Math.floor(pos);
  const a = curve[k] as number;
  const b = curve[Math.min(k + 1, n - 1)] as number;
  return a + (b - a) * (pos - k);
}

/** Envelope gain (0–1) at time t (ms) for one on-element. */
export function elementGainAt(el: TimelineElement, riseMs: number, t: number): number {
  const end = el.start + el.dur;
  if (t < el.start || t >= end) return 0;
  if (t < el.start + riseMs) return curveValueAt(RISE_CURVE, el.start, riseMs, t);
  if (t >= end - riseMs) return curveValueAt(FALL_CURVE, end - riseMs, riseMs, t);
  return 1;
}
