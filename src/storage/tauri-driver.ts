import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { SqlDriver, Statement } from "./sql-driver";

/** Must match `backup::DB_URL` in src-tauri. */
export const DB_URL = "sqlite:morse-trainer.db";

/**
 * Opens the app database through the SQL plugin, which runs the Rust migrations
 * on load. Reads go through the plugin; writes go through `db_transaction`, which
 * runs a batch on one pooled connection inside a real transaction (SPEC §9.4).
 */
export async function openTauriDriver(): Promise<SqlDriver> {
  const db = await Database.load(DB_URL);
  // WAL is a property of the database file, so setting it once covers every connection.
  const [mode] = await db.select<{ journal_mode?: string }[]>("PRAGMA journal_mode = WAL");
  if (mode?.journal_mode?.toLowerCase() !== "wal") {
    throw new Error(`could not enable WAL mode (got ${String(mode?.journal_mode)})`);
  }
  return {
    select: (sql, params = []) => db.select<Record<string, unknown>[]>(sql, [...params]),
    transaction: async (statements: readonly Statement[]) => {
      await invoke("db_transaction", {
        statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      });
    },
  };
}
