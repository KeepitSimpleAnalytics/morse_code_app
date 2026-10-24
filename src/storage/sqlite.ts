import { ALPHA_ACC, ALPHA_RT, rebuildCharStats, updateCharStat } from "../core/adaptive";
import {
  AchievementSchema,
  CharEventSchema,
  CharStatSchema,
  KochLevelHistorySchema,
  KochProgressSchema,
  ProfileSchema,
  SessionSchema,
  SnippetSchema,
  TrialSchema,
  WordListSchema,
  type Achievement,
  type CharEvent,
  type CharStatRow,
  type KochLevelHistory,
  type KochProgress,
  type LevelReason,
  type Profile,
  type ProfileData,
  type Session,
  type Snippet,
  type Trial,
  type WordList,
} from "./schemas";
import { insertMany, type SqlDriver, type SqlValue, type Statement } from "./sql-driver";
import type {
  CharEventQuery,
  ImportMode,
  ImportResult,
  NewSession,
  SessionEnd,
  Store,
  TrialRecord,
} from "./store";
import { StoreError } from "./store";
import type { z } from "zod";

type Row = Record<string, unknown>;

function parseJson(text: unknown, what: string): unknown {
  if (typeof text !== "string") throw new StoreError(`${what}: expected JSON text`);
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new StoreError(`${what}: invalid JSON (${(err as Error).message})`);
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new StoreError(
      `${what}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}

const bool = (v: unknown) => v === 1 || v === true;
const b = (v: boolean) => (v ? 1 : 0);

const profileFrom = (r: Row): Profile =>
  parse(
    ProfileSchema,
    { id: r.id, name: r.name, color: r.color, createdAt: r.created_at, lastUsedAt: r.last_used_at },
    "profile",
  );

const sessionFrom = (r: Row): Session =>
  parse(
    SessionSchema,
    {
      id: r.id,
      profileId: r.profile_id,
      mode: r.mode,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      activeMs: r.active_ms,
      seed: r.seed,
      settingsSnapshot: parseJson(r.settings_snapshot, "session settings"),
      sentChars: r.sent_chars,
      correctChars: r.correct_chars,
      errors: r.errors,
      accuracy: r.accuracy,
      completed: bool(r.completed),
    },
    "session",
  );

const trialFrom = (r: Row): Trial =>
  parse(
    TrialSchema,
    {
      id: r.id,
      sessionId: r.session_id,
      idx: r.idx,
      prompt: r.prompt,
      response: r.response,
      revealed: bool(r.revealed),
      repeats: r.repeats,
      responseMs: r.response_ms,
      accuracy: r.accuracy,
      alignment: parseJson(r.alignment, "trial alignment"),
      createdAt: r.created_at,
    },
    "trial",
  );

const eventFrom = (r: Row): CharEvent =>
  parse(
    CharEventSchema,
    {
      id: r.id,
      profileId: r.profile_id,
      sessionId: r.session_id,
      ts: r.ts,
      ch: r.ch,
      outcome: r.outcome,
      typed: r.typed,
      responseMs: r.response_ms,
      charWpm: r.char_wpm,
      mode: r.mode,
    },
    "char event",
  );

const statFrom = (r: Row): CharStatRow =>
  parse(
    CharStatSchema,
    {
      profileId: r.profile_id,
      ch: r.ch,
      ewmaAcc: r.ewma_acc,
      ewmaRt: r.ewma_rt,
      attempts: r.attempts,
      correct: r.correct,
      lastSeen: r.last_seen,
    },
    "char stat",
  );

const kochFrom = (r: Row): KochProgress =>
  parse(
    KochProgressSchema,
    { profileId: r.profile_id, orderId: r.order_id, level: r.level, updatedAt: r.updated_at },
    "Koch progress",
  );

const historyFrom = (r: Row): KochLevelHistory =>
  parse(
    KochLevelHistorySchema,
    {
      profileId: r.profile_id,
      orderId: r.order_id,
      level: r.level,
      reachedAt: r.reached_at,
      reason: r.reason,
    },
    "Koch history",
  );

const snippetFrom = (r: Row): Snippet =>
  parse(
    SnippetSchema,
    {
      id: r.id,
      profileId: r.profile_id,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
    "snippet",
  );

const wordListFrom = (r: Row): WordList =>
  parse(
    WordListSchema,
    {
      id: r.id,
      profileId: r.profile_id,
      name: r.name,
      items: parseJson(r.items, "word list items"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
    "word list",
  );

const achievementFrom = (r: Row): Achievement =>
  parse(
    AchievementSchema,
    { profileId: r.profile_id, achievementId: r.achievement_id, earnedAt: r.earned_at },
    "achievement",
  );

/* Column lists and row encoders, shared by single inserts and bulk import. */

const SESSION_COLS = [
  "id",
  "profile_id",
  "mode",
  "started_at",
  "ended_at",
  "active_ms",
  "seed",
  "settings_snapshot",
  "sent_chars",
  "correct_chars",
  "errors",
  "accuracy",
  "completed",
] as const;
const sessionRow = (s: Session): SqlValue[] => [
  s.id,
  s.profileId,
  s.mode,
  s.startedAt,
  s.endedAt,
  s.activeMs,
  s.seed,
  JSON.stringify(s.settingsSnapshot),
  s.sentChars,
  s.correctChars,
  s.errors,
  s.accuracy,
  b(s.completed),
];

const TRIAL_COLS = [
  "id",
  "session_id",
  "idx",
  "prompt",
  "response",
  "revealed",
  "repeats",
  "response_ms",
  "accuracy",
  "alignment",
  "created_at",
] as const;
const trialRow = (t: Trial): SqlValue[] => [
  t.id,
  t.sessionId,
  t.idx,
  t.prompt,
  t.response,
  b(t.revealed),
  t.repeats,
  t.responseMs,
  t.accuracy,
  JSON.stringify(t.alignment ?? null),
  t.createdAt,
];

const EVENT_COLS = [
  "profile_id",
  "session_id",
  "ts",
  "ch",
  "outcome",
  "typed",
  "response_ms",
  "char_wpm",
  "mode",
] as const;
const eventRow = (e: Omit<CharEvent, "id">): SqlValue[] => [
  e.profileId,
  e.sessionId,
  e.ts,
  e.ch,
  e.outcome,
  e.typed,
  e.responseMs,
  e.charWpm,
  e.mode,
];

const STAT_COLS = [
  "profile_id",
  "ch",
  "ewma_acc",
  "ewma_rt",
  "attempts",
  "correct",
  "last_seen",
] as const;

/**
 * Incremental char_stats update for one event, in SQL so it can run inside the
 * trial's write batch. The arithmetic mirrors core/adaptive.ts updateCharStat
 * operation for operation, so a rebuild reproduces it exactly.
 */
function statUpsert(e: Omit<CharEvent, "id">): Statement {
  const hit = e.outcome === "correct" ? 1 : 0;
  const first = updateCharStat(undefined, {
    ch: e.ch,
    correct: hit === 1,
    responseMs: e.responseMs,
    ts: e.ts,
  });
  return {
    sql: `INSERT INTO char_stats (${STAT_COLS.join(", ")}) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (profile_id, ch) DO UPDATE SET
        ewma_acc = ewma_acc + ? * (? - ewma_acc),
        ewma_rt = CASE WHEN ? IS NULL THEN ewma_rt WHEN ewma_rt IS NULL THEN ? ELSE ewma_rt + ? * (? - ewma_rt) END,
        attempts = attempts + 1,
        correct = correct + ?,
        last_seen = MAX(last_seen, ?)`,
    params: [
      e.profileId,
      e.ch,
      first.ewmaAcc,
      first.ewmaRt,
      hit,
      e.ts,
      ALPHA_ACC,
      hit,
      e.responseMs,
      e.responseMs,
      ALPHA_RT,
      e.responseMs,
      hit,
      e.ts,
    ],
  };
}

function statRows(profileId: string, events: readonly CharEvent[]): SqlValue[][] {
  const stats = rebuildCharStats(
    events.map((e) => ({
      ch: e.ch,
      correct: e.outcome === "correct",
      responseMs: e.responseMs,
      ts: e.ts,
    })),
  );
  return [...stats.values()].map((s) => [
    profileId,
    s.ch,
    s.ewmaAcc,
    s.ewmaRt,
    s.attempts,
    s.correct,
    s.lastSeen,
  ]);
}

/** Statements that load one profile's data. `merge` skips anything whose id exists. */
function loadStatements(
  d: ProfileData,
  mode: ImportMode,
  newSessionIds: ReadonlySet<string>,
): Statement[] {
  const verb = mode === "merge" ? "INSERT OR IGNORE" : "INSERT";
  const p = d.profile;
  // Children always belong to the profile they are listed under.
  const sessions = d.sessions
    .filter((s) => newSessionIds.has(s.id))
    .map((s) => ({ ...s, profileId: p.id }));
  const trials = d.trials.filter((t) => newSessionIds.has(t.sessionId));
  const events = d.charEvents
    .filter((e) => newSessionIds.has(e.sessionId))
    .map((e) => ({ ...e, profileId: p.id }));
  return [
    {
      sql: `${verb} INTO profiles (id, name, color, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)`,
      params: [p.id, p.name, p.color, p.createdAt, p.lastUsedAt],
    },
    ...insertMany(
      "settings",
      ["profile_id", "key", "value", "updated_at"],
      d.settings.map((s) => [p.id, s.key, JSON.stringify(s.value ?? null), s.updatedAt]),
      verb,
    ),
    ...insertMany("sessions", SESSION_COLS, sessions.map(sessionRow), verb),
    ...insertMany("trials", TRIAL_COLS, trials.map(trialRow), verb),
    // Replace keeps event ids so a round trip is identical. Merge only brings the
    // events of new sessions, and lets them take fresh ids.
    ...(mode === "replace"
      ? insertMany(
          "char_events",
          ["id", ...EVENT_COLS],
          events.map((e) => [e.id, ...eventRow(e)]),
        )
      : insertMany("char_events", EVENT_COLS, events.map(eventRow))),
    ...insertMany(
      "koch_progress",
      ["profile_id", "order_id", "level", "updated_at"],
      d.kochProgress.map((k) => [p.id, k.orderId, k.level, k.updatedAt]),
      verb,
    ),
    ...d.kochLevelHistory.map((h) => ({
      // History has no key: skip rows that are already there.
      sql: `INSERT INTO koch_level_history (profile_id, order_id, level, reached_at, reason)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM koch_level_history
          WHERE profile_id = ? AND order_id = ? AND level = ? AND reached_at = ? AND reason = ?)`,
      params: [
        p.id,
        h.orderId,
        h.level,
        h.reachedAt,
        h.reason,
        p.id,
        h.orderId,
        h.level,
        h.reachedAt,
        h.reason,
      ],
    })),
    ...insertMany(
      "snippets",
      ["id", "profile_id", "title", "body", "created_at", "updated_at"],
      d.snippets.map((s) => [s.id, p.id, s.title, s.body, s.createdAt, s.updatedAt]),
      verb,
    ),
    ...insertMany(
      "word_lists",
      ["id", "profile_id", "name", "items", "created_at", "updated_at"],
      d.wordLists.map((w) => [
        w.id,
        p.id,
        w.name,
        JSON.stringify(w.items),
        w.createdAt,
        w.updatedAt,
      ]),
      verb,
    ),
    ...insertMany(
      "achievements",
      ["profile_id", "achievement_id", "earned_at"],
      d.achievements.map((a) => [p.id, a.achievementId, a.earnedAt]),
      verb,
    ),
  ];
}

export class SqliteStore implements Store {
  readonly kind = "sqlite";

  constructor(private readonly db: SqlDriver) {}

  private async rows<T>(
    map: (r: Row) => T,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T[]> {
    return (await this.db.select(sql, params)).map(map);
  }

  private async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.db.transaction([{ sql, params }]);
  }

  async getMeta(key: string): Promise<string | null> {
    const [row] = await this.db.select("SELECT value FROM meta WHERE key = ?", [key]);
    return row ? String(row.value) : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  async listProfiles(): Promise<Profile[]> {
    return await this.rows(
      profileFrom,
      "SELECT * FROM profiles ORDER BY last_used_at DESC, created_at",
    );
  }

  async createProfile(p: Profile): Promise<void> {
    const v = parse(ProfileSchema, p, "profile");
    await this.run(
      "INSERT INTO profiles (id, name, color, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      [v.id, v.name, v.color, v.createdAt, v.lastUsedAt],
    );
  }

  async updateProfile(
    id: string,
    patch: Partial<Pick<Profile, "name" | "color" | "lastUsedAt">>,
  ): Promise<void> {
    const [current] = await this.rows(profileFrom, "SELECT * FROM profiles WHERE id = ?", [id]);
    if (!current) throw new StoreError(`profile ${id} not found`);
    const v = parse(ProfileSchema, { ...current, ...patch }, "profile");
    await this.run("UPDATE profiles SET name = ?, color = ?, last_used_at = ? WHERE id = ?", [
      v.name,
      v.color,
      v.lastUsedAt,
      id,
    ]);
  }

  async deleteProfile(id: string): Promise<void> {
    await this.run("DELETE FROM profiles WHERE id = ?", [id]);
  }

  async getSettings(profileId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select("SELECT key, value FROM settings WHERE profile_id = ?", [
      profileId,
    ]);
    return Object.fromEntries(
      rows.map((r) => [String(r.key), parseJson(r.value, `setting ${String(r.key)}`)]),
    );
  }

  async putSettings(
    profileId: string,
    entries: Record<string, unknown>,
    now: number,
  ): Promise<void> {
    await this.db.transaction(
      Object.entries(entries).map(([key, value]) => ({
        sql: `INSERT INTO settings (profile_id, key, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        params: [profileId, key, JSON.stringify(value ?? null), now],
      })),
    );
  }

  async startSession(s: NewSession): Promise<void> {
    const v = parse(
      SessionSchema,
      {
        ...s,
        endedAt: null,
        activeMs: 0,
        sentChars: 0,
        correctChars: 0,
        errors: 0,
        accuracy: null,
        completed: false,
      },
      "session",
    );
    await this.run(
      `INSERT INTO sessions (${SESSION_COLS.join(", ")}) VALUES (${SESSION_COLS.map(() => "?").join(", ")})`,
      sessionRow(v),
    );
  }

  async endSession(id: string, end: SessionEnd): Promise<void> {
    await this.run("UPDATE sessions SET ended_at = ?, active_ms = ?, completed = ? WHERE id = ?", [
      end.endedAt,
      end.activeMs,
      b(end.completed),
      id,
    ]);
  }

  async closeAbandonedSessions(profileId: string, now: number): Promise<number> {
    const open = await this.db.select(
      "SELECT id FROM sessions WHERE profile_id = ? AND ended_at IS NULL",
      [profileId],
    );
    if (open.length === 0) return 0;
    // End at the last trial written, or at the start if none were.
    await this.run(
      `UPDATE sessions SET completed = 0, ended_at = MIN(?, COALESCE(
          (SELECT MAX(created_at) FROM trials WHERE trials.session_id = sessions.id), started_at))
        WHERE profile_id = ? AND ended_at IS NULL`,
      [now, profileId],
    );
    return open.length;
  }

  async getSession(id: string): Promise<Session | null> {
    const [s] = await this.rows(sessionFrom, "SELECT * FROM sessions WHERE id = ?", [id]);
    return s ?? null;
  }

  async listSessions(profileId: string, limit = -1): Promise<Session[]> {
    return await this.rows(
      sessionFrom,
      "SELECT * FROM sessions WHERE profile_id = ? ORDER BY started_at DESC LIMIT ?",
      [profileId, limit],
    );
  }

  async recordTrial({ trial, events, errors }: TrialRecord): Promise<void> {
    const t = parse(TrialSchema, trial, "trial");
    const evs = events.map((e) => parse(CharEventSchema.omit({ id: true }), e, "char event"));
    const correct = evs.filter((e) => e.outcome === "correct").length;
    await this.db.transaction([
      {
        sql: `INSERT INTO trials (${TRIAL_COLS.join(", ")}) VALUES (${TRIAL_COLS.map(() => "?").join(", ")})`,
        params: trialRow(t),
      },
      ...insertMany("char_events", EVENT_COLS, evs.map(eventRow)),
      ...evs.map(statUpsert),
      {
        sql: `UPDATE sessions SET
            sent_chars = sent_chars + ?, correct_chars = correct_chars + ?, errors = errors + ?,
            accuracy = CASE WHEN sent_chars + ? > 0
              THEN MAX(0.0, 1.0 - (errors + ?) * 1.0 / (sent_chars + ?)) ELSE NULL END
          WHERE id = ?`,
        params: [evs.length, correct, errors, evs.length, errors, evs.length, t.sessionId],
      },
    ]);
  }

  async listTrials(sessionId: string): Promise<Trial[]> {
    return await this.rows(trialFrom, "SELECT * FROM trials WHERE session_id = ? ORDER BY idx", [
      sessionId,
    ]);
  }

  async listCharEvents(profileId: string): Promise<CharEvent[]> {
    return await this.rows(
      eventFrom,
      "SELECT * FROM char_events WHERE profile_id = ? ORDER BY id",
      [profileId],
    );
  }

  async queryCharEvents(profileId: string, q: CharEventQuery): Promise<CharEvent[]> {
    const where = ["profile_id = ?"];
    const params: SqlValue[] = [profileId];
    if (q.ch !== undefined) {
      where.push("ch = ?");
      params.push(q.ch);
    }
    if (q.mode !== undefined) {
      where.push("mode = ?");
      params.push(q.mode);
    }
    if (q.outcome !== undefined) {
      where.push("outcome = ?");
      params.push(q.outcome);
    }
    if (q.withResponse) where.push("response_ms IS NOT NULL");
    let sql = `SELECT * FROM char_events WHERE ${where.join(" AND ")} ORDER BY ts DESC, id DESC`;
    if (q.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(q.limit);
    }
    return await this.rows(eventFrom, sql, params);
  }

  async getCharStats(profileId: string): Promise<CharStatRow[]> {
    return await this.rows(statFrom, "SELECT * FROM char_stats WHERE profile_id = ? ORDER BY ch", [
      profileId,
    ]);
  }

  async rebuildCharStats(profileId: string): Promise<void> {
    const events = await this.listCharEvents(profileId);
    await this.db.transaction([
      { sql: "DELETE FROM char_stats WHERE profile_id = ?", params: [profileId] },
      ...insertMany("char_stats", STAT_COLS, statRows(profileId, events)),
    ]);
  }

  async getKochProgress(profileId: string): Promise<KochProgress[]> {
    return await this.rows(
      kochFrom,
      "SELECT * FROM koch_progress WHERE profile_id = ? ORDER BY order_id",
      [profileId],
    );
  }

  async setKochLevel(
    profileId: string,
    orderId: string,
    level: number,
    reason: LevelReason,
    now: number,
  ): Promise<void> {
    const v = parse(
      KochLevelHistorySchema,
      { profileId, orderId, level, reachedAt: now, reason },
      "Koch level",
    );
    await this.db.transaction([
      {
        sql: `INSERT INTO koch_progress (profile_id, order_id, level, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (profile_id, order_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
        params: [v.profileId, v.orderId, v.level, now],
      },
      {
        sql: "INSERT INTO koch_level_history (profile_id, order_id, level, reached_at, reason) VALUES (?, ?, ?, ?, ?)",
        params: [v.profileId, v.orderId, v.level, v.reachedAt, v.reason],
      },
    ]);
  }

  async getKochHistory(profileId: string): Promise<KochLevelHistory[]> {
    return await this.rows(
      historyFrom,
      "SELECT * FROM koch_level_history WHERE profile_id = ? ORDER BY reached_at, rowid",
      [profileId],
    );
  }

  async listSnippets(profileId: string): Promise<Snippet[]> {
    return await this.rows(
      snippetFrom,
      "SELECT * FROM snippets WHERE profile_id = ? ORDER BY updated_at DESC, title",
      [profileId],
    );
  }

  async saveSnippet(s: Snippet): Promise<void> {
    const v = parse(SnippetSchema, s, "snippet");
    await this.run(
      `INSERT INTO snippets (id, profile_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at`,
      [v.id, v.profileId, v.title, v.body, v.createdAt, v.updatedAt],
    );
  }

  async deleteSnippet(id: string): Promise<void> {
    await this.run("DELETE FROM snippets WHERE id = ?", [id]);
  }

  async listWordLists(profileId: string): Promise<WordList[]> {
    return await this.rows(
      wordListFrom,
      "SELECT * FROM word_lists WHERE profile_id = ? ORDER BY updated_at DESC, name",
      [profileId],
    );
  }

  async saveWordList(w: WordList): Promise<void> {
    const v = parse(WordListSchema, w, "word list");
    await this.run(
      `INSERT INTO word_lists (id, profile_id, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, items = excluded.items, updated_at = excluded.updated_at`,
      [v.id, v.profileId, v.name, JSON.stringify(v.items), v.createdAt, v.updatedAt],
    );
  }

  async deleteWordList(id: string): Promise<void> {
    await this.run("DELETE FROM word_lists WHERE id = ?", [id]);
  }

  async listAchievements(profileId: string): Promise<Achievement[]> {
    return await this.rows(
      achievementFrom,
      "SELECT * FROM achievements WHERE profile_id = ? ORDER BY earned_at",
      [profileId],
    );
  }

  async grantAchievement(a: Achievement): Promise<void> {
    const v = parse(AchievementSchema, a, "achievement");
    await this.run(
      "INSERT OR IGNORE INTO achievements (profile_id, achievement_id, earned_at) VALUES (?, ?, ?)",
      [v.profileId, v.achievementId, v.earnedAt],
    );
  }

  async resetProgress(profileId: string): Promise<void> {
    await this.db.transaction(
      ["sessions", "char_stats", "koch_progress", "koch_level_history", "achievements"].map(
        (table) => ({
          sql: `DELETE FROM ${table} WHERE profile_id = ?`,
          params: [profileId],
        }),
      ),
    );
  }

  async exportProfiles(profileIds: readonly string[]): Promise<ProfileData[]> {
    const out: ProfileData[] = [];
    for (const id of profileIds) {
      const [profile] = await this.rows(profileFrom, "SELECT * FROM profiles WHERE id = ?", [id]);
      if (!profile) throw new StoreError(`profile ${id} not found`);
      const settingRows = await this.db.select(
        "SELECT key, value, updated_at FROM settings WHERE profile_id = ? ORDER BY key",
        [id],
      );
      const sessions = await this.rows(
        sessionFrom,
        "SELECT * FROM sessions WHERE profile_id = ? ORDER BY started_at, id",
        [id],
      );
      const trials = await this.rows(
        trialFrom,
        `SELECT t.* FROM trials t JOIN sessions s ON s.id = t.session_id
          WHERE s.profile_id = ? ORDER BY s.started_at, s.id, t.idx`,
        [id],
      );
      out.push({
        profile,
        settings: settingRows.map((r) => ({
          profileId: id,
          key: String(r.key),
          value: parseJson(r.value, `setting ${String(r.key)}`),
          updatedAt: Number(r.updated_at),
        })),
        sessions,
        trials,
        charEvents: await this.listCharEvents(id),
        kochProgress: await this.getKochProgress(id),
        kochLevelHistory: await this.getKochHistory(id),
        snippets: await this.rows(
          snippetFrom,
          "SELECT * FROM snippets WHERE profile_id = ? ORDER BY created_at, id",
          [id],
        ),
        wordLists: await this.rows(
          wordListFrom,
          "SELECT * FROM word_lists WHERE profile_id = ? ORDER BY created_at, id",
          [id],
        ),
        achievements: await this.rows(
          achievementFrom,
          "SELECT * FROM achievements WHERE profile_id = ? ORDER BY earned_at, achievement_id",
          [id],
        ),
      });
    }
    return out;
  }

  async importProfiles(data: readonly ProfileData[], mode: ImportMode): Promise<ImportResult> {
    const existing = new Set(
      mode === "merge"
        ? (await this.db.select("SELECT id FROM sessions")).map((r) => String(r.id))
        : [],
    );
    const statements: Statement[] = mode === "replace" ? [{ sql: "DELETE FROM profiles" }] : [];
    let sessions = 0;
    for (const d of data) {
      const fresh = new Set(d.sessions.map((s) => s.id).filter((id) => !existing.has(id)));
      sessions += fresh.size;
      statements.push(...loadStatements(d, mode, fresh));
    }
    await this.db.transaction(statements);
    for (const d of data) await this.rebuildCharStats(d.profile.id);
    return { profiles: data.length, sessions };
  }
}
