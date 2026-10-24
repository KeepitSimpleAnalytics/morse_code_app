# Morse Trainer

A desktop app for learning Morse code (CW) by ear. It runs on Windows 10 and 11.

- **Koch lessons:** start with two characters at full speed and add one at a time as you pass.
- **Instant Character Recognition:** one character, one keypress. It builds the reflex from sound straight to letter, and tracks your response time per character.
- **Copy practice:** random groups, words and abbreviations, Q-codes, callsigns, or your own text.
- **Text Player:** play any text as Morse, loop it, type to transmit, and save it as a WAV file.
- **Stats:** accuracy per character, what you mishear each one as, and your session history. "Practise my weak characters" drills the ones you get wrong.

Everything stays on your computer. There is no account and nothing is sent anywhere.

## Install (Windows)

1. Open the [latest release](https://github.com/KeepitSimpleAnalytics/morse_code_app/releases/latest) and download the file ending in `_x64-setup.exe`.
2. Run it. It installs for your user only, so it doesn't need admin rights.
3. **"Windows protected your PC":** the installer isn't code-signed, so SmartScreen may stop it the first time. Click **More info**, then **Run anyway**. This only happens once per download.
4. If your PC lacks the WebView2 runtime (rare on Windows 11), the installer downloads it for you.

### Updating

There's no automatic update yet. **Settings → About → Releases** opens the releases page. Download and run the newer installer: it replaces the app and keeps your progress.

### Your data

- Your profiles and progress are in `%APPDATA%\com.keepitsimpleanalytics.morsetrainer\morse-trainer.db`.
- The app backs this file up on the first launch of each day, before an update changes its format, and before a Replace import, a progress reset, a profile delete or a restore. The 14 newest copies are kept in the `backups` folder next to it.
- **Settings → Data** can open that folder, export your profiles to a file, import them again, and restore a backup.

### Uninstalling

Use **Settings → Apps → Installed apps → Morse Trainer → Uninstall**. Your progress is kept, so a reinstall picks up where you left off. To remove it as well, tick **Delete the application data** in the uninstaller.

## macOS

A `.dmg` is built for each release, but it **has not been tested**. It isn't notarised: if macOS refuses to open it, go to **System Settings → Privacy & Security** and click **Open Anyway**.

## Licence

Morse Trainer is released under the [MIT licence](LICENSE).

- **Bundled data:** the Koch orders, word lists, Q-codes and callsign prefixes are credited in [`src/data/README.md`](src/data/README.md).
- **Third-party software:** the open-source packages the app is built with are listed, with their licences, in **Settings → About → Licences**.

## Development

The app is built with Tauri 2, React 18, TypeScript and SQLite.

- **Specification:** [`SPEC.md`](SPEC.md) is the source of truth.
- **Working rules:** [`CLAUDE.md`](CLAUDE.md).
- **Build status and handoff notes:** [`docs/progress.md`](docs/progress.md).
- **Cutting a release:** [`docs/release.md`](docs/release.md).
- **v1:** the old static web app is kept for reference in [`legacy/v1/`](legacy/v1/).

**Prerequisites (Windows):**

- Rust stable (MSVC), 1.90 or later, and the Visual Studio C++ build tools.
- WebView2.
- Node 20 or later.

pnpm is pinned through `packageManager`, so run `corepack enable pnpm` once. If that fails with EPERM, add `--install-directory "$env:APPDATA\npm"`.

```sh
pnpm i              # install
pnpm tauri dev      # run the desktop app
pnpm dev:web        # browser-only session on an in-memory store (nothing saved)
pnpm test           # unit tests (Vitest)
pnpm lint           # ESLint
pnpm typecheck      # tsc
pnpm format         # Prettier (format:check in CI)
pnpm licenses:gen   # regenerate the third-party licence list after changing dependencies

cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
