import { z } from "zod";
import { KOCH_ORDERS } from "../core/koch";
import { CHAR_WPM_MAX, CHAR_WPM_MIN, EFF_WPM_MIN, type Speeds } from "../core/speed";
import type { Profile, Session } from "./schemas";
import type { Store } from "./store";

/**
 * v1 progress import (SPEC §9.6). The user pastes the output of
 * `copy(localStorage.morseCodeTrainerProgress)` from the old app.
 */

export const V1_ORDER_ID = "classic-v1";
const V1_MAX_LEVEL = (KOCH_ORDERS.find((o) => o.id === V1_ORDER_ID)?.chars.length ?? 37) - 1;

const count = z.number().int().nonnegative();

const V1Schema = z.object({
  kochLevel: z.number().int().min(1).max(V1_MAX_LEVEL).optional(),
  charSpeed: z.number().int().min(CHAR_WPM_MIN).max(CHAR_WPM_MAX).optional(),
  effectiveSpeed: z.number().int().min(EFF_WPM_MIN).max(CHAR_WPM_MAX).optional(),
  frequency: z.number().int().min(300).max(1200).optional(),
  stats: z.object({ correct: count, incorrect: count }).loose().optional(),
});
export type V1Progress = z.infer<typeof V1Schema>;

export class V1ImportError extends Error {
  override readonly name = "V1ImportError";
}

export function parseV1Progress(text: string): V1Progress {
  let raw: unknown;
  let trimmed = text.trim();
  if (trimmed === "") throw new V1ImportError("Paste the copied text first.");
  // Some consoles wrap the copied value in quotes; accept a JSON string too.
  if (trimmed.startsWith('"')) {
    try {
      const inner: unknown = JSON.parse(trimmed);
      if (typeof inner === "string") trimmed = inner;
    } catch {
      // Not a JSON string; parsed (and reported) below.
    }
  }
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new V1ImportError(
      "That isn't the v1 progress text. Run the console command again and paste exactly what it copies.",
    );
  }
  const result = V1Schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`);
    throw new V1ImportError(`The v1 progress has values v2 can't use:\n${issues.join("\n")}`);
  }
  const v = result.data;
  if (v.kochLevel === undefined && v.charSpeed === undefined && v.stats === undefined) {
    throw new V1ImportError("That text has no v1 progress in it.");
  }
  return v;
}

export interface V1ImportPlan {
  /** Training settings to write (overwriting the current ones). */
  settings: Record<string, unknown>;
  kochLevel: number | null;
  /** One synthetic, already-finished session holding the v1 totals, with no char events. */
  session: Session | null;
  /** Shown to the user before they confirm. */
  lines: string[];
}

export function planV1Import(
  v1: V1Progress,
  profileId: string,
  now: number,
  newId: () => string,
): V1ImportPlan {
  const settings: Record<string, unknown> = {};
  const lines: string[] = [];

  if (v1.kochLevel !== undefined) {
    settings["learning.kochOrder"] = V1_ORDER_ID;
    lines.push(
      `Koch level ${v1.kochLevel} on the Classic (v1) order, which becomes your Koch order`,
    );
  }
  if (v1.charSpeed !== undefined) {
    // v2 derives "linked" from eff ≥ char, so an effective speed above the character
    // speed means the two were linked.
    const eff = Math.min(v1.effectiveSpeed ?? v1.charSpeed, v1.charSpeed);
    const speeds: Speeds = { charWpm: v1.charSpeed, effWpm: eff };
    settings["timing.speeds"] = speeds;
    lines.push(
      eff < v1.charSpeed
        ? `Speed ${v1.charSpeed} WPM characters, ${eff} WPM effective`
        : `Speed ${v1.charSpeed} WPM`,
    );
  }
  if (v1.frequency !== undefined) {
    settings["audio.toneHz"] = v1.frequency;
    lines.push(`Tone ${v1.frequency} Hz`);
  }

  let session: Session | null = null;
  const stats = v1.stats;
  if (stats && stats.correct + stats.incorrect > 0) {
    const total = stats.correct + stats.incorrect;
    session = {
      id: newId(),
      profileId,
      mode: "koch",
      startedAt: now,
      endedAt: now,
      activeMs: 0,
      seed: 0,
      // v1 counted whole answers, not characters, so the totals stay in the snapshot.
      settingsSnapshot: {
        imported: "v1",
        v1Correct: stats.correct,
        v1Incorrect: stats.incorrect,
        ...(v1.kochLevel === undefined ? {} : { level: v1.kochLevel, order: V1_ORDER_ID }),
      },
      sentChars: 0,
      correctChars: 0,
      errors: 0,
      accuracy: stats.correct / total,
      completed: true,
    };
    lines.push(`Lifetime totals: ${stats.correct} correct, ${stats.incorrect} incorrect answers`);
  }

  return { settings, kochLevel: v1.kochLevel ?? null, session, lines };
}

/** Writes a v1 import plan into the profile. Training settings are overwritten. */
export async function applyV1Import(
  store: Store,
  profile: Profile,
  plan: V1ImportPlan,
  now: number,
): Promise<void> {
  if (Object.keys(plan.settings).length > 0)
    await store.putSettings(profile.id, plan.settings, now);
  if (plan.kochLevel !== null) {
    await store.setKochLevel(profile.id, V1_ORDER_ID, plan.kochLevel, "imported", now);
  }
  if (plan.session) {
    await store.importProfiles(
      [
        {
          profile,
          settings: [],
          sessions: [plan.session],
          trials: [],
          charEvents: [],
          kochProgress: [],
          kochLevelHistory: [],
          snippets: [],
          wordLists: [],
          achievements: [],
        },
      ],
      "merge",
    );
  }
}
