import type { TimelineElement } from "../core/timeline";
import { FALL_CURVE, scheduleKeyDown, type GainParam } from "./keying";

/**
 * Lookahead scheduler (SPEC §6). A 50 ms timer writes key-downs onto the keying gain
 * up to 1.5 s ahead of the audio clock. A requestAnimationFrame loop reports which
 * token is sounding. Supports stop (≤ 20 ms to silence), live append and removal of
 * not-yet-played tokens (type-to-transmit, keyer sidetone).
 */

export const TICK_MS = 50;
export const LOOKAHEAD_SEC = 1.5;
/** How soon a live-appended character may start after "now". */
export const LIVE_LEAD_SEC = 0.03;
/** A token counts as started once its first element is this close to "now". */
const STARTED_MARGIN_SEC = 0.005;

export interface Clock {
  readonly currentTime: number;
}

export interface Timers {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  requestAnimationFrame(fn: () => void): number;
  cancelAnimationFrame(id: number): void;
}

export const browserTimers: Timers = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => {
    window.clearInterval(id);
  },
  requestAnimationFrame: (fn) => window.requestAnimationFrame(fn),
  cancelAnimationFrame: (id) => {
    window.cancelAnimationFrame(id);
  },
};

export interface SchedulerDeps {
  readonly clock: Clock;
  readonly param: GainParam;
  readonly timers: Timers;
  /** Seconds between the clock and what the listener hears (ctx.outputLatency). */
  readonly outputLatencySec?: () => number;
}

export interface PlaybackListener {
  /** A new token started sounding (as heard, after output latency). */
  onToken?(tokenIndex: number): void;
  /** Every queued element has been heard. Not fired in live mode. */
  onDone?(): void;
}

interface Keyed {
  readonly start: number;
  readonly end: number;
  readonly tokenIndex: number;
}

export class KeyingScheduler {
  private queue: Keyed[] = [];
  /** Next queue index to write onto the gain param. */
  private nextToSchedule = 0;
  /** Next queue index to report as heard. */
  private nextToReport = 0;
  private lastReportedToken: number | null = null;
  private riseSec = 0.005;
  private live = false;
  private listener: PlaybackListener = {};
  private interval: number | null = null;
  private raf: number | null = null;
  private doneFired = false;
  /** When the fall scheduled by the last stop() completes. Nothing before it may be cancelled. */
  private quietAt = 0;

  constructor(private readonly deps: SchedulerDeps) {}

  get active(): boolean {
    return this.interval !== null;
  }

  /**
   * Plays a timeline (on-elements only are keyed; `start` is relative to now, in ms).
   * Replaces anything already playing.
   */
  play(elements: readonly TimelineElement[], riseMs: number, listener: PlaybackListener): void {
    const t0 = this.stop();
    this.riseSec = riseMs / 1000;
    this.live = false;
    this.listener = listener;
    this.queue = elements
      .filter((e) => e.on)
      .map((e) => ({
        start: t0 + e.start / 1000,
        end: t0 + (e.start + e.dur) / 1000,
        tokenIndex: e.tokenIndex,
      }));
    this.begin();
  }

  /** Enters live mode (type-to-transmit). Characters are added with `append`. */
  startLive(riseMs: number, listener: PlaybackListener): void {
    this.stop();
    this.riseSec = riseMs / 1000;
    this.live = true;
    this.listener = listener;
    this.queue = [];
    this.begin();
  }

  /**
   * Live mode: queues one token's elements (`start` relative to the token, in ms),
   * `gapBeforeMs` after the previous key-up, or as soon as possible if idle.
   * `riseMs` is clamped for this token's speed (speed may change while live).
   */
  append(
    elements: readonly TimelineElement[],
    tokenIndex: number,
    gapBeforeMs: number,
    riseMs: number,
  ): void {
    if (!this.live) throw new Error("append() needs live mode");
    this.riseSec = riseMs / 1000;
    const on = elements.filter((e) => e.on);
    const first = on[0];
    if (!first) return;
    const now = this.deps.clock.currentTime;
    const last = this.queue[this.queue.length - 1];
    const earliest = now + LIVE_LEAD_SEC;
    const base = Math.max(last ? last.end + gapBeforeMs / 1000 : earliest, earliest);
    for (const e of on) {
      this.queue.push({
        start: base + (e.start - first.start) / 1000,
        end: base + (e.start - first.start + e.dur) / 1000,
        tokenIndex,
      });
    }
    this.pump();
  }

  /** Live mode: removes a token if it is last in the queue and hasn't started. */
  removePending(tokenIndex: number): boolean {
    const now = this.deps.clock.currentTime;
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]?.tokenIndex === tokenIndex) i--;
    const first = this.queue[i];
    if (i === this.queue.length || !first || first.start <= now + STARTED_MARGIN_SEC) return false;
    if (this.nextToSchedule > i) this.deps.param.cancelScheduledValues(first.start);
    this.queue.length = i;
    this.nextToSchedule = Math.min(this.nextToSchedule, i);
    this.nextToReport = Math.min(this.nextToReport, i);
    return true;
  }

  /**
   * Clock time (seconds) at which the last queued element's key-up ends, or null
   * with nothing queued. ICR times responses from here (SPEC §7.2).
   */
  endTime(): number | null {
    return this.queue[this.queue.length - 1]?.end ?? null;
  }

  /** Distinct tokens queued in live mode that haven't started yet. */
  pendingTokens(): number {
    const now = this.deps.clock.currentTime;
    const ids = new Set<number>();
    for (const k of this.queue) if (k.start > now + STARTED_MARGIN_SEC) ids.add(k.tokenIndex);
    return ids.size;
  }

  /**
   * Silences the key and clears the queue. Never cuts into a curve that is already
   * running (that would throw), so silence arrives within rise + fall ≤ 20 ms.
   * Returns the clock time from which the key is guaranteed silent.
   */
  stop(): number {
    const { clock, param, timers } = this.deps;
    if (this.interval !== null) timers.clearInterval(this.interval);
    if (this.raf !== null) timers.cancelAnimationFrame(this.raf);
    this.interval = null;
    this.raf = null;

    const now = clock.currentTime;
    const rise = this.riseSec;
    if (now < this.quietAt) {
      // A previous stop's fall is still pending or running. Cancelling before it ends
      // would remove that fall and leave the key stuck on, so only clear what follows.
      param.cancelScheduledValues(this.quietAt);
      this.resetQueue();
      return this.quietAt;
    }
    let stopAt = now;
    let keyIsOn = false;
    for (let i = 0; i < this.nextToSchedule; i++) {
      const k = this.queue[i] as Keyed;
      if (now < k.start || now >= k.end) continue;
      if (now < k.start + rise) {
        stopAt = k.start + rise; // finish the rise, then fall
        keyIsOn = true;
      } else if (now < k.end - rise) {
        keyIsOn = true; // steady key-down: fall from now
      } else {
        stopAt = k.end; // already falling
      }
      break;
    }
    param.cancelScheduledValues(stopAt);
    let silentAt = stopAt;
    if (keyIsOn) {
      param.setValueCurveAtTime(FALL_CURVE, stopAt, rise);
      silentAt = stopAt + rise;
    }
    this.quietAt = silentAt;
    this.resetQueue();
    return silentAt;
  }

  private resetQueue(): void {
    this.queue = [];
    this.nextToSchedule = 0;
    this.nextToReport = 0;
    this.lastReportedToken = null;
    this.doneFired = false;
  }

  private begin(): void {
    const { timers } = this.deps;
    this.nextToSchedule = 0;
    this.nextToReport = 0;
    this.lastReportedToken = null;
    this.doneFired = false;
    this.pump();
    this.interval = timers.setInterval(() => {
      this.pump();
    }, TICK_MS);
    const frame = () => {
      this.progress();
      if (this.interval !== null) this.raf = timers.requestAnimationFrame(frame);
    };
    this.raf = timers.requestAnimationFrame(frame);
  }

  /** Writes queued key-downs that start within the lookahead window. */
  pump(): void {
    const horizon = this.deps.clock.currentTime + LOOKAHEAD_SEC;
    while (this.nextToSchedule < this.queue.length) {
      const k = this.queue[this.nextToSchedule] as Keyed;
      if (k.start >= horizon) break;
      scheduleKeyDown(this.deps.param, k.start, k.end, this.riseSec);
      this.nextToSchedule++;
    }
  }

  /** Reports the token being heard, and completion. */
  progress(): void {
    const heard = this.deps.clock.currentTime - (this.deps.outputLatencySec?.() ?? 0);
    while (this.nextToReport < this.queue.length) {
      const k = this.queue[this.nextToReport] as Keyed;
      if (k.start > heard) break;
      if (k.tokenIndex !== this.lastReportedToken) {
        this.lastReportedToken = k.tokenIndex;
        this.listener.onToken?.(k.tokenIndex);
      }
      this.nextToReport++;
    }
    const last = this.queue[this.queue.length - 1];
    if (!this.live && !this.doneFired && last && heard >= last.end) {
      this.doneFired = true;
      const listener = this.listener;
      this.stop();
      listener.onDone?.();
    }
  }
}
