import { z } from "zod";
import { SCREENS, type ScreenId } from "../app/screens";
import type { CodeFormat, WordSeparator } from "../core/code-text";
import { DEFAULT_RISE_MS, RISE_MS_MAX, RISE_MS_MIN } from "../core/envelope";
import { DEFAULT_KOCH_ORDER, KOCH_ORDERS, type KochOrderId } from "../core/koch";
import { DEFAULT_SPEEDS, hydrateSpeeds, type Speeds } from "../core/speed";
import { WORD_SPACING_MAX, WORD_SPACING_MIN } from "../core/timing";
import { PLAYER_MAX_CHARS, PLAYER_SAMPLE_TEXT } from "../features/player/store";

/**
 * Per-profile settings (SPEC §10.2), one database row per key. Each key has a
 * schema and a default. A key that was never saved takes its default. A saved
 * value that fails validation is reported, never quietly repaired (v1 defect #1).
 */

const speeds = z.unknown().transform((raw, ctx): Speeds => {
  try {
    return hydrateSpeeds(raw);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const num = (min: number, max: number) => z.number().min(min).max(max);

const CODE_FORMATS = ["ascii", "dots", "phonetic"] as const satisfies readonly CodeFormat[];
const WORD_SEPS = ["slash", "space"] as const satisfies readonly WordSeparator[];
const ORDER_IDS = KOCH_ORDERS.map((o) => o.id) as [KochOrderId, ...KochOrderId[]];
const SCREEN_IDS = SCREENS.map((s) => s.id) as [ScreenId, ...ScreenId[]];

export const SHOW_CODE = ["never", "after", "live"] as const;
export type ShowCode = (typeof SHOW_CODE)[number];
export const ADVANCEMENT = ["prompt", "auto"] as const;
export type Advancement = (typeof ADVANCEMENT)[number];

export const SETTINGS = {
  /* Timing (training) */
  "timing.speeds": { schema: speeds, default: DEFAULT_SPEEDS },
  "timing.wordSpacing": { schema: num(WORD_SPACING_MIN, WORD_SPACING_MAX), default: 1 },

  /* Audio (training) */
  "audio.toneHz": { schema: int(300, 1200), default: 600 },
  "audio.volume": { schema: num(0, 1), default: 0.7 },
  "audio.riseMs": { schema: num(RISE_MS_MIN, RISE_MS_MAX), default: DEFAULT_RISE_MS },

  /* Display */
  "display.showCode": { schema: z.enum(SHOW_CODE), default: "after" as ShowCode },
  "display.codeFormat": { schema: z.enum(CODE_FORMATS), default: "ascii" as CodeFormat },
  "display.fontScale": { schema: num(1, 2), default: 1 },
  "display.reduceMotion": { schema: z.boolean(), default: false },

  /* Learning */
  "learning.kochOrder": { schema: z.enum(ORDER_IDS), default: DEFAULT_KOCH_ORDER },
  "learning.passThreshold": { schema: num(0.8, 0.98), default: 0.9 },
  "learning.regressionFloor": { schema: num(0.5, 0.85), default: 0.7 },
  "learning.advancement": { schema: z.enum(ADVANCEMENT), default: "prompt" as Advancement },
  "learning.adaptive": { schema: z.boolean(), default: true },
  "learning.newestWeight": { schema: num(1, 4), default: 2 },
  "learning.dailyGoalMin": { schema: int(5, 60), default: 10 },

  /* Text Player: its own speed and sound, separate from training (§7.8) */
  "player.text": { schema: z.string().max(PLAYER_MAX_CHARS), default: PLAYER_SAMPLE_TEXT },
  "player.speeds": { schema: speeds, default: DEFAULT_SPEEDS },
  "player.toneHz": { schema: int(300, 1200), default: 600 },
  "player.volume": { schema: num(0, 1), default: 0.7 },
  "player.riseMs": { schema: num(RISE_MS_MIN, RISE_MS_MAX), default: DEFAULT_RISE_MS },
  "player.codeFormat": { schema: z.enum(CODE_FORMATS), default: "ascii" as CodeFormat },
  "player.wordSep": { schema: z.enum(WORD_SEPS), default: "slash" as WordSeparator },
  "player.loop": { schema: z.boolean(), default: false },

  /* The last screen (v1 defect #9) */
  "nav.screen": { schema: z.enum(SCREEN_IDS), default: "koch" as ScreenId },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingsValues = { [K in SettingKey]: z.output<(typeof SETTINGS)[K]["schema"]> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function defaultSettings(): SettingsValues {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as SettingsValues;
}

export interface HydrationResult {
  values: SettingsValues;
  /** Saved values that failed validation; their defaults are in use and shown to the user. */
  invalid: { key: string; message: string }[];
  /** Saved keys this version doesn't know. They are kept in the database untouched. */
  unknown: string[];
}

/** Turns saved rows into settings: exactly as saved where valid (v1 defect #1). */
export function hydrateSettings(saved: Record<string, unknown>): HydrationResult {
  const values = defaultSettings() as Record<SettingKey, unknown>;
  const invalid: HydrationResult["invalid"] = [];
  const unknown: string[] = [];
  for (const [key, raw] of Object.entries(saved)) {
    if (!(key in SETTINGS)) {
      unknown.push(key);
      continue;
    }
    const k = key as SettingKey;
    const result = SETTINGS[k].schema.safeParse(raw);
    if (result.success) values[k] = result.data;
    else invalid.push({ key, message: result.error.issues.map((i) => i.message).join("; ") });
  }
  return { values: values as SettingsValues, invalid, unknown };
}

/** Validates one value before it is set. Throws on invalid input (a programming error). */
export function validateSetting<K extends SettingKey>(key: K, value: unknown): SettingsValues[K] {
  return SETTINGS[key].schema.parse(value) as SettingsValues[K];
}
