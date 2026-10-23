import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SqlDriver, SqlValue, Statement } from "../../src/storage/sql-driver";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../src-tauri/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

/**
 * SqliteStore's driver in Node: the same migration SQL the app runs, with the
 * same connection settings sqlx applies (foreign keys on).
 */
export function betterSqliteDriver(): SqlDriver & { db: Database.Database } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATION);
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
