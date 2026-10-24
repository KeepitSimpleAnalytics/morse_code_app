// The inputs third-party-licenses.json is generated from, hashed. Shared by
// scripts/licenses.mjs (which records it) and tests/data/licenses.test.ts
// (which fails when it no longer matches).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OVERRIDES = join(ROOT, "scripts/licence-texts");

/**
 * Hash of both lockfiles, the generator and the stored upstream texts. Line
 * endings are normalised so a Windows checkout matches.
 */
export function inputsHash(root = ROOT) {
  const files = [
    "pnpm-lock.yaml",
    "src-tauri/Cargo.lock",
    "scripts/licenses.mjs",
    ...readdirSync(join(root, "scripts/licence-texts"))
      .sort()
      .map((f) => `scripts/licence-texts/${f}`),
  ];
  const h = createHash("sha256");
  for (const f of files) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"));
  }
  return h.digest("hex");
}
