# Morse Trainer v2

The full specification is in `SPEC.md`. It is the source of truth: read it before doing any work, and build in the phase order in §15.

## Context

- v1 was a static web app served by nginx in Docker. It moves to `legacy/v1/` in phase 0 and is kept for reference only. §3 maps every v1 feature to its v2 location, and §4 lists the v1 bugs that must not come back.
- v2 is Tauri 2 + React 18 + TypeScript (strict) + Vite + Zustand, with SQLite through `tauri-plugin-sql`.
- Windows 10/11 is the primary platform and the intended user's OS. Releases are gated on it.
- macOS is secondary: it must compile in CI but is best-effort (SPEC §1.3). Keep code portable: Tauri path APIs, `cfg`-guarded platform code.

## Rules

- `src/core/` is pure TypeScript: no DOM, Web Audio or Tauri imports. Unit-test everything in it.
- No silent fallbacks. The only non-SQLite storage is `MemoryStore`, used for tests and for `pnpm dev:web`, and it shows a visible banner.
- Audio uses one shared `AudioContext` with a lookahead scheduler (§6). Never create a context per playback.
- Write each trial in a single transaction as soon as it is scored (§9.4).
- Each bundled data file records its source and license in `src/data/README.md`.

## Commands

pnpm is pinned to 10.x through `packageManager` and run via corepack. pnpm 12 ships `pnpm.mjs`, which corepack 0.33 can't launch. On this machine the shim lives in `%APPDATA%\npm`, because `corepack enable` can't write to Program Files.

- `pnpm i`: install (CI uses `--frozen-lockfile`)
- `pnpm tauri dev`: run the desktop app (Vite on :1420)
- `pnpm dev:web`: browser-only session on MemoryStore (red banner, nothing saved). `?demo=<screen id>` opens a throwaway profile on that screen, for screenshots
- `pnpm test`: Vitest, specs in `tests/`. Node environment by default; UI specs opt in with `// @vitest-environment jsdom`
- `pnpm lint`: ESLint, zero warnings allowed. It also enforces the `src/core` purity rule
- `pnpm typecheck`: tsc for the app/tests and for the Node config files
- `pnpm format` / `pnpm format:check`: Prettier
- In `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
- `pnpm tauri icon design/icon.svg -o src-tauri/icons`: regenerate icons, then delete the `android/` and `ios/` output
