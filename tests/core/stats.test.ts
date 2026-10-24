import { describe, expect, it } from "vitest";
import {
  accuracySince,
  confusions,
  daysBefore,
  dayStart,
  missedCount,
  practiceMsSince,
  weakForPractice,
} from "../../src/core/stats";

// The UK clock goes back an hour on 2026-10-25, inside a 7-day window. Node
// re-reads TZ when it is assigned, and each test file runs in its own process.
process.env.TZ = "Europe/London";

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

  it("counts days back by the calendar, across a clock change", () => {
    const noon = new Date(2026, 9, 29, 12).getTime(); // Thursday, after the change
    const start = daysBefore(noon, 6);
    // The window really does span an hour change, or this test proves nothing.
    expect(new Date(start).getTimezoneOffset()).not.toBe(new Date(noon).getTimezoneOffset());
    expect(start).toBe(new Date(2026, 9, 23).getTime());
    expect(new Date(start).getHours()).toBe(0);
    // 24-hour steps land an hour late (01:00) and drop that day's first hour.
    expect(new Date(dayStart(noon) - 6 * 86_400_000).getHours()).toBe(1);
    expect(daysBefore(noon, 0)).toBe(dayStart(noon));
  });

  it("puts a session just after midnight 6 days ago inside the 7-day window", () => {
    const now = new Date(2026, 9, 29, 12).getTime();
    const since = daysBefore(now, 6);
    const list = [
      s(new Date(2026, 9, 23, 0, 0, 30).getTime(), 1000, 10, 0), // in
      s(new Date(2026, 9, 22, 23, 59, 30).getTime(), 1000, 10, 10), // out
    ];
    expect(accuracySince(list, since)).toBe(1);
    expect(practiceMsSince(list, since)).toBe(1000);
  });

  it("sums practice time and weighs accuracy by characters sent", () => {
    const list = [s(100, 60_000, 100, 10), s(200, 30_000, 10, 10), s(50, 99_000, 50, 0)];
    expect(practiceMsSince(list, 100)).toBe(90_000);
    expect(accuracySince(list, 100)).toBeCloseTo(1 - 20 / 110);
    expect(accuracySince(list, 1000)).toBeNull();
  });

  it("lists what a character is heard as, most often first", () => {
    const tallies = [
      { outcome: "correct", typed: null, count: 6 },
      { outcome: "missed", typed: null, count: 1 },
      { outcome: "substituted", typed: "5", count: 1 },
      { outcome: "substituted", typed: "S", count: 2 },
    ] as const;
    expect(confusions(tallies, 10)).toEqual([
      { typed: "S", count: 2, share: 0.2 },
      { typed: "5", count: 1, share: 0.1 },
    ]);
    expect(confusions(tallies, 0)).toEqual([]);
    expect(missedCount(tallies)).toBe(1);
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

  it("takes only the six weakest when more qualify, with no filler", () => {
    const stats = ["A", "B", "C", "D", "E", "F", "G", "H"].map((ch, i) => ({
      ch,
      ewmaAcc: 0.9 - i * 0.1, // H weakest, A strongest
      attempts: 20,
    }));
    expect(weakForPractice(stats, ["K", "M"])).toEqual(["H", "G", "F", "E", "D", "C"]);
  });
});
