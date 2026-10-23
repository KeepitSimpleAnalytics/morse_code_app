import { describe, expect, it } from "vitest";
import {
  adaptiveWeights,
  charWeight,
  INITIAL_EWMA_ACC,
  rebuildCharStats,
  updateCharStat,
  type CharEventInput,
  type CharStat,
} from "../../src/core/adaptive";
import { mulberry32 } from "../../src/core/rng";

const copy = { mode: "copy", recentSessionsSince: null } as const;

function stat(over: Partial<CharStat> = {}): CharStat {
  return { ch: "K", ewmaAcc: 0.5, ewmaRt: null, attempts: 10, correct: 5, lastSeen: 1000, ...over };
}

describe("updateCharStat", () => {
  it("starts at 0.5 and moves by alpha 0.08", () => {
    const s1 = updateCharStat(undefined, { ch: "K", correct: true, ts: 1 });
    expect(s1.ewmaAcc).toBeCloseTo(INITIAL_EWMA_ACC + 0.08 * 0.5, 12);
    const s2 = updateCharStat(s1, { ch: "K", correct: false, ts: 2 });
    expect(s2.ewmaAcc).toBeCloseTo(s1.ewmaAcc * 0.92, 12);
    expect(s2).toMatchObject({ attempts: 2, correct: 1, lastSeen: 2 });
  });

  it("tracks response time with alpha 0.1, seeded by the first response", () => {
    const s1 = updateCharStat(undefined, { ch: "K", correct: true, responseMs: 800, ts: 1 });
    expect(s1.ewmaRt).toBe(800);
    const s2 = updateCharStat(s1, { ch: "K", correct: true, responseMs: 400, ts: 2 });
    expect(s2.ewmaRt).toBeCloseTo(760, 12);
    const s3 = updateCharStat(s2, { ch: "K", correct: true, ts: 3 });
    expect(s3.ewmaRt).toBe(s2.ewmaRt);
  });

  it("refuses an event for a different character", () => {
    expect(() => updateCharStat(stat(), { ch: "M", correct: true, ts: 1 })).toThrow();
  });
});

describe("charWeight", () => {
  it("rises as accuracy falls", () => {
    const strong = charWeight(stat({ ewmaAcc: 0.95 }), copy);
    const weak = charWeight(stat({ ewmaAcc: 0.4 }), copy);
    expect(weak).toBeGreaterThan(strong);
    expect(charWeight(stat({ ewmaAcc: 1 }), copy)).toBe(1);
    expect(charWeight(stat({ ewmaAcc: 0 }), copy)).toBe(4);
  });

  it("adds a response-time factor in ICR only, clamped to 0–2", () => {
    const slow = stat({ ewmaAcc: 1, ewmaRt: 1200 });
    expect(charWeight(slow, copy)).toBe(1);
    expect(charWeight(slow, { mode: "icr", recentSessionsSince: null })).toBe(2);
    expect(
      charWeight(stat({ ewmaAcc: 1, ewmaRt: 5000 }), { mode: "icr", recentSessionsSince: null }),
    ).toBe(3);
    expect(
      charWeight(stat({ ewmaAcc: 1, ewmaRt: 300 }), { mode: "icr", recentSessionsSince: null }),
    ).toBe(1);
  });

  it("adds 0.5 for characters not seen in the last three sessions", () => {
    const ctx = { mode: "copy", recentSessionsSince: 5000 } as const;
    expect(charWeight(stat({ ewmaAcc: 1, lastSeen: 4999 }), ctx)).toBe(1.5);
    expect(charWeight(stat({ ewmaAcc: 1, lastSeen: 5000 }), ctx)).toBe(1);
    // Never seen: initial accuracy plus the recency bonus.
    expect(charWeight(undefined, copy)).toBe(1 + 3 * 0.5 + 0.5);
  });

  it("builds a weight map for a character set", () => {
    const weights = adaptiveWeights(["K", "M"], new Map([["K", stat({ ewmaAcc: 1 })]]), copy);
    expect(weights.get("K")).toBe(1);
    expect(weights.get("M")).toBe(3);
  });
});

describe("rebuildCharStats", () => {
  it("matches incremental updates exactly", () => {
    const rng = mulberry32(99);
    const events: CharEventInput[] = Array.from({ length: 2000 }, (_, i) => ({
      ch: rng.pick(["K", "M", "R", "S"]),
      correct: rng.next() < 0.8,
      responseMs: rng.next() < 0.5 ? rng.intBetween(200, 2000) : null,
      ts: 1_700_000_000_000 + i * 500,
    }));
    const incremental = new Map<string, CharStat>();
    for (const e of events) incremental.set(e.ch, updateCharStat(incremental.get(e.ch), e));
    // Rebuild from a shuffled copy: it must sort by time first.
    const shuffled = [...events].sort(() => rng.next() - 0.5);
    expect(rebuildCharStats(shuffled)).toEqual(incremental);
  });
});
