import { beforeEach, describe, expect, it } from "vitest";
import { buildTrialRecord, type TrialInput } from "../../src/storage/records";
import type { Profile, Snippet } from "../../src/storage/schemas";
import type { NewSession, Store } from "../../src/storage/store";

/**
 * The storage contract (SPEC §14.1): MemoryStore and SqliteStore run this same
 * suite, so the dev/test store can't drift from production behaviour.
 */

export const T0 = 1_761_000_000_000;

export const profile = (id: string, over: Partial<Profile> = {}): Profile => ({
  id,
  name: `Op ${id}`,
  color: "#3b82f6",
  createdAt: T0,
  lastUsedAt: T0,
  ...over,
});

export const session = (id: string, profileId: string, startedAt = T0): NewSession => ({
  id,
  profileId,
  mode: "koch",
  startedAt,
  seed: 42,
  settingsSnapshot: { charWpm: 20, effWpm: 15, toneHz: 600, level: 3 },
});

let trialSeq = 0;
export const trial = (
  sessionId: string,
  profileId: string,
  prompt: string,
  response: string,
  over: Partial<TrialInput> = {},
) =>
  buildTrialRecord({
    id: `t${++trialSeq}`,
    profileId,
    sessionId,
    mode: "koch",
    idx: trialSeq,
    prompt,
    response,
    revealed: false,
    repeats: 0,
    responseMs: null,
    charWpm: 20,
    at: T0 + trialSeq * 1000,
    ...over,
  });

const snippet = (id: string, profileId: string, updatedAt: number): Snippet => ({
  id,
  profileId,
  title: `Snippet ${id}`,
  body: "CQ CQ DE W1AW",
  createdAt: T0,
  updatedAt,
});

/** A profile with one finished session, one abandoned one, and some of everything. */
export async function seed(store: Store, pid = "p1"): Promise<void> {
  await store.createProfile(profile(pid));
  await store.putSettings(
    pid,
    { "timing.speeds": { charWpm: 25, effWpm: 12 }, "display.fontScale": 1.5 },
    T0,
  );
  await store.startSession(session(`${pid}-s1`, pid));
  await store.recordTrial(trial(`${pid}-s1`, pid, "KMRSU AKMRS", "KMRSU AKMSS"));
  await store.recordTrial(trial(`${pid}-s1`, pid, "<AR> K", "+ K", { responseMs: 640 }));
  await store.recordTrial(trial(`${pid}-s1`, pid, "MMK", "", { revealed: true }));
  await store.endSession(`${pid}-s1`, { endedAt: T0 + 60_000, activeMs: 55_000, completed: true });
  await store.startSession(session(`${pid}-s2`, pid, T0 + 100_000));
  await store.recordTrial(trial(`${pid}-s2`, pid, "KM", "KN", { responseMs: 900 }));
  await store.setKochLevel(pid, "lcwo", 2, "passed", T0 + 10);
  await store.setKochLevel(pid, "lcwo", 3, "manual", T0 + 20);
  await store.saveSnippet(snippet(`${pid}-n1`, pid, T0));
  await store.saveWordList({
    id: `${pid}-w1`,
    profileId: pid,
    name: "Club calls",
    items: [{ word: "W1AW", meaning: "ARRL HQ" }, { word: "K1ABC" }],
    createdAt: T0,
    updatedAt: T0,
  });
  await store.grantAchievement({
    profileId: pid,
    achievementId: "first-lesson",
    earnedAt: T0 + 60_000,
  });
}

export function storeContract(name: string, make: () => Store): void {
  describe(`${name} (Store contract)`, () => {
    let store: Store;
    beforeEach(() => {
      trialSeq = 0;
      store = make();
    });

    it("stores app-level meta values", async () => {
      expect(await store.getMeta("theme")).toBeNull();
      await store.setMeta("theme", "dark");
      await store.setMeta("theme", "light");
      expect(await store.getMeta("theme")).toBe("light");
    });

    describe("profiles", () => {
      it("lists the most recently used first and updates fields", async () => {
        await store.createProfile(profile("a", { lastUsedAt: T0 }));
        await store.createProfile(profile("b", { lastUsedAt: T0 + 5 }));
        expect((await store.listProfiles()).map((p) => p.id)).toEqual(["b", "a"]);
        await store.updateProfile("a", { lastUsedAt: T0 + 10, name: "Alice", color: "#ef4444" });
        const [first] = await store.listProfiles();
        expect(first).toEqual({
          ...profile("a"),
          lastUsedAt: T0 + 10,
          name: "Alice",
          color: "#ef4444",
        });
      });

      it("rejects duplicate ids and invalid values", async () => {
        await store.createProfile(profile("a"));
        await expect(store.createProfile(profile("a"))).rejects.toThrow();
        await expect(store.createProfile(profile("b", { name: "" }))).rejects.toThrow();
        await expect(store.updateProfile("a", { color: "red" })).rejects.toThrow();
        await expect(store.updateProfile("nope", { name: "X" })).rejects.toThrow(/not found/);
      });

      it("deleting a profile removes everything that belongs to it, and only that", async () => {
        await seed(store, "p1");
        await seed(store, "p2");
        await store.deleteProfile("p1");
        expect((await store.listProfiles()).map((p) => p.id)).toEqual(["p2"]);
        expect(await store.getSettings("p1")).toEqual({});
        expect(await store.listSessions("p1")).toEqual([]);
        expect(await store.listTrials("p1-s1")).toEqual([]);
        expect(await store.listCharEvents("p1")).toEqual([]);
        expect(await store.getCharStats("p1")).toEqual([]);
        expect(await store.getKochProgress("p1")).toEqual([]);
        expect(await store.getKochHistory("p1")).toEqual([]);
        expect(await store.listSnippets("p1")).toEqual([]);
        expect(await store.listWordLists("p1")).toEqual([]);
        expect(await store.listAchievements("p1")).toEqual([]);
        expect(await store.listSessions("p2")).toHaveLength(2);
        expect((await store.listCharEvents("p2")).length).toBeGreaterThan(0);
      });
    });

    describe("settings", () => {
      it("returns values exactly as saved (v1 defect #1)", async () => {
        await store.createProfile(profile("a"));
        await store.putSettings(
          "a",
          { "timing.speeds": { charWpm: 25, effWpm: 12 }, "audio.toneHz": 650 },
          T0,
        );
        await store.putSettings("a", { "audio.toneHz": 700, "display.showCode": "after" }, T0 + 1);
        expect(await store.getSettings("a")).toEqual({
          "timing.speeds": { charWpm: 25, effWpm: 12 },
          "audio.toneHz": 700,
          "display.showCode": "after",
        });
      });

      it("rejects settings for a profile that doesn't exist", async () => {
        await expect(store.putSettings("ghost", { x: 1 }, T0)).rejects.toThrow();
      });

      it("hands out copies, not live references", async () => {
        await store.createProfile(profile("a"));
        const value = { charWpm: 20, effWpm: 15 };
        await store.putSettings("a", { s: value }, T0);
        value.effWpm = 3;
        const got = await store.getSettings("a");
        (got.s as { effWpm: number }).effWpm = 4;
        expect((await store.getSettings("a")).s).toEqual({ charWpm: 20, effWpm: 15 });
      });
    });

    describe("sessions and trials", () => {
      it("writes each trial with its events, totals and stats", async () => {
        await store.createProfile(profile("a"));
        await store.startSession(session("s", "a"));
        await store.recordTrial(trial("s", "a", "KMR", "KMS"));
        await store.recordTrial(trial("s", "a", "AB", "XAB"));

        const s = await store.getSession("s");
        expect(s).toMatchObject({
          sentChars: 5,
          correctChars: 4,
          errors: 2,
          endedAt: null,
          completed: false,
        });
        expect(s?.accuracy).toBeCloseTo(1 - 2 / 5, 12);

        const trials = await store.listTrials("s");
        expect(trials.map((t) => t.response)).toEqual(["KMS", "XAB"]);
        expect(trials[0]?.alignment).toEqual(trial("x", "a", "KMR", "KMS").trial.alignment);

        const events = await store.listCharEvents("a");
        expect(events.map((e) => [e.ch, e.outcome, e.typed])).toEqual([
          ["K", "correct", null],
          ["M", "correct", null],
          ["R", "substituted", "S"],
          ["A", "correct", null],
          ["B", "correct", null],
        ]);
        expect(new Set(events.map((e) => e.id)).size).toBe(5);

        const stats = await store.getCharStats("a");
        expect(stats.map((x) => [x.ch, x.attempts, x.correct])).toEqual([
          ["A", 1, 1],
          ["B", 1, 1],
          ["K", 1, 1],
          ["M", 1, 1],
          ["R", 1, 0],
        ]);
      });

      it("writes nothing from a trial that fails", async () => {
        await store.createProfile(profile("a"));
        await store.startSession(session("s", "a"));
        const ok = trial("s", "a", "KM", "KM");
        await store.recordTrial(ok);
        // Same trial id again: the trial insert fails, so its events and stats must not land.
        await expect(
          store.recordTrial({ ...trial("s", "a", "RRR", "RRR"), trial: { ...ok.trial } }),
        ).rejects.toThrow();
        await expect(store.recordTrial(trial("missing", "a", "K", "K"))).rejects.toThrow();
        expect(await store.listCharEvents("a")).toHaveLength(2);
        expect((await store.getCharStats("a")).map((x) => x.ch)).toEqual(["K", "M"]);
        expect(await store.getSession("s")).toMatchObject({ sentChars: 2, errors: 0 });
      });

      it("lists sessions newest first, with an optional limit", async () => {
        await store.createProfile(profile("a"));
        for (const [id, at] of [
          ["s1", T0],
          ["s3", T0 + 2],
          ["s2", T0 + 1],
        ] as const) {
          await store.startSession(session(id, "a", at));
        }
        expect((await store.listSessions("a")).map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
        expect((await store.listSessions("a", 2)).map((s) => s.id)).toEqual(["s3", "s2"]);
      });

      it("ends sessions and closes abandoned ones as incomplete, keeping their trials (QA 8)", async () => {
        await seed(store, "a");
        await store.startSession(session("empty", "a", T0 + 200_000));
        expect(await store.closeAbandonedSessions("a", T0 + 999_999)).toBe(2);
        expect(await store.closeAbandonedSessions("a", T0 + 999_999)).toBe(0);

        const done = await store.getSession("a-s1");
        expect(done).toMatchObject({ completed: true, endedAt: T0 + 60_000, activeMs: 55_000 });
        const killed = await store.getSession("a-s2");
        const [lastTrial] = await store.listTrials("a-s2");
        expect(killed).toMatchObject({
          completed: false,
          endedAt: lastTrial?.createdAt,
          sentChars: 2,
        });
        expect(await store.getSession("empty")).toMatchObject({
          completed: false,
          endedAt: T0 + 200_000,
        });
      });

      it("rejects a session for a missing profile or with an unknown mode", async () => {
        await expect(store.startSession(session("s", "ghost"))).rejects.toThrow();
        await store.createProfile(profile("a"));
        await expect(
          store.startSession({ ...session("s", "a"), mode: "nope" as "koch" }),
        ).rejects.toThrow();
      });
    });

    describe("char_stats", () => {
      it("a rebuild matches the incremental result exactly", async () => {
        await store.createProfile(profile("a"));
        await store.startSession(session("s", "a"));
        const answers = ["KMRS", "KMSS", "KXRS", "", "KMRSU", "MKRS"];
        for (const [i, typed] of answers.entries()) {
          await store.recordTrial(
            trial("s", "a", "KMRS", typed, {
              responseMs: i % 2 ? 450 + i * 37 : null,
              revealed: typed === "",
            }),
          );
        }
        const incremental = await store.getCharStats("a");
        expect(incremental.find((x) => x.ch === "K")?.ewmaRt).not.toBeNull();
        await store.rebuildCharStats("a");
        expect(await store.getCharStats("a")).toEqual(incremental);
      });
    });

    describe("Koch progress", () => {
      it("keeps one level per order and the full history", async () => {
        await store.createProfile(profile("a"));
        await store.setKochLevel("a", "lcwo", 2, "passed", T0 + 1);
        await store.setKochLevel("a", "lcwo", 3, "passed", T0 + 2);
        await store.setKochLevel("a", "g4fon", 5, "manual", T0 + 3);
        await store.setKochLevel("a", "lcwo", 2, "regressed", T0 + 4);
        expect(await store.getKochProgress("a")).toEqual([
          { profileId: "a", orderId: "g4fon", level: 5, updatedAt: T0 + 3 },
          { profileId: "a", orderId: "lcwo", level: 2, updatedAt: T0 + 4 },
        ]);
        expect(
          (await store.getKochHistory("a")).map((h) => [h.orderId, h.level, h.reason]),
        ).toEqual([
          ["lcwo", 2, "passed"],
          ["lcwo", 3, "passed"],
          ["g4fon", 5, "manual"],
          ["lcwo", 2, "regressed"],
        ]);
        await expect(store.setKochLevel("a", "lcwo", 0, "manual", T0)).rejects.toThrow();
      });
    });

    describe("snippets, word lists and achievements", () => {
      it("saves, renames, orders and deletes snippets", async () => {
        await store.createProfile(profile("a"));
        await store.saveSnippet(snippet("n1", "a", T0));
        await store.saveSnippet(snippet("n2", "a", T0 + 1));
        await store.saveSnippet({ ...snippet("n1", "a", T0 + 2), title: "Renamed", body: "73" });
        const list = await store.listSnippets("a");
        expect(list.map((s) => [s.id, s.title])).toEqual([
          ["n1", "Renamed"],
          ["n2", "Snippet n2"],
        ]);
        expect(list[0]).toMatchObject({ createdAt: T0, updatedAt: T0 + 2, body: "73" });
        await store.deleteSnippet("n2");
        expect((await store.listSnippets("a")).map((s) => s.id)).toEqual(["n1"]);
        await expect(store.saveSnippet({ ...snippet("n3", "a", T0), title: "" })).rejects.toThrow();
      });

      it("saves and deletes word lists", async () => {
        await store.createProfile(profile("a"));
        const list = {
          id: "w",
          profileId: "a",
          name: "Mine",
          items: [{ word: "QTH" }],
          createdAt: T0,
          updatedAt: T0,
        };
        await store.saveWordList(list);
        await store.saveWordList({
          ...list,
          items: [{ word: "QTH", meaning: "location" }],
          updatedAt: T0 + 1,
        });
        expect(await store.listWordLists("a")).toEqual([
          { ...list, items: [{ word: "QTH", meaning: "location" }], updatedAt: T0 + 1 },
        ]);
        await store.deleteWordList("w");
        expect(await store.listWordLists("a")).toEqual([]);
      });

      it("keeps the first date an achievement was earned", async () => {
        await store.createProfile(profile("a"));
        await store.grantAchievement({ profileId: "a", achievementId: "x", earnedAt: T0 });
        await store.grantAchievement({ profileId: "a", achievementId: "x", earnedAt: T0 + 9 });
        expect(await store.listAchievements("a")).toEqual([
          { profileId: "a", achievementId: "x", earnedAt: T0 },
        ]);
      });
    });

    it("reset progress keeps settings, snippets and word lists", async () => {
      await seed(store, "a");
      await store.resetProgress("a");
      expect(await store.listSessions("a")).toEqual([]);
      expect(await store.listCharEvents("a")).toEqual([]);
      expect(await store.getCharStats("a")).toEqual([]);
      expect(await store.getKochProgress("a")).toEqual([]);
      expect(await store.getKochHistory("a")).toEqual([]);
      expect(await store.listAchievements("a")).toEqual([]);
      expect(await store.getSettings("a")).not.toEqual({});
      expect(await store.listSnippets("a")).toHaveLength(1);
      expect(await store.listWordLists("a")).toHaveLength(1);
    });

    describe("export and import", () => {
      it("export → Replace import gives identical data", async () => {
        await seed(store, "p1");
        await seed(store, "p2");
        const before = await store.exportProfiles(["p1", "p2"]);
        const stats = await store.getCharStats("p1");
        await store.importProfiles(before, "replace");
        expect(await store.exportProfiles(["p1", "p2"])).toEqual(before);
        expect(await store.getCharStats("p1")).toEqual(stats);
      });

      it("export, delete the profile, import: everything is restored (QA 7)", async () => {
        await seed(store, "p1");
        const before = await store.exportProfiles(["p1"]);
        await store.deleteProfile("p1");
        const result = await store.importProfiles(before, "merge");
        expect(result).toEqual({ profiles: 1, sessions: 2 });
        const after = await store.exportProfiles(["p1"]);
        // Merge gives events fresh ids; everything else is identical.
        const noIds = (d: typeof before) =>
          d.map((p) => ({ ...p, charEvents: p.charEvents.map((e) => ({ ...e, id: 0 })) }));
        expect(noIds(after)).toEqual(noIds(before));
      });

      it("Replace wipes profiles that aren't in the file", async () => {
        await seed(store, "p1");
        const file = await store.exportProfiles(["p1"]);
        await seed(store, "p2");
        await store.importProfiles(file, "replace");
        expect((await store.listProfiles()).map((p) => p.id)).toEqual(["p1"]);
        expect(await store.listCharEvents("p2")).toEqual([]);
      });

      it("Merge adds only new records and is idempotent", async () => {
        await seed(store, "p1");
        const file = await store.exportProfiles(["p1"]);
        // A session added after the export, and a changed setting, survive the merge.
        await store.startSession(session("later", "p1", T0 + 500_000));
        await store.recordTrial(trial("later", "p1", "K", "K"));
        await store.putSettings("p1", { "display.fontScale": 2 }, T0 + 9);

        expect(await store.importProfiles(file, "merge")).toEqual({ profiles: 1, sessions: 0 });
        expect(await store.importProfiles(file, "merge")).toEqual({ profiles: 1, sessions: 0 });
        expect(await store.listSessions("p1")).toHaveLength(3);
        expect((await store.getSettings("p1"))["display.fontScale"]).toBe(2);
        expect(await store.listCharEvents("p1")).toHaveLength(
          (file[0]?.charEvents.length ?? 0) + 1,
        );
        expect(await store.getKochHistory("p1")).toHaveLength(2);
      });

      it("a failed Replace import leaves the data unchanged", async () => {
        await seed(store, "p1");
        const before = await store.exportProfiles(["p1"]);
        const [p] = before;
        if (!p) throw new Error("no export");
        // Two copies of the same profile in one file: the second insert fails.
        await expect(store.importProfiles([p, p], "replace")).rejects.toThrow();
        expect(await store.exportProfiles(["p1"])).toEqual(before);
      });
    });
  });
}
