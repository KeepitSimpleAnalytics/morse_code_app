import { FALL_CURVE, RISE_CURVE } from "../core/envelope";

/** The subset of AudioParam the keying code uses (lets tests pass a recorder). */
export interface GainParam {
  setValueAtTime(value: number, startTime: number): unknown;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

/**
 * Schedules one key-down on the keying gain: a raised-cosine rise at the start and
 * its mirror at the end. Shared by live playback and offline rendering, so both
 * produce the same envelope. Times in seconds on the context clock.
 */
export function scheduleKeyDown(
  param: GainParam,
  startSec: number,
  endSec: number,
  riseSec: number,
): void {
  param.setValueCurveAtTime(RISE_CURVE, startSec, riseSec);
  param.setValueCurveAtTime(FALL_CURVE, endSec - riseSec, riseSec);
}

export { FALL_CURVE, RISE_CURVE };
