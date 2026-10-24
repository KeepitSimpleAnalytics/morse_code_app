import { generateKochGroups } from "./generators/koch";
import type { GroupLength } from "./generators/groups";
import { maxKochLevel, newestKochChar, type KochOrder } from "./koch";
import { mulberry32 } from "./rng";
import type { CharResult } from "./scoring";
import { buildTimeline, timelineEnd, type TimelineElement } from "./timeline";
import type { Timing } from "./timing";
import { tokenize, type Token } from "./tokenize";

/**
 * Koch lessons (SPEC §7.1): planning a timed lesson, deciding whether it passes,
 * and when to suggest stepping back a level.
 */

export type LessonLength =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "groups"; readonly count: number };

export const LESSON_MINUTES_MIN = 1;
export const LESSON_MINUTES_MAX = 10;
export const LESSON_GROUPS_MIN = 5;
export const LESSON_GROUPS_MAX = 100;
/** A lesson must have at least this much audio to count towards passing. */
export const MIN_PASSING_AUDIO_MS = 60_000;
/** Lessons below the floor in a row before stepping back is suggested. */
export const REGRESSION_RUN = 3;
/** Silence before the first group, so there is time to get ready. */
export const LESSON_LEAD_IN_MS = 1500;

export const KOCH_GROUP_LENGTHS = {
  fixed: { kind: "fixed", length: 5 },
  random: { kind: "random", min: 2, max: 7 },
} as const satisfies Record<string, GroupLength>;
export type KochGroupSize = keyof typeof KOCH_GROUP_LENGTHS;

export interface LessonPlanInput {
  readonly seed: number;
  readonly order: KochOrder;
  readonly level: number;
  readonly length: LessonLength;
  readonly groupSize: KochGroupSize;
  readonly timing: Timing;
  readonly weights?: ReadonlyMap<string, number>;
  readonly newestWeight?: number;
}

export interface LessonPlan {
  readonly groups: readonly string[];
  /** The groups joined by spaces: the text that is sent. */
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly elements: readonly TimelineElement[];
  /** Index of the token that ends each group (its last character). */
  readonly groupEndTokens: readonly number[];
  /** Audio from the first key-down to the last key-up, ms (the lead-in is not counted). */
  readonly audioMs: number;
}

function checkLength(length: LessonLength): void {
  if (length.kind === "minutes") {
    const m = length.minutes;
    if (!Number.isInteger(m) || m < LESSON_MINUTES_MIN || m > LESSON_MINUTES_MAX) {
      throw new RangeError(`lesson minutes must be an integer within 1–10, got ${m}`);
    }
  } else {
    const c = length.count;
    if (!Number.isInteger(c) || c < LESSON_GROUPS_MIN || c > LESSON_GROUPS_MAX) {
      throw new RangeError(`lesson groups must be an integer within 5–100, got ${c}`);
    }
  }
}

function layout(groups: readonly string[], timing: Timing) {
  const text = groups.join(" ");
  const { tokens } = tokenize(text);
  const elements = buildTimeline(tokens, timing, { leadIn: LESSON_LEAD_IN_MS });
  const groupEndTokens: number[] = [];
  tokens.forEach((t, i) => {
    if (t.type === "char" && tokens[i + 1]?.type !== "char") groupEndTokens.push(i);
  });
  return { text, tokens, elements, groupEndTokens };
}

/**
 * Plans a lesson. A timed lesson has the fewest groups whose audio reaches the
 * duration. The same seed and inputs always give the same lesson.
 */
export function planLesson(input: LessonPlanInput): LessonPlan {
  checkLength(input.length);
  const generate = (count: number) =>
    generateKochGroups({
      rng: mulberry32(input.seed),
      order: input.order,
      level: input.level,
      count,
      length: KOCH_GROUP_LENGTHS[input.groupSize],
      ...(input.weights ? { weights: input.weights } : {}),
      ...(input.newestWeight === undefined ? {} : { newestWeight: input.newestWeight }),
    });

  if (input.length.kind === "groups") {
    const groups = generate(input.length.count);
    const l = layout(groups, input.timing);
    return { groups, ...l, audioMs: timelineEnd(l.elements) - LESSON_LEAD_IN_MS };
  }

  const targetMs = input.length.minutes * 60_000;
  // Generate more groups than needed (doubling if short), then keep the prefix
  // that fills the time. Regenerating from the seed keeps the result deterministic.
  for (let count = 16; ; count *= 2) {
    const groups = generate(count);
    const l = layout(groups, input.timing);
    const endOf = (g: number): number => {
      const tokenIndex = l.groupEndTokens[g] as number;
      let end = 0;
      for (const e of l.elements) if (e.on && e.tokenIndex === tokenIndex) end = e.start + e.dur;
      return end - LESSON_LEAD_IN_MS;
    };
    if (endOf(groups.length - 1) < targetMs) continue;
    let lo = 0;
    let hi = groups.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (endOf(mid) >= targetMs) hi = mid;
      else lo = mid + 1;
    }
    const kept = groups.slice(0, lo + 1);
    const k = layout(kept, input.timing);
    return { groups: kept, ...k, audioMs: timelineEnd(k.elements) - LESSON_LEAD_IN_MS };
  }
}

/**
 * The text that was actually sent when a lesson is stopped early: every group
 * up to and including the one that was sounding. Empty if nothing was heard.
 */
export function playedGroups(plan: LessonPlan, lastHeardToken: number | null): string[] {
  if (lastHeardToken === null) return [];
  const idx = plan.groupEndTokens.findIndex((end) => end >= lastHeardToken);
  return plan.groups.slice(0, idx === -1 ? plan.groups.length : idx + 1);
}

/** Audio time of a lesson's first `groupCount` groups (the lead-in is not counted). */
export function audioMsOfGroups(plan: LessonPlan, groupCount: number): number {
  if (groupCount <= 0) return 0;
  const endToken = plan.groupEndTokens[Math.min(groupCount, plan.groups.length) - 1] as number;
  let end = 0;
  for (const e of plan.elements) if (e.on && e.tokenIndex === endToken) end = e.start + e.dur;
  return end - LESSON_LEAD_IN_MS;
}

/** Group index that contains a token (for resuming after a pause). */
export function groupOfToken(plan: LessonPlan, tokenIndex: number): number {
  const idx = plan.groupEndTokens.findIndex((end) => end >= tokenIndex);
  return idx === -1 ? plan.groups.length - 1 : idx;
}

/* Passing and stepping back ---------------------------------------------- */

export interface LessonOutcomeInput {
  readonly accuracy: number;
  readonly audioMs: number;
  /** False when the lesson was stopped early. */
  readonly completed: boolean;
  readonly threshold: number;
  readonly order: KochOrder;
  readonly level: number;
}

export type NotCountedReason = "stopped" | "short";

export interface LessonOutcome {
  readonly passed: boolean;
  /** Why the lesson can't pass regardless of accuracy, if it can't. */
  readonly notCounted: NotCountedReason | null;
  /** The character the next level adds, or null at the last level. */
  readonly nextChar: string | null;
}

export function lessonOutcome(input: LessonOutcomeInput): LessonOutcome {
  const notCounted: NotCountedReason | null = !input.completed
    ? "stopped"
    : input.audioMs < MIN_PASSING_AUDIO_MS
      ? "short"
      : null;
  const atTop = input.level >= maxKochLevel(input.order);
  return {
    passed: notCounted === null && input.accuracy >= input.threshold,
    notCounted,
    nextChar: atTop ? null : newestKochChar(input.order, input.level + 1),
  };
}

/**
 * Suggests stepping back when the last REGRESSION_RUN completed lessons at this
 * level are all below the floor. `accuracies` is newest first. Never at level 1.
 */
export function suggestStepBack(
  accuracies: readonly number[],
  floor: number,
  level: number,
): boolean {
  if (level <= 1 || accuracies.length < REGRESSION_RUN) return false;
  return accuracies.slice(0, REGRESSION_RUN).every((a) => a < floor);
}

/* Lesson summary ---------------------------------------------------------- */

export interface CharSummary {
  readonly ch: string;
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number;
}

/** Characters with at least one error this lesson, weakest first (ties: most attempts). */
export function weakestChars(chars: readonly CharResult[], limit = 5): CharSummary[] {
  const by = new Map<string, { attempts: number; correct: number }>();
  for (const c of chars) {
    const s = by.get(c.ch) ?? { attempts: 0, correct: 0 };
    s.attempts++;
    if (c.outcome === "correct") s.correct++;
    by.set(c.ch, s);
  }
  return [...by.entries()]
    .map(([ch, s]) => ({ ch, ...s, accuracy: s.correct / s.attempts }))
    .filter((s) => s.correct < s.attempts)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || (a.ch < b.ch ? -1 : 1))
    .slice(0, limit);
}
