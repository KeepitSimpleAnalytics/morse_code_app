import type { GainParam } from "../../src/audio/keying";
import type { Timers } from "../../src/audio/scheduler";

export interface CurveEvent {
  kind: "curve";
  start: number;
  dur: number;
  rising: boolean;
}
export interface SetEvent {
  kind: "set";
  start: number;
  value: number;
}
export type ParamEvent = CurveEvent | SetEvent;

/**
 * An AudioParam stand-in that enforces the Web Audio rule browsers enforce: no event
 * may be scheduled inside a running value curve, and a curve may not overlap any
 * other event. Violations throw, exactly as Chromium/WebKit do.
 */
export class FakeParam implements GainParam {
  events: ParamEvent[] = [];
  cancels: number[] = [];

  private overlapsCurve(t0: number, t1: number): boolean {
    const EPS = 1e-9;
    return this.events.some((e) => {
      if (e.kind === "curve") return t0 < e.start + e.dur - EPS && t1 > e.start + EPS;
      return e.start > t0 + EPS && e.start < t1 - EPS;
    });
  }

  setValueAtTime(value: number, start: number): void {
    if (this.overlapsCurve(start, start))
      throw new Error(`setValueAtTime(${start}) inside a curve`);
    this.events.push({ kind: "set", start, value });
  }

  setValueCurveAtTime(values: Float32Array, start: number, dur: number): void {
    if (this.overlapsCurve(start, start + dur)) {
      throw new Error(`setValueCurveAtTime(${start}, ${dur}) overlaps another event`);
    }
    this.events.push({
      kind: "curve",
      start,
      dur,
      rising: (values[values.length - 1] ?? 0) > (values[0] ?? 0),
    });
  }

  cancelScheduledValues(t: number): void {
    this.cancels.push(t);
    this.events = this.events.filter((e) => e.start < t);
  }

  curves(): CurveEvent[] {
    return this.events
      .filter((e): e is CurveEvent => e.kind === "curve")
      .sort((a, b) => a.start - b.start);
  }

  /** The time after which the gain is guaranteed 0 (end of the last falling curve). */
  silentFrom(): number {
    const curves = this.curves();
    const last = curves[curves.length - 1];
    if (!last) return 0;
    if (last.rising) return Number.POSITIVE_INFINITY;
    return last.start + last.dur;
  }
}

export class FakeClock {
  currentTime = 0;
  advance(sec: number): void {
    this.currentTime += sec;
  }
}

/** Timers driven manually by the test. */
export class FakeTimers implements Timers {
  intervals = new Map<number, () => void>();
  frames = new Map<number, () => void>();
  private id = 0;

  setInterval(fn: () => void): number {
    this.intervals.set(++this.id, fn);
    return this.id;
  }
  clearInterval(id: number): void {
    this.intervals.delete(id);
  }
  requestAnimationFrame(fn: () => void): number {
    this.frames.set(++this.id, fn);
    return this.id;
  }
  cancelAnimationFrame(id: number): void {
    this.frames.delete(id);
  }

  /** Runs one timer tick and one animation frame. */
  tick(): void {
    for (const fn of [...this.intervals.values()]) fn();
    const frames = [...this.frames.entries()];
    this.frames.clear();
    for (const [, fn] of frames) fn();
  }
}
