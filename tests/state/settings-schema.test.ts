import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/storage/memory";
import { SqliteStore } from "../../src/storage/sqlite";
import {
  defaultSettings,
  hydrateSettings,
  SETTING_KEYS,
  SETTINGS,
  validateSetting,
} from "../../src/state/settings-schema";
import { betterSqliteDriver } from "../storage/better-sqlite-driver";
import { profile, T0 } from "../storage/contract";

describe("settings hydration", () => {
  it("every default passes its own schema", () => {
    for (const key of SETTING_KEYS) {
      expect(SETTINGS[key].schema.safeParse(SETTINGS[key].default).success, key).toBe(true);
    }
  });

  it("missing keys take their defaults", () => {
    expect(hydrateSettings({})).toEqual({ values: defaultSettings(), invalid: [], unknown: [] });
  });

  for (const [name, make] of [
    ["MemoryStore", () => new MemoryStore()],
    ["SqliteStore", () => new SqliteStore(betterSqliteDriver())],
  ] as const) {
    it(`effective below character speed survives a save and reload (v1 defect #1, ${name})`, async () => {
      const store = make();
      await store.createProfile(profile("p"));
      const values = { ...defaultSettings(), "timing.speeds": { charWpm: 25, effWpm: 12 } };
      await store.putSettings("p", values, T0);
      const { values: loaded, invalid } = hydrateSettings(await store.getSettings("p"));
      expect(invalid).toEqual([]);
      expect(loaded).toEqual(values);
      expect(loaded["timing.speeds"]).toEqual({ charWpm: 25, effWpm: 12 });
    });
  }

  it("reports invalid saved values instead of repairing them, and keeps unknown keys out", () => {
    const { values, invalid, unknown } = hydrateSettings({
      "timing.speeds": { charWpm: 20, effWpm: 30 },
      "audio.toneHz": 5000,
      "display.showCode": "after",
      "future.setting": 1,
    });
    expect(invalid.map((i) => i.key)).toEqual(["timing.speeds", "audio.toneHz"]);
    expect(invalid[0]?.message).toMatch(/effWpm/);
    expect(values["timing.speeds"]).toEqual(defaultSettings()["timing.speeds"]);
    expect(unknown).toEqual(["future.setting"]);
  });

  it("validates a value before it is set", () => {
    expect(validateSetting("learning.passThreshold", 0.95)).toBe(0.95);
    expect(() => validateSetting("learning.passThreshold", 0.5)).toThrow();
    expect(() => validateSetting("player.speeds", { charWpm: 20, effWpm: 2 })).toThrow();
  });
});
