import { describe, expect, it } from "vitest";
import { KeyingScheduler, LOOKAHEAD_SEC } from "../../src/audio/scheduler";
import { effectiveRiseMs } from "../../src/core/envelope";
import { buildTimeline, timelineEnd } from "../../src/core/timeline";
import { computeTiming } from "../../src/core/timing";
import { tokenize } from "../../src/core/tokenize";
import { FakeClock, FakeParam, FakeTimers } from "./fakes";

const timing20 = computeTiming({ charWpm: 20, effWpm: 20 }); // dot 60 ms

function setup() {
  const clock = new FakeClock();
  const param = new FakeParam();
  const timers = new FakeTimers();
  const sched = new KeyingScheduler({ clock, param, timers });
  return { clock, param, timers, sched };
}

function run(clock: FakeClock, timers: FakeTimers, seconds: number, step = 0.016) {
  for (let t = 0; t < seconds; t += step) {
    clock.advance(step);
    timers.tick();
  }
}

describe("KeyingScheduler: playback", () => {
  it("schedules only within the 1.5 s lookahead, then keeps up", () => {
    const { clock, param, timers, sched } = setup();
    const elements = buildTimeline(tokenize("PARIS PARIS PARIS PARIS").tokens, timing20);
    sched.play(elements, 5, {});
    for (const c of param.curves().filter((c) => c.rising))
      expect(c.start).toBeLessThan(LOOKAHEAD_SEC);
    run(clock, timers, 2);
    // The window applies to when key-downs start; a fall may end just past it.
    for (const c of param.curves().filter((c) => c.rising)) {
      expect(c.start).toBeLessThan(clock.currentTime + LOOKAHEAD_SEC);
    }
    run(clock, timers, 12);
    const onCount = elements.filter((e) => e.on).length;
    expect(param.curves()).toHaveLength(onCount * 2);
  });

  it("never overlaps curves, at any speed (the fake throws if it would)", () => {
    for (const wpm of [5, 20, 40, 60]) {
      const { clock, timers, sched } = setup();
      const elements = buildTimeline(
        tokenize("CQ CQ DE W1ABC <AR> 5NN ?").tokens,
        computeTiming({ charWpm: wpm, effWpm: wpm }),
      );
      expect(() => {
        sched.play(elements, effectiveRiseMs(10, elements), {});
        run(clock, timers, timelineEnd(elements) / 1000 + 1);
      }).not.toThrow();
    }
  });

  it("starts after the 100 ms lead-in and reports tokens in order, then done", () => {
    const { clock, timers, sched, param } = setup();
    const tokens = tokenize("K M").tokens;
    const elements = buildTimeline(tokens, timing20);
    const seen: number[] = [];
    let done = 0;
    sched.play(elements, 5, {
      onToken: (i) => seen.push(i),
      onDone: () => {
        done++;
      },
    });
    expect(param.curves()[0]?.start).toBeCloseTo(0.1, 9);
    run(clock, timers, timelineEnd(elements) / 1000 + 0.2);
    expect(seen).toEqual([0, 2]);
    expect(done).toBe(1);
    expect(sched.active).toBe(false);
  });

  it("aligns progress with what is heard (output latency)", () => {
    const clock = new FakeClock();
    const timers = new FakeTimers();
    const sched = new KeyingScheduler({
      clock,
      param: new FakeParam(),
      timers,
      outputLatencySec: () => 0.05,
    });
    const seen: number[] = [];
    sched.play(buildTimeline(tokenize("E").tokens, timing20), 5, { onToken: (i) => seen.push(i) });
    clock.currentTime = 0.12; // key-down at 0.10, heard at 0.15
    sched.progress();
    expect(seen).toEqual([]);
    clock.currentTime = 0.151;
    sched.progress();
    expect(seen).toEqual([0]);
  });
});

describe("KeyingScheduler: stop (≤ 20 ms to silence)", () => {
  const elements = buildTimeline(tokenize("TTTT").tokens, timing20); // dahs of 180 ms
  const rise = 0.005;

  function stopAt(t: number) {
    const { clock, param, sched } = setup();
    sched.play(elements, rise * 1000, {});
    clock.currentTime = t;
    const silentAt = sched.stop();
    return { silentAt, param, now: t };
  }

  it("during a steady key-down: falls immediately", () => {
    const { silentAt, param, now } = stopAt(0.1 + 0.09);
    expect(silentAt - now).toBeCloseTo(rise, 9);
    expect(param.silentFrom()).toBeCloseTo(silentAt, 9);
  });

  it("during a rise: finishes the rise, then falls (never cuts into a curve)", () => {
    const { silentAt, param, now } = stopAt(0.1 + 0.002);
    expect(silentAt - now).toBeLessThanOrEqual(0.02);
    expect(param.silentFrom()).toBeCloseTo(silentAt, 9);
  });

  it("during a fall or a gap: nothing left sounding", () => {
    for (const t of [0.1 + 0.178, 0.1 + 0.2]) {
      const { silentAt, param, now } = stopAt(t);
      expect(silentAt - now).toBeLessThanOrEqual(0.02);
      expect(param.silentFrom()).toBeLessThanOrEqual(silentAt + 1e-9);
      for (const c of param.curves()) expect(c.start).toBeLessThan(silentAt + 1e-9);
    }
  });

  it("regression: a second stop during the first stop's fall doesn't leave the key on", () => {
    const { clock, param, sched } = setup();
    sched.play(elements, 5, {});
    clock.currentTime = 0.1 + 0.002; // inside the first rise: the fall is scheduled ahead
    const quiet = sched.stop();
    expect(sched.stop()).toBeCloseTo(quiet, 12); // e.g. Stop pressed twice, or Stop then Play
    sched.play(elements, 5, {});
    sched.stop();
    expect(param.silentFrom()).toBeCloseTo(quiet, 9);
  });

  it("Play/Stop 100 times keeps working with no leftover automation (QA 10)", () => {
    const { clock, param, timers, sched } = setup();
    for (let i = 0; i < 100; i++) {
      sched.play(elements, 5, {});
      run(clock, timers, 0.05 + (i % 7) * 0.03);
      sched.stop();
      expect(param.silentFrom()).toBeLessThanOrEqual(clock.currentTime + 0.02);
      expect(timers.intervals.size).toBe(0);
      expect(timers.frames.size).toBe(0);
    }
  });
});

describe("KeyingScheduler: live mode", () => {
  const charEls = (ch: string) => buildTimeline(tokenize(ch).tokens, timing20, { leadIn: 0 });

  it("plays appended characters with the right gap, or as soon as possible when idle", () => {
    const { clock, param, sched } = setup();
    sched.startLive(5, {});
    sched.append(charEls("E"), 0, timing20.charGap, 5);
    sched.append(charEls("T"), 1, timing20.charGap, 5);
    const [eRise, eFall, tRise] = param.curves();
    expect(eRise?.start).toBeCloseTo(0.03, 9);
    const eEnd = (eFall?.start ?? 0) + (eFall?.dur ?? 0);
    expect((tRise?.start ?? 0) - eEnd).toBeCloseTo(timing20.charGap / 1000, 9);
    // After a long idle period the next character starts right away, not "a gap after" the old one.
    clock.currentTime = 10;
    sched.append(charEls("E"), 2, timing20.wordGap, 5);
    expect(param.curves().at(-2)?.start).toBeCloseTo(10.03, 9);
  });

  it("removes a queued character that hasn't started, but not one that has", () => {
    const { clock, param, sched } = setup();
    sched.startLive(5, {});
    sched.append(charEls("E"), 0, 0, 5);
    sched.append(charEls("T"), 1, timing20.charGap, 5);
    expect(sched.pendingTokens()).toBe(2);
    expect(sched.removePending(1)).toBe(true);
    expect(param.curves()).toHaveLength(2);
    expect(sched.pendingTokens()).toBe(1);
    clock.currentTime = 0.05; // E has started
    expect(sched.removePending(0)).toBe(false);
  });

  it("refuses append outside live mode", () => {
    const { sched } = setup();
    expect(() => {
      sched.append(charEls("E"), 0, 0, 5);
    }).toThrow(/live/);
  });
});
