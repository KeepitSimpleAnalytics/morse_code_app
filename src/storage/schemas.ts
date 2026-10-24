import { z } from "zod";

/**
 * Domain records as the app sees them (SPEC §9.2), validated with zod when they
 * come back from the database or from an import file. JSON columns are parsed
 * here; the SQL layer stringifies them.
 */

const id = z.string().min(1);
const ms = z.number().int().nonnegative();
const json = z.unknown();

export const ProfileSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  createdAt: ms,
  lastUsedAt: ms,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const SettingSchema = z.object({
  profileId: id,
  key: z.string().min(1),
  value: json,
  updatedAt: ms,
});
export type Setting = z.infer<typeof SettingSchema>;

export const MODES = [
  "koch",
  "icr",
  "groups",
  "words",
  "callsigns",
  "qso",
  "custom",
  "send",
  "player",
] as const;
export type Mode = (typeof MODES)[number];

export const SessionSchema = z.object({
  id,
  profileId: id,
  mode: z.enum(MODES),
  startedAt: ms,
  endedAt: ms.nullable(),
  activeMs: ms,
  seed: z.number().int(),
  settingsSnapshot: z.record(z.string(), json),
  sentChars: ms,
  correctChars: ms,
  errors: ms,
  accuracy: z.number().min(0).max(1).nullable(),
  completed: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

export const TrialSchema = z.object({
  id,
  sessionId: id,
  idx: ms,
  prompt: z.string(),
  response: z.string(),
  revealed: z.boolean(),
  repeats: ms,
  responseMs: ms.nullable(),
  accuracy: z.number().min(0).max(1),
  alignment: json,
  createdAt: ms,
});
export type Trial = z.infer<typeof TrialSchema>;

export const OUTCOMES = ["correct", "substituted", "missed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CharEventSchema = z.object({
  id: z.number().int().positive(),
  profileId: id,
  sessionId: id,
  ts: ms,
  ch: z.string().min(1),
  outcome: z.enum(OUTCOMES),
  typed: z.string().nullable(),
  responseMs: ms.nullable(),
  charWpm: z.number().int().positive(),
  mode: z.enum(MODES),
});
export type CharEvent = z.infer<typeof CharEventSchema>;

/** How often a character came out one way, typed as what (substituted only, else null). */
export const OutcomeCountSchema = CharEventSchema.pick({ outcome: true, typed: true }).extend({
  count: z.number().int().positive(),
});
export type OutcomeCount = z.infer<typeof OutcomeCountSchema>;

export const CharStatSchema = z.object({
  profileId: id,
  ch: z.string().min(1),
  ewmaAcc: z.number(),
  ewmaRt: z.number().nullable(),
  attempts: ms,
  correct: ms,
  lastSeen: ms,
});
export type CharStatRow = z.infer<typeof CharStatSchema>;

export const KochProgressSchema = z.object({
  profileId: id,
  orderId: z.string().min(1),
  level: z.number().int().positive(),
  updatedAt: ms,
});
export type KochProgress = z.infer<typeof KochProgressSchema>;

export const LEVEL_REASONS = ["passed", "manual", "regressed", "imported"] as const;
export type LevelReason = (typeof LEVEL_REASONS)[number];

export const KochLevelHistorySchema = z.object({
  profileId: id,
  orderId: z.string().min(1),
  level: z.number().int().positive(),
  reachedAt: ms,
  reason: z.enum(LEVEL_REASONS),
});
export type KochLevelHistory = z.infer<typeof KochLevelHistorySchema>;

export const SnippetSchema = z.object({
  id,
  profileId: id,
  title: z.string().min(1).max(80),
  body: z.string(),
  createdAt: ms,
  updatedAt: ms,
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const WordListItemSchema = z.object({
  word: z.string().min(1),
  meaning: z.string().optional(),
});

export const WordListSchema = z.object({
  id,
  profileId: id,
  name: z.string().min(1),
  items: z.array(WordListItemSchema),
  createdAt: ms,
  updatedAt: ms,
});
export type WordList = z.infer<typeof WordListSchema>;

export const AchievementSchema = z.object({
  profileId: id,
  achievementId: z.string().min(1),
  earnedAt: ms,
});
export type Achievement = z.infer<typeof AchievementSchema>;

/** Everything belonging to one profile, as exported (SPEC §9.5). */
export const ProfileDataSchema = z.object({
  profile: ProfileSchema,
  settings: z.array(SettingSchema),
  sessions: z.array(SessionSchema),
  trials: z.array(TrialSchema),
  charEvents: z.array(CharEventSchema),
  kochProgress: z.array(KochProgressSchema),
  kochLevelHistory: z.array(KochLevelHistorySchema),
  snippets: z.array(SnippetSchema),
  wordLists: z.array(WordListSchema),
  achievements: z.array(AchievementSchema),
});
export type ProfileData = z.infer<typeof ProfileDataSchema>;

export const EXPORT_FORMAT = "morse-trainer-export";
export const EXPORT_FORMAT_VERSION = 1;

export const ExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  appVersion: z.string(),
  exportedAt: ms,
  profiles: z.array(ProfileDataSchema),
});
export type ExportFile = z.infer<typeof ExportFileSchema>;
