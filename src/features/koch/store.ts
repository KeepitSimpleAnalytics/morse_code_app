import { create } from "zustand";
import type { KochOrderId } from "../../core/koch";
import type { CharSummary, LessonOutcome } from "../../core/lesson";
import type { TrialScore } from "../../core/scoring";
import type { CharStatRow } from "../../storage/schemas";

/**
 * Koch Lessons state (SPEC §7.1). The flow is
 * idle → (intro) → starting → playing ⇄ paused → finishing → scoring → results,
 * driven by controller.ts.
 */

export type KochPhase =
  | "loading"
  | "idle"
  | "intro"
  /** Planning, opening the session and starting audio. */
  | "starting"
  | "playing"
  | "paused"
  /** Starting audio again after a pause. */
  | "resuming"
  /** The last group has played; the user finishes typing, then scores. */
  | "finishing"
  | "scoring"
  /** A stopped lesson whose saving failed; it can be retried. */
  | "unsaved"
  | "results";

export interface LevelInfo {
  readonly orderId: KochOrderId;
  readonly level: number;
  readonly maxLevel: number;
  /** The learned characters, in order. The last is the newest. */
  readonly chars: readonly string[];
  readonly stats: Readonly<Record<string, CharStatRow>>;
  /** Completed lessons at this level and order with at least a minute of audio. */
  readonly lessons: number;
  readonly bestAccuracy: number | null;
}

export type Decision = "advanced" | "stayed" | "steppedBack" | null;

export interface LessonResult {
  /** The order and level the lesson was taken at (settings may have changed since). */
  readonly orderId: KochOrderId;
  readonly level: number;
  readonly prompt: string;
  readonly response: string;
  readonly score: TrialScore;
  readonly audioMs: number;
  readonly cpm: number;
  readonly weak: readonly CharSummary[];
  readonly outcome: LessonOutcome;
  readonly completed: boolean;
  /** Advanced automatically because advancement is set to auto. */
  readonly autoAdvanced: boolean;
  readonly suggestStepBack: boolean;
  readonly decision: Decision;
}

export interface IntroState {
  /** Characters to introduce: K and M at level 1, otherwise the newest one. */
  readonly chars: readonly string[];
  /** Which one is playing or was last played. */
  readonly index: number;
  readonly playing: boolean;
}

export interface KochState {
  phase: KochPhase;
  info: LevelInfo | null;
  intro: IntroState | null;
  typed: string;
  remainingMs: number;
  /** Token being heard (for the live code display), or during a replay. */
  heardToken: number | null;
  /** Why the lesson is paused. */
  pausedBy: "user" | "hidden" | "left" | null;
  result: LessonResult | null;
  /** Token being heard during "Replay with text shown", or null. */
  replayToken: number | null;
  replaying: boolean;
  /** The last error, shown to the user (never swallowed). */
  error: string | null;
  notice: string | null;

  set: (patch: Partial<Omit<KochState, "set">>) => void;
}

export const initialKochState = {
  phase: "loading",
  info: null,
  intro: null,
  typed: "",
  remainingMs: 0,
  heardToken: null,
  pausedBy: null,
  result: null,
  replayToken: null,
  replaying: false,
  error: null,
  notice: null,
} satisfies Omit<KochState, "set">;

export const useKochStore = create<KochState>()((set) => ({
  ...initialKochState,
  set: (patch) => {
    set(patch);
  },
}));
