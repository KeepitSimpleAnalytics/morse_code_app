# Morse Trainer v2

A desktop app for learning Morse code (CW): Koch lessons, instant character recognition, copy practice, a Text Player and sending practice. Built with Tauri 2, React 18 and TypeScript.

Windows 10/11 is the primary platform. macOS is built in CI but untested.

- **Specification:** [`SPEC.md`](SPEC.md) is the source of truth.
- **Working rules:** [`CLAUDE.md`](CLAUDE.md).
- **v1** (the static web app) is kept for reference in [`legacy/v1/`](legacy/v1/).

## Status

- **Phase 0 (scaffold):** done. App shell, theme tokens, tooling and CI.
- **Phase 1 (core):** done. `src/core/` has the alphabet, tokenizer, timing, timeline, seeded RNG, per-character scoring, adaptive weighting, Koch orders (verified against their sources; see `src/data/README.md`) and the group generators.

The modes arrive in the phases listed in SPEC §15.

## Development

Prerequisites (Windows): Rust stable (MSVC) 1.90+, the Visual Studio C++ build tools, WebView2, and Node 20+. pnpm is pinned via `packageManager`; run `corepack enable pnpm` once. If that fails with EPERM, add `--install-directory "$env:APPDATA\npm"`.

```sh
pnpm i              # install
pnpm tauri dev      # run the desktop app
pnpm test           # unit tests (Vitest)
pnpm lint           # ESLint
pnpm typecheck      # tsc
pnpm format         # Prettier (format:check in CI)

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The release README (with install notes for Windows SmartScreen) is written in phase 10.
