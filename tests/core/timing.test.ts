import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../src/core/rng";
import { buildTimeline, timelineEnd } from "../../src/core/timeline";
import { computeTiming, dotMs, farnsworthExtraUnit } from "../../src/core/timing";
import { tokenize } from "../../src/core/tokenize";

/** "PARIS " with its trailing word gap: time from first key-down to the next word. */
function parisMs(charWpm: number, effWpm: number): number {
  const timing = computeTiming({ charWpm, effWpm });
  const elements = buildTimeline(tokenize("PARIS").tokens, timing, { leadIn: 0 });
  return timelineEnd(elements) + timing.wordGap;
}

describe("timing (SPEC §5.3 acceptance)", () => {
  it("PARIS at 20/20 lasts exactly 3000 ms", () => {
    expect(parisMs(20, 20)).toBeCloseTo(3000, 9);
  });

  it("PARIS at 20/10 lasts exactly 6000 ms", () => {
    expect(parisMs(20, 10)).toBeCloseTo(6000, 9);
  });

  it("PARIS at 5/5 lasts 12000 ms", () => {
    expect(parisMs(5, 5)).toBeCloseTo(12000, 9);
  });

  it("the second PARIS starts exactly one PARIS later", () => {
    const timing = computeTiming({ charWpm: 20, effWpm: 20 });
    const tokens = tokenize("PARIS PARIS").tokens;
    const elements = buildTimeline(tokens, timing, { leadIn: 0 });
    const secondP = elements.find((e) => e.on && e.tokenIndex === 6);
    expect(secondP?.start).toBeCloseTo(3000, 9);
  });

  it("Farnsworth at 25/18 matches the ARRL formula within 0.1 ms", () => {
    const t = computeTiming({ charWpm: 25, effWpm: 18 });
    const dot = 1200 / 25;
    const extra = (60000 / 18 - 50 * dot) / 19;
    expect(Math.abs(t.charGap - (3 * dot + 3 * extra))).toBeLessThan(0.1);
    expect(Math.abs(t.wordGap - (7 * dot + 7 * extra))).toBeLessThan(0.1);
    expect(Math.abs(parisMs(25, 18) - 60000 / 18)).toBeLessThan(0.1);
  });

  it("adds no Farnsworth spacing when effective ≥ character speed", () => {
    expect(farnsworthExtraUnit(20, 20)).toBe(0);
    expect(farnsworthExtraUnit(20, 25)).toBe(0);
  });

  it("applies the extra word-spacing multiplier to the word gap only", () => {
    const base = computeTiming({ charWpm: 20, effWpm: 15 });
    const wide = computeTiming({ charWpm: 20, effWpm: 15, wordSpacing: 2 });
    expect(wide.wordGap).toBeCloseTo(base.wordGap * 2, 9);
    expect(wide.charGap).toBe(base.charGap);
  });

  it("rejects invalid input", () => {
    expect(() => dotMs(0)).toThrow(RangeError);
    expect(() => computeTiming({ charWpm: 20, effWpm: -1 })).toThrow(RangeError);
    expect(() => computeTiming({ charWpm: 20, effWpm: 20, wordSpacing: 0.5 })).toThrow(RangeError);
  });
});

describe("timeline", () => {
  const timing = computeTiming({ charWpm: 20, effWpm: 20 }); // dot = 60 ms

  it("starts after a 100 ms lead-in by default (SPEC §4 defect 6)", () => {
    const [first] = buildTimeline(tokenize("E").tokens, timing);
    expect(first).toEqual({ on: true, start: 100, dur: 60, tokenIndex: 0 });
  });

  it("lays out elements and gaps with the right durations", () => {
    const elements = buildTimeline(tokenize("A E").tokens, timing, { leadIn: 0 });
    expect(elements).toEqual([
      { on: true, start: 0, dur: 60, tokenIndex: 0 }, // A: dit
      { on: false, start: 60, dur: 60, tokenIndex: 0 }, //    element gap
      { on: true, start: 120, dur: 180, tokenIndex: 0 }, //   dah
      { on: false, start: 300, dur: 420, tokenIndex: 1 }, // word gap (gap token)
      { on: true, start: 720, dur: 60, tokenIndex: 2 }, // E
    ]);
  });

  it("is contiguous: each element starts where the previous one ended", () => {
    const elements = buildTimeline(tokenize("CQ CQ DE W1ABC <AR>").tokens, timing);
    for (let i = 1; i < elements.length; i++) {
      const prev = elements[i - 1];
      const cur = elements[i];
      expect(cur?.start).toBeCloseTo((prev?.start ?? 0) + (prev?.dur ?? 0), 9);
      expect(cur?.on).not.toBe(prev?.on);
    }
  });

  it("is empty for no tokens", () => {
    expect(buildTimeline([], timing)).toEqual([]);
    expect(timelineEnd([])).toBe(0);
  });

  it("speed jitter scales the whole message, deterministically per seed", () => {
    const tokens = tokenize("PARIS").tokens;
    const plain = timelineEnd(buildTimeline(tokens, timing, { leadIn: 0 }));
    const a = buildTimeline(tokens, timing, { leadIn: 0, speedJitter: 0.1, rng: mulberry32(7) });
    const b = buildTimeline(tokens, timing, { leadIn: 0, speedJitter: 0.1, rng: mulberry32(7) });
    expect(a).toEqual(b);
    const ratio = timelineEnd(a) / plain;
    expect(ratio).toBeGreaterThanOrEqual(1 / 1.1);
    expect(ratio).toBeLessThanOrEqual(1 / 0.9);
    // Proportions are preserved: every element is scaled by the same factor.
    const unscaled = buildTimeline(tokens, timing, { leadIn: 0 });
    a.forEach((e, i) => {
      expect(e.dur / (unscaled[i]?.dur ?? 1)).toBeCloseTo(ratio, 9);
    });
  });

  it("refuses speed jitter without an rng, so sessions stay replayable", () => {
    expect(() => buildTimeline(tokenize("E").tokens, timing, { speedJitter: 0.05 })).toThrow(/rng/);
    expect(() =>
      buildTimeline(tokenize("E").tokens, timing, { speedJitter: 0.2, rng: mulberry32(1) }),
    ).toThrow(RangeError);
  });
});
