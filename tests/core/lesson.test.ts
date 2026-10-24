import { describe, expect, it } from "vitest";
import { kochOrder } from "../../src/core/koch";
import {
  audioMsOfGroups,
  groupOfToken,
  lessonOutcome,
  MIN_PASSING_AUDIO_MS,
  planLesson,
  playedGroups,
  suggestStepBack,
  weakestChars,
  type LessonPlanInput,
} from "../../src/core/lesson";
import { scoreTrial } from "../../src/core/scoring";
import { computeTiming } from "../../src/core/timing";

const lcwo = kochOrder("lcwo");
const base: LessonPlanInput = {
  seed: 42,
  order: lcwo,
  level: 3,
  length: { kind: "minutes", minutes: 2 },
  groupSize: "fixed",
  timing: computeTiming({ charWpm: 20, effWpm: 15 }),
};

describe("planLesson", () => {
  it("fills a timed lesson with the fewest groups that reach the duration", () => {
    const plan = planLesson(base);
    expect(plan.audioMs).toBeGreaterThanOrEqual(120_000);
    expect(audioMsOfGroups(plan, plan.groups.length - 1)).toBeLessThan(120_000);
  });

  it("is deterministic for a seed and differs between seeds", () => {
    expect(planLesson(base).text).toBe(planLesson(base).text);
    expect(planLesson({ ...base, seed: 43 }).text).not.toBe(planLesson(base).text);
  });

  it("draws only learned characters, in 5-character groups by default", () => {
    const plan = planLesson(base);
    for (const g of plan.groups) {
      expect(g).toHaveLength(5);
      expect([...g].every((c) => "KMUR".includes(c))).toBe(true);
    }
  });

  it("random group size stays within 2–7", () => {
    const plan = planLesson({ ...base, groupSize: "random" });
    for (const g of plan.groups) {
      expect(g.length).toBeGreaterThanOrEqual(2);
      expect(g.length).toBeLessThanOrEqual(7);
    }
    expect(new Set(plan.groups.map((g) => g.length)).size).toBeGreaterThan(1);
  });

  it("a group-count lesson has exactly that many groups", () => {
    const plan = planLesson({ ...base, length: { kind: "groups", count: 12 } });
    expect(plan.groups).toHaveLength(12);
    expect(plan.text.split(" ")).toEqual(plan.groups);
    expect(plan.groupEndTokens).toHaveLength(12);
  });

  it("a longer timed lesson needs more groups", () => {
    const short = planLesson({ ...base, length: { kind: "minutes", minutes: 1 } });
    const long = planLesson({ ...base, length: { kind: "minutes", minutes: 10 } });
    expect(long.groups.length).toBeGreaterThan(short.groups.length * 5);
    expect(long.audioMs).toBeGreaterThanOrEqual(600_000);
  });

  it("rejects out-of-range lengths", () => {
    expect(() => planLesson({ ...base, length: { kind: "minutes", minutes: 0 } })).toThrow();
    expect(() => planLesson({ ...base, length: { kind: "minutes", minutes: 11 } })).toThrow();
    expect(() => planLesson({ ...base, length: { kind: "groups", count: 4 } })).toThrow();
  });
});

describe("stopping early and resuming", () => {
  const plan = planLesson({ ...base, length: { kind: "groups", count: 5 } });

  it("nothing heard means nothing sent", () => {
    expect(playedGroups(plan, null)).toEqual([]);
  });

  it("includes the group that was sounding", () => {
    // Tokens: 5 chars, gap, 5 chars... token 7 is the 2nd char of group 2.
    expect(playedGroups(plan, 0)).toEqual(plan.groups.slice(0, 1));
    expect(playedGroups(plan, 7)).toEqual(plan.groups.slice(0, 2));
    expect(playedGroups(plan, plan.tokens.length - 1)).toEqual(plan.groups);
  });

  it("maps a token to its group", () => {
    expect(groupOfToken(plan, 0)).toBe(0);
    expect(groupOfToken(plan, 5)).toBe(1); // the gap after group 1 belongs to the next group
    expect(groupOfToken(plan, 7)).toBe(1);
  });
});

describe("lessonOutcome", () => {
  const ok = {
    accuracy: 0.92,
    audioMs: MIN_PASSING_AUDIO_MS,
    completed: true,
    threshold: 0.9,
    order: lcwo,
    level: 3,
  };

  it("passes at or above the threshold on a lesson of at least a minute", () => {
    expect(lessonOutcome(ok)).toEqual({ passed: true, notCounted: null, nextChar: "E" });
    expect(lessonOutcome({ ...ok, accuracy: 0.9 }).passed).toBe(true);
    expect(lessonOutcome({ ...ok, accuracy: 0.89 }).passed).toBe(false);
  });

  it("a short or stopped lesson never passes", () => {
    expect(lessonOutcome({ ...ok, audioMs: 59_999 })).toMatchObject({
      passed: false,
      notCounted: "short",
    });
    expect(lessonOutcome({ ...ok, completed: false, accuracy: 1 })).toMatchObject({
      passed: false,
      notCounted: "stopped",
    });
  });

  it("has no next character at the last level", () => {
    expect(lessonOutcome({ ...ok, level: lcwo.chars.length - 1 }).nextChar).toBeNull();
  });
});

describe("suggestStepBack", () => {
  it("needs three lessons in a row below the floor", () => {
    expect(suggestStepBack([0.6, 0.65, 0.5], 0.7, 4)).toBe(true);
    expect(suggestStepBack([0.6, 0.75, 0.5], 0.7, 4)).toBe(false);
    expect(suggestStepBack([0.6, 0.6], 0.7, 4)).toBe(false);
  });

  it("only looks at the three most recent", () => {
    expect(suggestStepBack([0.6, 0.6, 0.6, 0.95], 0.7, 4)).toBe(true);
    expect(suggestStepBack([0.95, 0.6, 0.6, 0.6], 0.7, 4)).toBe(false);
  });

  it("never at level 1", () => {
    expect(suggestStepBack([0.1, 0.1, 0.1], 0.7, 1)).toBe(false);
  });
});

describe("weakestChars", () => {
  it("lists characters with errors, weakest first", () => {
    const { chars } = scoreTrial("KMKMR RRRUU", "KMKSR RRXU");
    const weak = weakestChars(chars);
    expect(weak.map((w) => w.ch)).toEqual(["M", "U", "R"]);
    expect(weak[0]).toEqual({ ch: "M", attempts: 2, correct: 1, accuracy: 0.5 });
    expect(weak[2]).toEqual({ ch: "R", attempts: 4, correct: 3, accuracy: 0.75 });
  });

  it("is empty for a perfect lesson", () => {
    expect(weakestChars(scoreTrial("KMKM", "KMKM").chars)).toEqual([]);
  });
});

describe("whole-lesson scoring", () => {
  it("one dropped group doesn't cascade into later groups", () => {
    const plan = planLesson({ ...base, length: { kind: "groups", count: 6 } });
    const typed = plan.groups.filter((_, i) => i !== 2).join(" ");
    const score = scoreTrial(plan.text, typed);
    expect(score.misses).toBe(5);
    expect(score.substitutions).toBe(0);
    expect(score.insertions).toBe(0);
  });
});
