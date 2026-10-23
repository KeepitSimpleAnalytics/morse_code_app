import { describe, expect, it } from "vitest";
import {
  actualWpm,
  DEFAULT_SPEEDS,
  hydrateSpeeds,
  InvalidSpeedsError,
  isLinked,
  withCharWpm,
  withEffWpm,
} from "../../src/core/speed";

describe("speed hydration (SPEC §4 defect 1)", () => {
  it("regression: effective speed below character speed survives a save/load round trip", () => {
    // v1 saved {charSpeed: 20, effectiveSpeed: 15, farnsworthLocked: false}, then on
    // load syncEffectiveToChar() overwrote the effective speed with 20.
    const saved = JSON.stringify({ charWpm: 20, effWpm: 15 });
    const loaded = hydrateSpeeds(JSON.parse(saved));
    expect(loaded).toEqual({ charWpm: 20, effWpm: 15 });
    expect(isLinked(loaded)).toBe(false);
    expect(actualWpm(loaded)).toBe(15);
  });

  it("round-trips linked speeds and derives linked state rather than storing it", () => {
    const loaded = hydrateSpeeds(JSON.parse(JSON.stringify({ charWpm: 25, effWpm: 25 })));
    expect(loaded).toEqual({ charWpm: 25, effWpm: 25 });
    expect(isLinked(loaded)).toBe(true);
    expect(Object.keys(loaded).sort()).toEqual(["charWpm", "effWpm"]);
  });

  it("rejects invalid saved data instead of repairing it silently", () => {
    for (const bad of [
      null,
      5,
      {},
      { charWpm: 20 },
      { charWpm: 61, effWpm: 15 },
      { charWpm: 20, effWpm: 21 },
      { charWpm: 20, effWpm: 2 },
      { charWpm: 20.5, effWpm: 15 },
    ]) {
      expect(() => hydrateSpeeds(bad)).toThrow(InvalidSpeedsError);
    }
  });

  it("defaults to 20/15", () => {
    expect(DEFAULT_SPEEDS).toEqual({ charWpm: 20, effWpm: 15 });
  });
});

describe("linked speed behaviour (as in v1)", () => {
  it("while linked, moving character speed moves effective too", () => {
    expect(withCharWpm({ charWpm: 20, effWpm: 20 }, 25)).toEqual({ charWpm: 25, effWpm: 25 });
  });

  it("while unlinked, effective stays put unless it would exceed character speed", () => {
    expect(withCharWpm({ charWpm: 20, effWpm: 15 }, 25)).toEqual({ charWpm: 25, effWpm: 15 });
    expect(withCharWpm({ charWpm: 20, effWpm: 15 }, 12)).toEqual({ charWpm: 12, effWpm: 12 });
  });

  it("dragging effective to or above character speed re-links", () => {
    expect(withEffWpm({ charWpm: 20, effWpm: 15 }, 22)).toEqual({ charWpm: 20, effWpm: 20 });
    expect(withEffWpm({ charWpm: 20, effWpm: 20 }, 12)).toEqual({ charWpm: 20, effWpm: 12 });
  });

  it("clamps to the allowed ranges", () => {
    expect(withCharWpm(DEFAULT_SPEEDS, 99).charWpm).toBe(60);
    expect(withCharWpm(DEFAULT_SPEEDS, 1).charWpm).toBe(5);
    expect(withEffWpm(DEFAULT_SPEEDS, 1).effWpm).toBe(3);
  });
});
