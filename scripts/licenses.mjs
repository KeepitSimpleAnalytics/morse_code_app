// Writes src/data/third-party-licenses.json: every npm production package and
// Rust crate the app ships, with its licence text (SPEC §15, phase 10).
//
//   pnpm licenses:gen
//
// Run it after changing dependencies. tests/data/licenses.test.ts fails while
// the lockfiles, this script or scripts/licence-texts/ differ from what the file
// was generated from.
//
// A package must come with its licence text. When a published package ships no
// licence file, its repository's text is kept in scripts/licence-texts/
// <owner>__<repo>.txt (fetched from the repository, with a note of where from),
// and the crate is listed in OVERRIDE_FOR.
// If neither exists, this fails rather than list a package without its text.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inputsHash, OVERRIDES, ROOT } from "./licenses-hash.mjs";

const OUT = join(ROOT, "src/data/third-party-licenses.json");
/** Windows ships; macOS is built in CI too, so its crates are listed as well. */
const TARGETS = ["x86_64-pc-windows-msvc", "aarch64-apple-darwin", "x86_64-apple-darwin"];
const LICENCE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicen[cs]e)([-._].*)?$/i;

function run(cmd, args, cwd = ROOT) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** The pnpm that launched this script (`pnpm licenses:gen`), run through Node. */
function pnpm(args) {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm/i.test(cli)) throw new Error("Run this through pnpm: pnpm licenses:gen");
  return run(process.execPath, [cli, ...args]);
}

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim();

/** Licence files in a package folder (plus a declared `license_file`), joined, or null. */
function licenceText(dir, declared) {
  if (!existsSync(dir)) return null;
  const files = new Set(readdirSync(dir).filter((f) => LICENCE_FILE.test(f)));
  if (declared && existsSync(join(dir, declared))) files.add(declared);
  if (files.size === 0) return null;
  return [...files]
    .sort()
    .map((f) => read(join(dir, f)))
    .join("\n\n");
}

/**
 * Crates that publish no licence file, and the stored text of their repository.
 * Listed by name so a new crate from the same repository still has to be
 * checked and added here, rather than picking a text up unseen.
 */
const OVERRIDE_FOR = {
  "alloc-stdlib": "dropbox__rust-alloc-no-stdlib",
  block2: "madsmtm__objc2",
  "crc-catalog": "akhilles__crc-catalog",
  dispatch2: "madsmtm__objc2",
  objc2: "madsmtm__objc2",
  "objc2-app-kit": "madsmtm__objc2",
  "objc2-core-foundation": "madsmtm__objc2",
  "objc2-core-graphics": "madsmtm__objc2",
  "objc2-encode": "madsmtm__objc2",
  "objc2-exception-helper": "madsmtm__objc2",
  "objc2-foundation": "madsmtm__objc2",
  "objc2-io-surface": "madsmtm__objc2",
  "objc2-quartz-core": "madsmtm__objc2",
  "objc2-web-kit": "madsmtm__objc2",
  selectors: "servo__stylo",
  "tauri-plugin": "tauri-apps__tauri",
  "webview2-com": "wravery__webview2-rs",
  "webview2-com-macros": "wravery__webview2-rs",
  "webview2-com-sys": "wravery__webview2-rs",
};

/** The stored text for a crate listed in OVERRIDE_FOR, or null. */
function overrideText(name) {
  if (!Object.hasOwn(OVERRIDE_FOR, name)) return null;
  const file = join(OVERRIDES, `${OVERRIDE_FOR[name]}.txt`);
  if (!existsSync(file)) throw new Error(`${name}: ${file} is missing`);
  return read(file);
}

function npmPackages() {
  const byLicence = JSON.parse(pnpm(["licenses", "list", "--prod", "--json"]));
  const list = [];
  for (const entries of Object.values(byLicence)) {
    for (const p of entries) {
      p.versions.forEach((version, i) => {
        list.push({
          source: "npm",
          name: p.name,
          version,
          license: p.license,
          homepage: p.homepage ?? null,
          dir: p.paths[i] ?? p.paths[0],
          declared: null,
        });
      });
    }
  }
  return list;
}

/** Crates linked into the app on `target`: normal and build deps from the root. */
function cratesFor(target) {
  const meta = JSON.parse(
    run(
      "cargo",
      ["metadata", "--format-version", "1", "--locked", "--filter-platform", target],
      join(ROOT, "src-tauri"),
    ),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const queue = [meta.resolve.root];
  while (queue.length > 0) {
    const id = queue.pop();
    for (const dep of nodes.get(id)?.deps ?? []) {
      const shipped = dep.dep_kinds.some((k) => k.kind === null || k.kind === "build");
      if (shipped && !seen.has(dep.pkg)) {
        seen.add(dep.pkg);
        queue.push(dep.pkg);
      }
    }
  }
  return [...seen].map((id) => {
    const p = byId.get(id);
    if (!p.license && !p.license_file) {
      throw new Error(`${p.name} ${p.version} declares no licence`);
    }
    return {
      source: "crate",
      name: p.name,
      version: p.version,
      license: p.license ?? `see ${p.license_file}`,
      homepage: p.repository ?? p.homepage ?? null,
      dir: dirname(p.manifest_path),
      declared: p.license_file ?? null,
    };
  });
}

function main() {
  const crates = new Map();
  for (const t of TARGETS) {
    for (const c of cratesFor(t)) crates.set(`${c.name}@${c.version}`, c);
  }
  const all = [...npmPackages(), ...crates.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );

  // Most crates share the same Apache/MIT text, so each text is stored once.
  const texts = [];
  const index = new Map();
  const missing = [];
  let fromRepo = 0;
  const packages = all.map(({ dir, declared, ...p }) => {
    let text = licenceText(dir, declared);
    if (text === null) {
      text = overrideText(p.name);
      if (text !== null) fromRepo++;
    }
    if (text === null) {
      missing.push(`${p.name} ${p.version} (${p.homepage ?? "no repository"})`);
      return null;
    }
    if (!index.has(text)) {
      index.set(text, texts.length);
      texts.push(text);
    }
    return { ...p, text: index.get(text) };
  });

  if (missing.length > 0) {
    throw new Error(
      `No licence text for ${missing.length} package(s). Save the repository's text as ` +
        `scripts/licence-texts/<owner>__<repo>.txt and list the crate in OVERRIDE_FOR:\n  ` +
        missing.join("\n  "),
    );
  }

  writeFileSync(
    OUT,
    `${JSON.stringify({ inputsHash: inputsHash(), packages, texts }, null, 1)}\n`,
    "utf8",
  );
  console.log(
    `${packages.length} packages (${crates.size} crates), ${texts.length} distinct licence texts; ` +
      `${fromRepo} from scripts/licence-texts/.`,
  );
}

main();
