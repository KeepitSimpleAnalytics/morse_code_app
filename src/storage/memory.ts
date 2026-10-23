import { rebuildCharStats, updateCharStat } from "../core/adaptive";
import {
  AchievementSchema,
  CharEventSchema,
  KochLevelHistorySchema,
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
import type { ImportMode, ImportResult, NewSession, SessionEnd, Store, TrialRecord } from "./store";
import { StoreError } from "./store";

/**
 * In-memory Store for unit tests and `pnpm dev:web` (SPEC §9.3). Nothing is saved;
 * the app shows a red "Dev mode" banner whenever this store is in use.
 *
 * Values are deep-copied in and out so callers can't mutate stored state, the same
 * as a round trip through SQLite. Multi-step writes run on a scratch copy that
 * replaces the tables only on success, like a transaction.
 */

/* eslint-disable @typescript-eslint/require-await -- the Store contract is async;
   this in-memory implementation has nothing to await. */

interface SettingValue {
  value: unknown;
  updatedAt: number;
}

interface Tables {
  meta: Map<string, string>;
  profiles: Map<string, Profile>;
  /** profileId → key → value */
  settings: Map<string, Map<string, SettingValue>>;
  sessions: Map<string, Session>;
  trials: Map<string, Trial>;
  charEvents: CharEvent[];
  nextEventId: number;
  charStats: Map<string, CharStatRow>;
  kochProgress: Map<string, KochProgress>;
  kochHistory: KochLevelHistory[];
  snippets: Map<string, Snippet>;
  wordLists: Map<string, WordList>;
  achievements: Map<string, Achievement>;
}

const empty = (): Tables => ({
  meta: new Map(),
  profiles: new Map(),
  settings: new Map(),
  sessions: new Map(),
  trials: new Map(),
  charEvents: [],
  nextEventId: 1,
  charStats: new Map(),
  kochProgress: new Map(),
  kochHistory: [],
  snippets: new Map(),
  wordLists: new Map(),
  achievements: new Map(),
});

const copy = <T>(v: T): T => structuredClone(v);
const key2 = (a: string, b: string) => `${a}\u0000${b}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const unique = (what: string) => new StoreError(`UNIQUE constraint failed: ${what}`);
const foreign = (what: string) => new StoreError(`FOREIGN KEY constraint failed: ${what}`);

export class MemoryStore implements Store {
  readonly kind = "memory";
  private t: Tables = empty();

  private atomically<R>(fn: (t: Tables) => R): R {
    const scratch = copy(this.t);
    const result = fn(scratch);
    this.t = scratch;
    return result;
  }

  private requireProfile(t: Tables, id: string): void {
    if (!t.profiles.has(id)) throw foreign(`profile ${id}`);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.t.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.t.meta.set(key, value);
  }

  async listProfiles(): Promise<Profile[]> {
    const list = [...this.t.profiles.values()].sort(
      (a, b) => b.lastUsedAt - a.lastUsedAt || a.createdAt - b.createdAt,
    );
    return copy(list);
  }

  async createProfile(p: Profile): Promise<void> {
    const v = ProfileSchema.parse(p);
    if (this.t.profiles.has(v.id)) throw unique(`profile ${v.id}`);
    this.t.profiles.set(v.id, copy(v));
  }

  async updateProfile(
    id: string,
    patch: Partial<Pick<Profile, "name" | "color" | "lastUsedAt">>,
  ): Promise<void> {
    const current = this.t.profiles.get(id);
    if (!current) throw new StoreError(`profile ${id} not found`);
    this.t.profiles.set(id, ProfileSchema.parse({ ...current, ...patch }));
  }

  async deleteProfile(id: string): Promise<void> {
    this.atomically((t) => {
      deleteProfileFrom(t, id);
    });
  }

  async getSettings(profileId: string): Promise<Record<string, unknown>> {
    const rows = this.t.settings.get(profileId) ?? new Map<string, SettingValue>();
    return copy(Object.fromEntries([...rows].map(([k, v]) => [k, v.value])));
  }

  async putSettings(
    profileId: string,
    entries: Record<string, unknown>,
    now: number,
  ): Promise<void> {
    this.atomically((t) => {
      this.requireProfile(t, profileId);
      const rows = t.settings.get(profileId) ?? new Map<string, SettingValue>();
      for (const [k, v] of Object.entries(entries)) {
        rows.set(k, { value: copy(v ?? null), updatedAt: now });
      }
      t.settings.set(profileId, rows);
    });
  }

  async startSession(s: NewSession): Promise<void> {
    const v = SessionSchema.parse({
      ...s,
      endedAt: null,
      activeMs: 0,
      sentChars: 0,
      correctChars: 0,
      errors: 0,
      accuracy: null,
      completed: false,
    });
    this.requireProfile(this.t, v.profileId);
    if (this.t.sessions.has(v.id)) throw unique(`session ${v.id}`);
    this.t.sessions.set(v.id, copy(v));
  }

  async endSession(id: string, end: SessionEnd): Promise<void> {
    const s = this.t.sessions.get(id);
    if (s) this.t.sessions.set(id, { ...s, ...end });
  }

  async closeAbandonedSessions(profileId: string, now: number): Promise<number> {
    let n = 0;
    for (const s of this.t.sessions.values()) {
      if (s.profileId !== profileId || s.endedAt !== null) continue;
      const times = [...this.t.trials.values()]
        .filter((tr) => tr.sessionId === s.id)
        .map((tr) => tr.createdAt);
      // End at the last trial written, or at the start if none were.
      const lastWrite = times.length > 0 ? Math.max(...times) : s.startedAt;
      this.t.sessions.set(s.id, { ...s, endedAt: Math.min(now, lastWrite), completed: false });
      n++;
    }
    return n;
  }

  async getSession(id: string): Promise<Session | null> {
    const s = this.t.sessions.get(id);
    return s ? copy(s) : null;
  }

  async listSessions(profileId: string, limit = -1): Promise<Session[]> {
    const list = [...this.t.sessions.values()]
      .filter((s) => s.profileId === profileId)
      .sort((a, b) => b.startedAt - a.startedAt);
    return copy(limit < 0 ? list : list.slice(0, limit));
  }

  async recordTrial({ trial, events, errors }: TrialRecord): Promise<void> {
    const tr = TrialSchema.parse(trial);
    const evs = events.map((e) => CharEventSchema.omit({ id: true }).parse(e));
    this.atomically((t) => {
      const session = t.sessions.get(tr.sessionId);
      if (!session) throw foreign(`session ${tr.sessionId}`);
      if (t.trials.has(tr.id)) throw unique(`trial ${tr.id}`);
      t.trials.set(tr.id, copy(tr));
      for (const e of evs) {
        this.requireProfile(t, e.profileId);
        if (!t.sessions.has(e.sessionId)) throw foreign(`session ${e.sessionId}`);
        t.charEvents.push({ ...copy(e), id: t.nextEventId++ });
        const k = key2(e.profileId, e.ch);
        const next = updateCharStat(t.charStats.get(k), {
          ch: e.ch,
          correct: e.outcome === "correct",
          responseMs: e.responseMs,
          ts: e.ts,
        });
        t.charStats.set(k, { profileId: e.profileId, ...next });
      }
      const sent = session.sentChars + evs.length;
      const errs = session.errors + errors;
      t.sessions.set(session.id, {
        ...session,
        sentChars: sent,
        correctChars: session.correctChars + evs.filter((e) => e.outcome === "correct").length,
        errors: errs,
        accuracy: sent > 0 ? Math.max(0, 1 - (errs * 1) / sent) : null,
      });
    });
  }

  async listTrials(sessionId: string): Promise<Trial[]> {
    const list = [...this.t.trials.values()]
      .filter((tr) => tr.sessionId === sessionId)
      .sort((a, b) => a.idx - b.idx);
    return copy(list);
  }

  async listCharEvents(profileId: string): Promise<CharEvent[]> {
    return copy(this.t.charEvents.filter((e) => e.profileId === profileId));
  }

  async getCharStats(profileId: string): Promise<CharStatRow[]> {
    const list = [...this.t.charStats.values()]
      .filter((s) => s.profileId === profileId)
      .sort((a, b) => cmp(a.ch, b.ch));
    return copy(list);
  }

  async rebuildCharStats(profileId: string): Promise<void> {
    rebuildStatsIn(this.t, profileId);
  }

  async getKochProgress(profileId: string): Promise<KochProgress[]> {
    const list = [...this.t.kochProgress.values()]
      .filter((k) => k.profileId === profileId)
      .sort((a, b) => cmp(a.orderId, b.orderId));
    return copy(list);
  }

  async setKochLevel(
    profileId: string,
    orderId: string,
    level: number,
    reason: LevelReason,
    now: number,
  ): Promise<void> {
    const h = KochLevelHistorySchema.parse({ profileId, orderId, level, reachedAt: now, reason });
    this.requireProfile(this.t, profileId);
    this.t.kochProgress.set(key2(profileId, orderId), {
      profileId,
      orderId,
      level,
      updatedAt: now,
    });
    this.t.kochHistory.push(h);
  }

  async getKochHistory(profileId: string): Promise<KochLevelHistory[]> {
    // A stable sort keeps insertion order for equal times, like ORDER BY reached_at, rowid.
    const list = this.t.kochHistory
      .filter((h) => h.profileId === profileId)
      .sort((a, b) => a.reachedAt - b.reachedAt);
    return copy(list);
  }

  async listSnippets(profileId: string): Promise<Snippet[]> {
    return copy(byEditTime([...this.t.snippets.values()], profileId, (s) => s.title));
  }

  async saveSnippet(s: Snippet): Promise<void> {
    const v = SnippetSchema.parse(s);
    this.requireProfile(this.t, v.profileId);
    const prev = this.t.snippets.get(v.id);
    // Like ON CONFLICT DO UPDATE: the owner and creation time don't change.
    this.t.snippets.set(
      v.id,
      prev ? { ...prev, title: v.title, body: v.body, updatedAt: v.updatedAt } : copy(v),
    );
  }

  async deleteSnippet(id: string): Promise<void> {
    this.t.snippets.delete(id);
  }

  async listWordLists(profileId: string): Promise<WordList[]> {
    return copy(byEditTime([...this.t.wordLists.values()], profileId, (w) => w.name));
  }

  async saveWordList(w: WordList): Promise<void> {
    const v = WordListSchema.parse(w);
    this.requireProfile(this.t, v.profileId);
    const prev = this.t.wordLists.get(v.id);
    this.t.wordLists.set(
      v.id,
      prev ? { ...prev, name: v.name, items: copy(v.items), updatedAt: v.updatedAt } : copy(v),
    );
  }

  async deleteWordList(id: string): Promise<void> {
    this.t.wordLists.delete(id);
  }

  async listAchievements(profileId: string): Promise<Achievement[]> {
    const list = [...this.t.achievements.values()]
      .filter((a) => a.profileId === profileId)
      .sort((a, b) => a.earnedAt - b.earnedAt);
    return copy(list);
  }

  async grantAchievement(a: Achievement): Promise<void> {
    const v = AchievementSchema.parse(a);
    this.requireProfile(this.t, v.profileId);
    const k = key2(v.profileId, v.achievementId);
    if (!this.t.achievements.has(k)) this.t.achievements.set(k, copy(v));
  }

  async resetProgress(profileId: string): Promise<void> {
    this.atomically((t) => {
      resetProgressIn(t, profileId);
    });
  }

  async exportProfiles(profileIds: readonly string[]): Promise<ProfileData[]> {
    const t = this.t;
    return profileIds.map((id) => {
      const profile = t.profiles.get(id);
      if (!profile) throw new StoreError(`profile ${id} not found`);
      const mine = <V extends { profileId: string }>(rows: Iterable<V>) =>
        [...rows].filter((r) => r.profileId === id);
      const sessions = mine(t.sessions.values()).sort(
        (a, b) => a.startedAt - b.startedAt || cmp(a.id, b.id),
      );
      const order = new Map(sessions.map((s, i) => [s.id, i]));
      const settings = t.settings.get(id) ?? new Map<string, SettingValue>();
      return copy({
        profile,
        settings: [...settings]
          .sort(([a], [b]) => cmp(a, b))
          .map(([key, v]) => ({ profileId: id, key, value: v.value, updatedAt: v.updatedAt })),
        sessions,
        trials: [...t.trials.values()]
          .filter((tr) => order.has(tr.sessionId))
          .sort(
            (a, b) =>
              (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0) || a.idx - b.idx,
          ),
        charEvents: mine(t.charEvents),
        kochProgress: mine(t.kochProgress.values()).sort((a, b) => cmp(a.orderId, b.orderId)),
        kochLevelHistory: mine(t.kochHistory).sort((a, b) => a.reachedAt - b.reachedAt),
        snippets: mine(t.snippets.values()).sort(
          (a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id),
        ),
        wordLists: mine(t.wordLists.values()).sort(
          (a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id),
        ),
        achievements: mine(t.achievements.values()).sort(
          (a, b) => a.earnedAt - b.earnedAt || cmp(a.achievementId, b.achievementId),
        ),
      });
    });
  }

  async importProfiles(data: readonly ProfileData[], mode: ImportMode): Promise<ImportResult> {
    const merge = mode === "merge";
    const sessions = this.atomically((t) => {
      if (!merge) for (const id of [...t.profiles.keys()]) deleteProfileFrom(t, id);
      /** Adds a keyed row. Merge skips existing keys; Replace treats them as a conflict. */
      const add = <V>(map: Map<string, V>, key: string, value: V, what: string): boolean => {
        if (map.has(key)) {
          if (!merge) throw unique(what);
          return false;
        }
        map.set(key, copy(value));
        return true;
      };
      let added = 0;
      for (const d of data) {
        const pid = d.profile.id;
        add(t.profiles, pid, d.profile, `profile ${pid}`);
        const rows = t.settings.get(pid) ?? new Map<string, SettingValue>();
        for (const s of d.settings) {
          add(rows, s.key, { value: s.value ?? null, updatedAt: s.updatedAt }, `setting ${s.key}`);
        }
        t.settings.set(pid, rows);

        const fresh = new Set<string>();
        for (const s of d.sessions) {
          if (add(t.sessions, s.id, { ...s, profileId: pid }, `session ${s.id}`)) fresh.add(s.id);
        }
        added += fresh.size;
        for (const tr of d.trials) {
          if (fresh.has(tr.sessionId)) add(t.trials, tr.id, tr, `trial ${tr.id}`);
        }
        for (const e of d.charEvents) {
          if (!fresh.has(e.sessionId)) continue;
          if (merge) {
            // Merge brings the events of new sessions, with fresh ids.
            t.charEvents.push({ ...copy(e), profileId: pid, id: t.nextEventId++ });
          } else {
            if (t.charEvents.some((x) => x.id === e.id)) throw unique(`char event ${e.id}`);
            t.charEvents.push({ ...copy(e), profileId: pid });
            t.nextEventId = Math.max(t.nextEventId, e.id + 1);
          }
        }
        for (const k of d.kochProgress) {
          add(t.kochProgress, key2(pid, k.orderId), { ...k, profileId: pid }, `Koch ${k.orderId}`);
        }
        for (const h of d.kochLevelHistory) {
          // History has no key: skip rows that are already there.
          const dup = t.kochHistory.some(
            (x) =>
              x.profileId === pid &&
              x.orderId === h.orderId &&
              x.level === h.level &&
              x.reachedAt === h.reachedAt &&
              x.reason === h.reason,
          );
          if (!dup) t.kochHistory.push({ ...h, profileId: pid });
        }
        for (const s of d.snippets) {
          add(t.snippets, s.id, { ...s, profileId: pid }, `snippet ${s.id}`);
        }
        for (const w of d.wordLists) {
          add(t.wordLists, w.id, { ...w, profileId: pid }, `word list ${w.id}`);
        }
        for (const a of d.achievements) {
          const k = key2(pid, a.achievementId);
          add(t.achievements, k, { ...a, profileId: pid }, `achievement ${a.achievementId}`);
        }
      }
      for (const d of data) rebuildStatsIn(t, d.profile.id);
      return added;
    });
    return { profiles: data.length, sessions };
  }
}

function byEditTime<T extends { profileId: string; updatedAt: number }>(
  list: T[],
  profileId: string,
  name: (v: T) => string,
): T[] {
  return list
    .filter((v) => v.profileId === profileId)
    .sort((a, b) => b.updatedAt - a.updatedAt || cmp(name(a), name(b)));
}

function rebuildStatsIn(t: Tables, profileId: string): void {
  for (const [k, s] of t.charStats) if (s.profileId === profileId) t.charStats.delete(k);
  const stats = rebuildCharStats(
    t.charEvents
      .filter((e) => e.profileId === profileId)
      .map((e) => ({
        ch: e.ch,
        correct: e.outcome === "correct",
        responseMs: e.responseMs,
        ts: e.ts,
      })),
  );
  for (const s of stats.values()) t.charStats.set(key2(profileId, s.ch), { profileId, ...s });
}

function resetProgressIn(t: Tables, profileId: string): void {
  const sessionIds = new Set(
    [...t.sessions.values()].filter((s) => s.profileId === profileId).map((s) => s.id),
  );
  for (const id of sessionIds) t.sessions.delete(id);
  for (const [id, tr] of t.trials) if (sessionIds.has(tr.sessionId)) t.trials.delete(id);
  t.charEvents = t.charEvents.filter(
    (e) => e.profileId !== profileId && !sessionIds.has(e.sessionId),
  );
  for (const [k, s] of t.charStats) if (s.profileId === profileId) t.charStats.delete(k);
  for (const [k, p] of t.kochProgress) if (p.profileId === profileId) t.kochProgress.delete(k);
  t.kochHistory = t.kochHistory.filter((h) => h.profileId !== profileId);
  for (const [k, a] of t.achievements) if (a.profileId === profileId) t.achievements.delete(k);
}

function deleteProfileFrom(t: Tables, id: string): void {
  resetProgressIn(t, id);
  t.settings.delete(id);
  for (const [k, s] of t.snippets) if (s.profileId === id) t.snippets.delete(k);
  for (const [k, w] of t.wordLists) if (w.profileId === id) t.wordLists.delete(k);
  t.profiles.delete(id);
}
