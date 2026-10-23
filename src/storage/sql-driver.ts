/**
 * The minimum SqliteStore needs from a SQLite connection. Production uses the
 * Tauri SQL plugin (tauri-driver.ts); tests use better-sqlite3 with the same
 * migration file.
 */

export type SqlValue = string | number | null;

export interface Statement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

export interface SqlDriver {
  select(sql: string, params?: readonly SqlValue[]): Promise<Record<string, unknown>[]>;
  /** Runs all statements in one transaction; any failure rolls back all of them. */
  transaction(statements: readonly Statement[]): Promise<void>;
}

/** SQLite allows 32 766 bound parameters per statement; stay well below. */
const MAX_PARAMS = 30000;

/** Multi-row INSERTs for bulk loads (import), chunked under the parameter limit. */
export function insertMany(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly SqlValue[])[],
  verb: "INSERT" | "INSERT OR IGNORE" = "INSERT",
): Statement[] {
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const out: Statement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    out.push({
      sql: `${verb} INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => tuple).join(", ")}`,
      params: chunk.flat(),
    });
  }
  return out;
}
