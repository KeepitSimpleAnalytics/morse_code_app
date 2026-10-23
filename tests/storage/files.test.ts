import { beforeEach, describe, expect, it } from "vitest";
import {
  buildExportFile,
  describeSummary,
  exportFileName,
  parseExportFile,
  summarizeExport,
} from "../../src/storage/export";
import { applyV1Import, parseV1Progress, planV1Import } from "../../src/storage/import-v1";
import { MemoryStore } from "../../src/storage/memory";
import { SqliteStore } from "../../src/storage/sqlite";
import type { Store } from "../../src/storage/store";
import { betterSqliteDriver } from "./better-sqlite-driver";
import { profile, seed, T0 } from "./contract";

describe("export file", () => {
  let store: Store;
  beforeEach(async () => {
    store = new SqliteStore(betterSqliteDriver());
    await seed(store, "p1");
    await seed(store, "p2");
  });

  it("round-trips through JSON text and summarizes", async () => {
    const file = buildExportFile(await store.exportProfiles(["p1", "p2"]), "2.0.0", T0);
    const parsed = parseExportFile(JSON.stringify(file));
    expect(parsed).toEqual(file);
    const summary = summarizeExport(parsed);
    expect(describeSummary(summary)).toBe("2 profiles, 4 sessions");
    expect(summary.profiles.map((p) => p.name)).toEqual(["Op p1", "Op p2"]);
  });

  it("imports into a fresh SQLite database identically", async () => {
    const file = buildExportFile(await store.exportProfiles(["p1", "p2"]), "2.0.0", T0);
    const other = new SqliteStore(betterSqliteDriver());
    await other.importProfiles(parseExportFile(JSON.stringify(file)).profiles, "replace");
    expect(await other.exportProfiles(["p1", "p2"])).toEqual(file.profiles);
    expect(await other.getCharStats("p1")).toEqual(await store.getCharStats("p1"));
  });

  it("rejects files that aren't exports, with a reason", () => {
    expect(() => parseExportFile("not json")).toThrow(/valid JSON/);
    expect(() => parseExportFile("{}")).toThrow(/isn't a Morse Trainer export/);
    expect(() =>
      parseExportFile(JSON.stringify({ format: "morse-trainer-export", formatVersion: 9 })),
    ).toThrow(/newer version/);
    expect(() =>
      parseExportFile(
        JSON.stringify({ format: "morse-trainer-export", formatVersion: 1, profiles: [{}] }),
      ),
    ).toThrow(/doesn't match/);
  });

  it("rejects records that point at another profile or a missing session", async () => {
    const file = buildExportFile(await store.exportProfiles(["p1", "p2"]), "2.0.0", T0);
    const [a, b] = file.profiles;
    if (!a || !b) throw new Error("seed");
    const crossed = { ...file, profiles: [{ ...a, sessions: [...a.sessions, ...b.sessions] }] };
    expect(() => parseExportFile(JSON.stringify(crossed))).toThrow(/sessions of another profile/);
    const orphan = { ...file, profiles: [{ ...a, sessions: [] }] };
    expect(() => parseExportFile(JSON.stringify(orphan))).toThrow(/has no session/);
    const twice = { ...file, profiles: [a, a] };
    expect(() => parseExportFile(JSON.stringify(twice))).toThrow(/appears twice/);
  });

  it("names files after the profile and local date", () => {
    expect(exportFileName("Rob Brown", new Date(2026, 9, 3))).toBe(
      "morse-trainer-rob-brown-2026-10-03.json",
    );
    expect(exportFileName("Ü", new Date(2026, 0, 1))).toBe("morse-trainer-profile-2026-01-01.json");
  });
});

describe("v1 import", () => {
  const v1 = JSON.stringify({
    kochLevel: 7,
    charSpeed: 22,
    effectiveSpeed: 14,
    farnsworthLocked: false,
    frequency: 650,
    stats: { correct: 31, incorrect: 9, kochAccuracy: { level_7: { correct: 3, total: 4 } } },
  });

  it("maps level, speeds, tone and totals (SPEC §9.6)", () => {
    const plan = planV1Import(parseV1Progress(v1), "p", T0, () => "s-v1");
    expect(plan.settings).toEqual({
      "learning.kochOrder": "classic-v1",
      "timing.speeds": { charWpm: 22, effWpm: 14 },
      "audio.toneHz": 650,
    });
    expect(plan.kochLevel).toBe(7);
    expect(plan.session).toMatchObject({
      id: "s-v1",
      mode: "koch",
      completed: true,
      sentChars: 0,
      accuracy: 31 / 40,
      settingsSnapshot: { imported: "v1", v1Correct: 31, v1Incorrect: 9, level: 7 },
    });
    expect(plan.lines).toHaveLength(4);
  });

  it("keeps a linked v1 speed linked, and skips empty totals", () => {
    const plan = planV1Import(
      parseV1Progress(
        JSON.stringify({ charSpeed: 18, effectiveSpeed: 25, stats: { correct: 0, incorrect: 0 } }),
      ),
      "p",
      T0,
      () => "x",
    );
    expect(plan.settings["timing.speeds"]).toEqual({ charWpm: 18, effWpm: 18 });
    expect(plan.session).toBeNull();
    expect(plan.kochLevel).toBeNull();
  });

  it("accepts the text wrapped in quotes", () => {
    expect(parseV1Progress(JSON.stringify(v1)).kochLevel).toBe(7);
  });

  it("explains what's wrong with bad input", () => {
    expect(() => parseV1Progress("")).toThrow(/Paste/);
    expect(() => parseV1Progress("hello")).toThrow(/isn't the v1 progress/);
    expect(() => parseV1Progress("{}")).toThrow(/no v1 progress/);
    expect(() => parseV1Progress(JSON.stringify({ kochLevel: 99 }))).toThrow(/kochLevel/);
    expect(() => parseV1Progress(JSON.stringify({ charSpeed: 2 }))).toThrow(/charSpeed/);
  });

  for (const [name, make] of [
    ["MemoryStore", () => new MemoryStore()],
    ["SqliteStore", () => new SqliteStore(betterSqliteDriver())],
  ] as const) {
    it(`writes the plan into a profile (${name})`, async () => {
      const store: Store = make();
      const p = profile("p");
      await store.createProfile(p);
      await store.putSettings("p", { "timing.speeds": { charWpm: 30, effWpm: 30 } }, T0);
      await applyV1Import(
        store,
        p,
        planV1Import(parseV1Progress(v1), "p", T0 + 1, () => "s-v1"),
        T0 + 1,
      );

      expect(await store.getSettings("p")).toMatchObject({
        "timing.speeds": { charWpm: 22, effWpm: 14 },
        "learning.kochOrder": "classic-v1",
      });
      expect(await store.getKochProgress("p")).toEqual([
        { profileId: "p", orderId: "classic-v1", level: 7, updatedAt: T0 + 1 },
      ]);
      expect((await store.getKochHistory("p"))[0]?.reason).toBe("imported");
      const [s] = await store.listSessions("p");
      expect(s).toMatchObject({ id: "s-v1", completed: true, endedAt: T0 + 1 });
      expect(await store.listCharEvents("p")).toEqual([]);
    });
  }
});
