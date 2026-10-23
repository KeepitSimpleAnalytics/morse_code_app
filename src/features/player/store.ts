import { create } from "zustand";
import type { CodeFormat, WordSeparator } from "../../core/code-text";
import { DEFAULT_RISE_MS } from "../../core/envelope";
import { DEFAULT_SPEEDS, type Speeds } from "../../core/speed";

export const PLAYER_MAX_CHARS = 20000;

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type PlayerStatus = "idle" | "playing" | "paused" | "live";

/**
 * Text Player state. Player settings (speed, tone, volume) are separate from the
 * training settings (SPEC §7.8), so playing here never changes lesson speeds.
 * Persisted per profile from phase 3; until then they last for the session.
 */
export interface PlayerState {
  text: string;
  speeds: Speeds;
  toneHz: number;
  volume: number;
  riseMs: number;
  codeFormat: CodeFormat;
  wordSep: WordSeparator;
  loop: boolean;
  hideText: boolean;
  liveMode: boolean;

  status: PlayerStatus;
  /** Source range of the character being heard. */
  active: SourceRange | null;
  /** Where Play starts: a source offset chosen by clicking text or code. */
  startOffset: number | null;
  /** Live mode: characters typed but not yet sent. */
  liveQueued: number;
  /** The last error, shown to the user (never swallowed). */
  error: string | null;
  notice: string | null;

  set: (patch: Partial<Omit<PlayerState, "set">>) => void;
}

export const usePlayerStore = create<PlayerState>()((set) => ({
  text: "CQ CQ DE W1AW W1AW <AR>\nThe quick brown fox jumps over the lazy dog 73",
  speeds: DEFAULT_SPEEDS,
  toneHz: 600,
  volume: 0.7,
  riseMs: DEFAULT_RISE_MS,
  codeFormat: "ascii",
  wordSep: "slash",
  loop: false,
  hideText: false,
  liveMode: false,

  status: "idle",
  active: null,
  startOffset: null,
  liveQueued: 0,
  error: null,
  notice: null,

  set: (patch) => {
    set(patch);
  },
}));
