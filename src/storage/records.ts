import { scoreRevealed, scoreTrial } from "../core/scoring";
import type { Mode } from "./schemas";
import type { TrialRecord } from "./store";

export interface TrialInput {
  id: string;
  profileId: string;
  sessionId: string;
  mode: Mode;
  idx: number;
  prompt: string;
  response: string;
  /** Reveal scores every character as missed (SPEC §4 defect 4). */
  revealed: boolean;
  repeats: number;
  responseMs: number | null;
  charWpm: number;
  at: number;
}

/** Scores a trial and builds the trial row plus one char event per sent character. */
export function buildTrialRecord(input: TrialInput): TrialRecord {
  const score = input.revealed
    ? scoreRevealed(input.prompt)
    : scoreTrial(input.prompt, input.response);
  return {
    trial: {
      id: input.id,
      sessionId: input.sessionId,
      idx: input.idx,
      prompt: input.prompt,
      response: input.response,
      revealed: input.revealed,
      repeats: input.repeats,
      responseMs: input.responseMs,
      accuracy: score.accuracy,
      alignment: score.ops,
      createdAt: input.at,
    },
    events: score.chars.map((c) => ({
      profileId: input.profileId,
      sessionId: input.sessionId,
      ts: input.at,
      ch: c.ch,
      outcome: c.outcome,
      typed: c.typed ?? null,
      responseMs: input.responseMs,
      charWpm: input.charWpm,
      mode: input.mode,
    })),
    errors: score.errors,
  };
}
