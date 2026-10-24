import { describe, expect, it } from "vitest";
import {
  accuracySince,
  confusions,
  dayStart,
  practiceMsSince,
  weakForPractice,
} from "../../src/core/stats";

const s = (startedAt: number, activeMs: number, sentChars: number, errors: number) => ({
  startedAt,
  activeMs,
  sentChars,
  errors,
});

describe("stats", () => {
  it("finds local midnight", () => {
    const noon = new Date(2026, 9, 23, 12, 30).getTime();
    expect(dayStart(noon)).toBe(new Date(2026, 9, 23).getTime());
  });

  it("sums practice time and weighs accuracy by characters sent", () => {
    const list = [s(100, 60_000, 100, 10), s(200, 30_000, 10, 10), s(50, 99_000, 50, 0)];
    expect(practiceMsSince(list, 100)).toBe(90_000);
    expect(accuracySince(list, 100)).toBeCloseTo(1 - 20 / 110);
    expect(accuracySince(list, 1000)).toBeNull();
  });

  it("lists what a character is heard as, most often first", () => {
    const subs = [{ typed: "S" }, { typed: "5" }, { typed: "S" }, { typed: null }];
    expect(confusions(subs, 10)).toEqual([
      { typed: "S", count: 2, share: 0.2 },
      { typed: "5", count: 1, share: 0.1 },
    ]);
    expect(confusions(subs, 0)).toEqual([]);
  });

  it("picks the weakest well-practised characters, filled from learned ones", () => {
    const stats = [
      { ch: "H", ewmaAcc: 0.5, attempts: 30 },
      { ch: "S", ewmaAcc: 0.7, attempts: 25 },
      { ch: "K", ewmaAcc: 0.95, attempts: 100 },
      { ch: "5", ewmaAcc: 0.1, attempts: 5 }, // too few attempts to count as weak
    ];
    expect(weakForPractice(stats, ["K", "M", "R", "S", "U", "5"])).toEqual([
      "H",
      "S",
      "K",
      "5",
      "M",
      "R",
    ]);
    expect(weakForPractice([{ ch: "H", ewmaAcc: 0.5, attempts: 3 }], ["K", "M"])).toEqual([]);
  });
});
