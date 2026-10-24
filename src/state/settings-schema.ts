import { z } from "zod";
import { SCREENS, type ScreenId } from "../app/screens";
import type { CodeFormat, WordSeparator } from "../core/code-text";
import { WORD_LIST_IDS, type WordListId } from "../core/bundled";
import { WORDS_PER_ITEM_MAX, WORDS_PER_ITEM_MIN } from "../core/chunk";
import { DRILL_ITEMS_DEFAULT, DRILL_ITEMS_MAX, DRILL_ITEMS_MIN } from "../core/drill";
import { DEFAULT_RISE_MS, RISE_MS_MAX, RISE_MS_MIN } from "../core/envelope";
import { CALLSIGN_FORMATS, type CallsignFormat } from "../core/generators/callsigns";
import { GROUP_LENGTH_MAX, GROUP_LENGTH_MIN } from "../core/generators/groups";
import {
  ICR_COUNT_DEFAULT,
  ICR_COUNT_MAX,
  ICR_COUNT_MIN,
  ICR_MINUTES_MAX,
  ICR_MINUTES_MIN,
  ICR_TIMEOUT_DEFAULT_MS,
  ICR_TIMEOUT_MAX_MS,
  ICR_TIMEOUT_MIN_MS,
} from "../core/icr";
import { DEFAULT_KOCH_ORDER, KOCH_ORDERS, type KochOrderId } from "../core/koch";
import {
  KOCH_GROUP_LENGTHS,
  LESSON_GROUPS_MAX,
  LESSON_GROUPS_MIN,
  LESSON_MINUTES_MAX,
  LESSON_MINUTES_MIN,
  type KochGroupSize,
} from "../core/lesson";
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
/** Screens removed with phases 8 and 9 (SPEC §15.1). A saved one opens Koch instead. */
const REMOVED_SCREENS: readonly unknown[] = ["qso", "sending"];
const screen = z.preprocess(
  (raw) => (REMOVED_SCREENS.includes(raw) ? "koch" : raw),
  z.enum(SCREEN_IDS),
);

export const SHOW_CODE = ["never", "after", "live"] as const;
export type ShowCode = (typeof SHOW_CODE)[number];
export const ADVANCEMENT = ["prompt", "auto"] as const;
export type Advancement = (typeof ADVANCEMENT)[number];
export const LESSON_LENGTH_KINDS = ["minutes", "groups"] as const;
export type LessonLengthKind = (typeof LESSON_LENGTH_KINDS)[number];
const GROUP_SIZES = Object.keys(KOCH_GROUP_LENGTHS) as [KochGroupSize, ...KochGroupSize[]];

/** Random Groups draws from character classes, a custom string, or the learned Koch characters. */
export const GROUP_SOURCES = ["classes", "custom", "koch"] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];
export const WEIGHTINGS = ["adaptive", "uniform"] as const;
export type Weighting = (typeof WEIGHTINGS)[number];
export const CHUNK_KINDS = ["line", "words"] as const;
export type ChunkKind = (typeof CHUNK_KINDS)[number];
export const CUSTOM_CHARSET_MAX = 200;
/** Custom Practice text; the same limit as the Text Player. */
export const CUSTOM_TEXT_MAX = PLAYER_MAX_CHARS;
const items = int(DRILL_ITEMS_MIN, DRILL_ITEMS_MAX);
/** ICR draws from the learned Koch characters, every single-key character, or a custom set. */
export const ICR_CHARSETS = ["koch", "all", "custom"] as const;
export type IcrCharset = (typeof ICR_CHARSETS)[number];
export const ICR_ROUND_KINDS = ["count", "minutes"] as const;
export type IcrRoundKind = (typeof ICR_ROUND_KINDS)[number];

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
  /** Unused since goals were dropped (SPEC §15.1); kept so saved values stay valid. */
  "learning.dailyGoalMin": { schema: int(5, 60), default: 10 },

  /* Koch lessons (§7.1) */
  "koch.lengthKind": {
    schema: z.enum(LESSON_LENGTH_KINDS),
    default: "minutes" as LessonLengthKind,
  },
  "koch.minutes": { schema: int(LESSON_MINUTES_MIN, LESSON_MINUTES_MAX), default: 2 },
  "koch.groups": { schema: int(LESSON_GROUPS_MIN, LESSON_GROUPS_MAX), default: 20 },
  "koch.groupSize": { schema: z.enum(GROUP_SIZES), default: "fixed" as KochGroupSize },
  /** Per Koch order, the highest level whose new-character intro has been shown. */
  "koch.introSeen": {
    schema: z.record(z.string(), z.number().int().nonnegative()),
    default: {} as Record<string, number>,
  },

  /* Random Groups (§7.3) */
  "groups.source": { schema: z.enum(GROUP_SOURCES), default: "classes" as GroupSource },
  "groups.letters": { schema: z.boolean(), default: true },
  "groups.digits": { schema: z.boolean(), default: false },
  "groups.punct": { schema: z.boolean(), default: false },
  "groups.prosigns": { schema: z.boolean(), default: false },
  "groups.custom": { schema: z.string().max(CUSTOM_CHARSET_MAX), default: "" },
  "groups.length": { schema: int(GROUP_LENGTH_MIN, GROUP_LENGTH_MAX), default: 5 },
  "groups.weighting": { schema: z.enum(WEIGHTINGS), default: "adaptive" as Weighting },
  "groups.items": { schema: items, default: DRILL_ITEMS_DEFAULT },

  /* Words (§7.4) */
  "words.list": { schema: z.enum(WORD_LIST_IDS), default: "v1-common" as WordListId },
  "words.learnedOnly": { schema: z.boolean(), default: false },
  "words.items": { schema: items, default: DRILL_ITEMS_DEFAULT },

  /* Callsigns (§7.5) */
  "callsigns.formats": {
    schema: z
      .array(z.enum(CALLSIGN_FORMATS))
      .min(1)
      .refine((a) => new Set(a).size === a.length, "formats repeat"),
    default: [...CALLSIGN_FORMATS] as CallsignFormat[],
  },
  "callsigns.usOnly": { schema: z.boolean(), default: false },
  "callsigns.items": { schema: items, default: DRILL_ITEMS_DEFAULT },

  /* Custom Practice (§7.7) */
  "custom.text": { schema: z.string().max(CUSTOM_TEXT_MAX), default: "" },
  "custom.split": { schema: z.enum(CHUNK_KINDS), default: "line" as ChunkKind },
  "custom.wordsPerItem": { schema: int(WORDS_PER_ITEM_MIN, WORDS_PER_ITEM_MAX), default: 3 },

  /* Instant Character Recognition (§7.2) */
  "icr.charset": { schema: z.enum(ICR_CHARSETS), default: "koch" as IcrCharset },
  "icr.custom": { schema: z.string().max(CUSTOM_CHARSET_MAX), default: "" },
  "icr.timeoutMs": {
    schema: int(ICR_TIMEOUT_MIN_MS, ICR_TIMEOUT_MAX_MS),
    default: ICR_TIMEOUT_DEFAULT_MS,
  },
  "icr.target": { schema: z.boolean(), default: false },
  "icr.roundKind": { schema: z.enum(ICR_ROUND_KINDS), default: "count" as IcrRoundKind },
  "icr.count": { schema: int(ICR_COUNT_MIN, ICR_COUNT_MAX), default: ICR_COUNT_DEFAULT },
  "icr.minutes": { schema: int(ICR_MINUTES_MIN, ICR_MINUTES_MAX), default: 2 },
  "icr.tick": { schema: z.boolean(), default: true },

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
  "nav.screen": { schema: screen, default: "koch" as ScreenId },
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
