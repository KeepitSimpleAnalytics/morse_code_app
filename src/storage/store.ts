import type {
  Achievement,
  CharEvent,
  CharStatRow,
  KochLevelHistory,
  KochProgress,
  LevelReason,
  Profile,
  ProfileData,
  Session,
  Snippet,
  Trial,
  WordList,
} from "./schemas";

/**
 * The storage contract (SPEC §9.3). SqliteStore is the production implementation;
 * MemoryStore backs tests and `pnpm dev:web`. Both pass the same contract suite
 * (tests/storage/contract.ts).
 */

export type StoreKind = "sqlite" | "memory";

export type NewSession = Omit<
  Session,
  "endedAt" | "activeMs" | "sentChars" | "correctChars" | "errors" | "accuracy" | "completed"
>;

export interface SessionEnd {
  endedAt: number;
  activeMs: number;
  completed: boolean;
}

/** One scored trial and its per-character events, written in one transaction (§9.4). */
export interface TrialRecord {
  trial: Trial;
  /** Character events, without database ids. */
  events: Omit<CharEvent, "id">[];
  /** Errors in this trial, including insertions (§8.2), added to the session totals. */
  errors: number;
}

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  profiles: number;
  sessions: number;
}

export interface Store {
  readonly kind: StoreKind;

  /* App-level preferences (theme), global rather than per profile (§7.12). */
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  /* Profiles, most recently used first. */
  listProfiles(): Promise<Profile[]>;
  createProfile(profile: Profile): Promise<void>;
  updateProfile(
    id: string,
    patch: Partial<Pick<Profile, "name" | "color" | "lastUsedAt">>,
  ): Promise<void>;
  /** Deletes the profile and everything that belongs to it. */
  deleteProfile(id: string): Promise<void>;

  /* Per-profile settings; values are JSON, validated by the settings layer. */
  getSettings(profileId: string): Promise<Record<string, unknown>>;
  /** Writes all entries in one transaction. */
  putSettings(profileId: string, entries: Record<string, unknown>, now: number): Promise<void>;

  /* Sessions and trials. */
  startSession(session: NewSession): Promise<void>;
  endSession(id: string, end: SessionEnd): Promise<void>;
  /** Closes sessions left open by a crash or kill (`completed = 0`). Returns how many. */
  closeAbandonedSessions(profileId: string, now: number): Promise<number>;
  getSession(id: string): Promise<Session | null>;
  /** Newest first. */
  listSessions(profileId: string, limit?: number): Promise<Session[]>;
  /** Inserts the trial and its events, updates the session totals and char_stats. */
  recordTrial(record: TrialRecord): Promise<void>;
  listTrials(sessionId: string): Promise<Trial[]>;
  listCharEvents(profileId: string): Promise<CharEvent[]>;

  /* char_stats: an incremental cache over char_events (§8.3). */
  getCharStats(profileId: string): Promise<CharStatRow[]>;
  /** Recomputes char_stats from char_events. */
  rebuildCharStats(profileId: string): Promise<void>;

  /* Koch progress, per profile and order. */
  getKochProgress(profileId: string): Promise<KochProgress[]>;
  /** Sets the level and appends to the history, in one transaction. */
  setKochLevel(
    profileId: string,
    orderId: string,
    level: number,
    reason: LevelReason,
    now: number,
  ): Promise<void>;
  getKochHistory(profileId: string): Promise<KochLevelHistory[]>;

  /* Snippets (Text Player) and word lists, newest edit first. */
  listSnippets(profileId: string): Promise<Snippet[]>;
  /** Inserts or replaces by id. */
  saveSnippet(snippet: Snippet): Promise<void>;
  deleteSnippet(id: string): Promise<void>;
  listWordLists(profileId: string): Promise<WordList[]>;
  saveWordList(list: WordList): Promise<void>;
  deleteWordList(id: string): Promise<void>;

  listAchievements(profileId: string): Promise<Achievement[]>;
  /** Keeps the first earned date if already earned. */
  grantAchievement(achievement: Achievement): Promise<void>;

  /** Deletes sessions, trials, events, stats, Koch progress and achievements. Keeps settings, snippets and lists. */
  resetProgress(profileId: string): Promise<void>;

  /* Export / import (§9.5). */
  exportProfiles(profileIds: readonly string[]): Promise<ProfileData[]>;
  /**
   * Merge adds records whose ids don't exist yet. Replace wipes every profile first.
   * char_stats is rebuilt for each imported profile.
   */
  importProfiles(data: readonly ProfileData[], mode: ImportMode): Promise<ImportResult>;
}

export class StoreError extends Error {
  override readonly name = "StoreError";
}
