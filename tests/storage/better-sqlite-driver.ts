import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDriver, SqlValue, Statement } from "../../src/storage/sql-driver";

const DIR = fileURLToPath(new URL("../../src-tauri/migrations/", import.meta.url));
/** Every migration, in version order (the file names start with it). */
const MIGRATIONS = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"));

/**
 * SqliteStore's driver in Node: the same migration SQL the app runs, with the
 * same connection settings sqlx applies (foreign keys on).
 */
export function betterSqliteDriver(): SqlDriver & { db: Database.Database } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);
  const run = db.transaction((statements: readonly Statement[]) => {
    for (const st of statements) db.prepare(st.sql).run(...((st.params ?? []) as SqlValue[]));
  });
  return {
    db,
    select: (sql, params = []) =>
      Promise.resolve(db.prepare(sql).all(...(params as SqlValue[])) as Record<string, unknown>[]),
    // A throw inside the executor becomes the rejection, like a failed IPC call.
    transaction: (statements) =>
      new Promise<void>((resolve) => {
        run(statements);
        resolve();
      }),
  };
}
