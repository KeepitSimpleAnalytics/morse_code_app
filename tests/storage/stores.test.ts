import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/storage/memory";
import { SqliteStore } from "../../src/storage/sqlite";
import { betterSqliteDriver } from "./better-sqlite-driver";
import { storeContract } from "./contract";

storeContract("MemoryStore", () => new MemoryStore());
storeContract("SqliteStore", () => new SqliteStore(betterSqliteDriver()));

describe("SqliteStore query plans", () => {
  it("reads ICR's newest answers through the mode index, without sorting", () => {
    const { db } = betterSqliteDriver();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM char_events
          WHERE profile_id = ? AND mode = ? AND outcome = ? AND response_ms IS NOT NULL
          ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all("a", "icr", "correct", 200) as { detail: string }[];
    const details = plan.map((r) => r.detail).join("\n");
    expect(details).toContain("idx_char_events_profile_mode_ts");
    expect(details).not.toContain("TEMP B-TREE");
  });
});
