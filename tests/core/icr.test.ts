import { describe, expect, it } from "vitest";
import {
  icrChars,
  icrSummary,
  keyToChar,
  median,
  percentile,
  SINGLE_KEY_CHARS,
  targetTimeout,
} from "../../src/core/icr";

describe("ICR keys and character sets", () => {
  it("maps single keys to characters, case-insensitively", () => {
    expect(keyToChar("k")).toBe("K");
    expect(keyToChar("K")).toBe("K");
    expect(keyToChar("5")).toBe("5");
    expect(keyToChar("?")).toBe("?");
    expect(keyToChar("/")).toBe("/");
    expect(keyToChar("Shift")).toBeNull();
    expect(keyToChar("Enter")).toBeNull();
    expect(keyToChar(" ")).toBeNull();
    expect(keyToChar("é")).toBeNull();
  });

  it("leaves prosigns out and reports them", () => {
    expect(icrChars(["K", "<AR>", "M", "K", "="])).toEqual({
      chars: ["K", "M", "="],
      excluded: ["<AR>"],
    });
    expect(SINGLE_KEY_CHARS).not.toContain("<AR>");
    expect(SINGLE_KEY_CHARS).toContain("A");
  });
});

describe("Target timeout", () => {
  it("is the median minus 10%, floored at 300 ms and never looser than the timeout", () => {
    expect(targetTimeout(800, 1500)).toBe(720);
    expect(targetTimeout(200, 1500)).toBe(300);
    expect(targetTimeout(3000, 1500)).toBe(1500);
    expect(targetTimeout(null, 1500)).toBe(1500);
  });
});

describe("statistics", () => {
  it("median and nearest-rank percentile", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
    expect(percentile([5], 90)).toBe(5);
    expect(() => median([])).toThrow(RangeError);
  });

  it("summarizes a round per character, slowest first", () => {
    const s = icrSummary([
      { ch: "K", typed: "K", correct: true, responseMs: 400 },
      { ch: "K", typed: "K", correct: true, responseMs: 600 },
      { ch: "M", typed: null, correct: false, responseMs: 1500 },
      { ch: "M", typed: "M", correct: true, responseMs: 700 },
      { ch: "K", typed: "R", correct: false, responseMs: 900 },
    ]);
    expect(s).toMatchObject({ attempts: 5, correct: 3, accuracy: 0.6, medianMs: 700 });
    expect(s.perChar).toEqual([
      { ch: "M", attempts: 2, correct: 1, medianMs: 1100, p90Ms: 1500, slowestMs: 1500 },
      { ch: "K", attempts: 3, correct: 2, medianMs: 600, p90Ms: 900, slowestMs: 900 },
    ]);
    expect(icrSummary([])).toMatchObject({ attempts: 0, medianMs: null, perChar: [] });
  });
});
