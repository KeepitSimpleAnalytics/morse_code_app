import { create } from "zustand";
import type { IcrSummary } from "../../core/icr";

/**
 * Instant Character Recognition state (SPEC §7.2). The flow is
 * idle → starting → listening → feedback → listening … → closing → results,
 * driven by controller.ts.
 */

export type IcrPhase =
  | "idle"
  /** Planning, opening the session and starting audio. */
  | "starting"
  /** A character is playing or has played; one key answers it. */
  | "listening"
  /** The answer is shown (and, if wrong, the character replays) before the next one. */
  | "feedback"
  | "paused"
  /** Leaving a pause or retrying a save; a pause here takes effect at once. */
  | "resuming"
  /** An answer couldn't be saved; it can be retried. */
  | "unsaved"
  | "closing"
  /** Closing the session failed; it can be retried, or the results shown anyway. */
  | "unclosed"
  | "results";

export type PausedBy = "hidden" | "left" | "overlay" | "error";

export interface IcrAnswer {
  readonly ch: string;
  /** The key pressed, or null on a timeout. */
  readonly typed: string | null;
  readonly correct: boolean;
  readonly responseMs: number;
}

export interface IcrResult {
  readonly summary: IcrSummary;
  readonly completed: boolean;
  /** The timeout the round used. */
  readonly timeoutMs: number;
  /** The median Target tightened the timeout from, or null when Target was off or had no data. */
  readonly targetMedianMs: number | null;
  /** Answers whose time was estimated from output latency (see AudioEngine.heardAt). */
  readonly estimated: number;
}

export interface SlowChar {
  readonly ch: string;
  /** The adaptive response-time average, ms. */
  readonly ewmaRt: number;
}

export interface IcrState {
  phase: IcrPhase;
  /** Characters answered so far, and the round's length (null for a timed round). */
  answered: number;
  total: number | null;
  /** Timed rounds: active time left, ms. */
  remainingMs: number | null;
  /** The answer being shown in feedback. */
  answer: IcrAnswer | null;
  /** The timeout in use this round, ms. */
  timeoutMs: number | null;
  /** The median Target used this round, or null. */
  targetMedianMs: number | null;
  pausedBy: PausedBy | null;
  result: IcrResult | null;
  /** The profile's median ICR response time over recent correct answers, for Target. */
  medianMs: number | null;
  /** The profile's slowest characters by adaptive response time. */
  slowest: readonly SlowChar[];
  error: string | null;
  notice: string | null;

  set: (patch: Partial<Omit<IcrState, "set">>) => void;
}

export const initialIcrState = {
  phase: "idle",
  answered: 0,
  total: null,
  remainingMs: null,
  answer: null,
  timeoutMs: null,
  targetMedianMs: null,
  pausedBy: null,
  result: null,
  medianMs: null,
  slowest: [],
  error: null,
  notice: null,
} satisfies Omit<IcrState, "set">;

export const useIcrStore = create<IcrState>()((set) => ({
  ...initialIcrState,
  set: (patch) => {
    set(patch);
  },
}));
