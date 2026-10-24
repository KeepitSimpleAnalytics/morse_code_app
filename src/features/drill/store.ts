import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { ScoreTotals } from "../../core/drill";
import type { CharSummary } from "../../core/lesson";
import type { TrialScore } from "../../core/scoring";
import type { Timing } from "../../core/timing";
import type { Weighting } from "../../state/settings-schema";

/**
 * State for the per-item copy modes (SPEC §7.3–7.7). Each mode has its own store,
 * so leaving one screen and coming back finds it as it was. The flow is
 * idle → starting → playing → answering → saving → feedback → (next item) … →
 * closing → results, driven by controller.ts.
 */

export const DRILL_MODES = ["groups", "words", "callsigns", "custom"] as const;
export type DrillMode = (typeof DRILL_MODES)[number];

/** Random Groups' "Practice these characters": used instead of the saved set. */
export interface PractiseOverride {
  readonly chars: readonly string[];
  /** Weighting for this practice, or null to follow `groups.weighting`. */
  readonly weighting: Weighting | null;
}

export function isDrillMode(id: string): id is DrillMode {
  return (DRILL_MODES as readonly string[]).includes(id);
}

export type DrillPhase =
  | "idle"
  /** Planning, opening the session and starting audio. */
  | "starting"
  /** The item is sounding; typing is already allowed. */
  | "playing"
  /** The item has played; waiting for the answer. */
  | "answering"
  /** Writing the item's trial. */
  | "saving"
  /** The item is scored and saved; its diff shows until Next. */
  | "feedback"
  | "paused"
  /** Closing the session. */
  | "closing"
  /** Closing the session failed; it can be retried. */
  | "unsaved"
  | "results";

export interface DrillItem {
  readonly text: string;
  /** Shown after the answer (word lists with meanings). */
  readonly meaning?: string;
}

export interface ItemResult {
  readonly item: DrillItem;
  readonly response: string;
  readonly revealed: boolean;
  readonly repeats: number;
  readonly score: TrialScore;
  /** Sounding time of one play of the item, ms. */
  readonly audioMs: number;
}

export interface DrillSummary {
  readonly items: readonly ItemResult[];
  /** Items the session was planned with. */
  readonly planned: number;
  readonly completed: boolean;
  readonly totals: ScoreTotals;
  readonly cpm: number;
  readonly weak: readonly CharSummary[];
  /** The session's speed and tone, so a replay sounds like what was sent. */
  readonly timing: Timing;
  readonly toneHz: number;
}

/** What a replay is playing: the item in feedback (index of the current item) or one in the results. */
export interface ReplayState {
  readonly index: number;
  readonly token: number | null;
}

export interface DrillState {
  phase: DrillPhase;
  /** 0-based index of the current item, and how many the session has. */
  index: number;
  total: number;
  item: DrillItem | null;
  typed: string;
  /** Repeats of the current item (each one counted, §7). */
  repeats: number;
  /** Token being heard, for the live code display. */
  heardToken: number | null;
  /** The current item's result, while in feedback. */
  feedback: ItemResult | null;
  pausedBy: "hidden" | "left" | null;
  summary: DrillSummary | null;
  replay: ReplayState | null;
  /**
   * Random Groups only: characters from "Practice these characters". Used
   * instead of the saved character set until cleared; never saved.
   */
  override: PractiseOverride | null;
  error: string | null;
  notice: string | null;

  set: (patch: Partial<Omit<DrillState, "set">>) => void;
}

export const initialDrillState = {
  phase: "idle",
  index: 0,
  total: 0,
  item: null,
  typed: "",
  repeats: 0,
  heardToken: null,
  feedback: null,
  pausedBy: null,
  summary: null,
  replay: null,
  override: null,
  error: null,
  notice: null,
} satisfies Omit<DrillState, "set">;

function createDrillStore(): UseBoundStore<StoreApi<DrillState>> {
  return create<DrillState>()((set) => ({
    ...initialDrillState,
    set: (patch) => {
      set(patch);
    },
  }));
}

export const drillStores: Record<DrillMode, UseBoundStore<StoreApi<DrillState>>> = {
  groups: createDrillStore(),
  words: createDrillStore(),
  callsigns: createDrillStore(),
  custom: createDrillStore(),
};
