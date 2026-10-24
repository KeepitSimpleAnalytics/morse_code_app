# Cutting a release

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed. Pushes must go out as the KeepitSimple GitHub account (see `docs/progress.md`, open item 3).

## One-time setup

None. `release.yml` asks for `contents: write` itself, so the repository's default token can stay read-only. No secrets are needed: the installer isn't code-signed (SPEC §16 Q3), the macOS app is only ad-hoc signed, and there is no updater yet.

## Steps

1. **Bump the version** in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src/app/version.ts`. `tests/app/version.test.ts` fails if they differ, and the release workflow refuses a tag that doesn't match.
2. **Dependencies:** if any changed since the last release, run `pnpm licenses:gen` and commit `src/data/third-party-licenses.json`. `tests/data/licenses.test.ts` fails while it is stale. If the script stops because a package ships no licence file, save its repository's licence text as `scripts/licence-texts/<owner>__<repo>.txt`, starting with a line that says where it came from.
3. **Checks:** run every check in the README's Development section, then commit.
4. **Tag and push:**
   ```sh
   git tag v2.0.0
   git push origin v2.0.0
   ```
5. **Wait for the workflow.** It checks the tag against the version, runs the same checks as CI, and creates a **draft** release, "Morse Trainer v2.0.0", with the notes from `.github/release-notes.md`. The draft holds:
   - the NSIS installer, `Morse.Trainer_2.0.0_x64-setup.exe` (the primary asset);
   - the universal `.dmg`, labelled untested. The macOS job is best-effort; if it fails, the release still has the Windows installer.
6. **Run the manual QA checklist** (SPEC §14.3) on Windows against the installer from the draft. Item 6 (sending) is skipped because sending practice was dropped. Item 11 needs a real install, uninstall and reinstall.
7. **Publish the draft.** Only a published release counts as "latest" on GitHub, so the README's download link only finds it after this step.

## If a tag needs redoing

Delete the draft release and the tag on GitHub, delete the tag locally (`git tag -d v2.0.0`), fix the problem, then tag again.

## Not set up yet

- **Auto-update** (deferred by the owner on 2026-10-24). Until then, Settings → About links to the releases page. Wiring it up needs:
  - `tauri-plugin-updater`, and an updater signing key. The private key and its password go in the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets, and the public key in `tauri.conf.json`.
  - `bundle.createUpdaterArtifacts`.
  - Once that is set, CI's debug build must pass `--no-sign`.
- **Code signing** of the Windows installer (SPEC §16 Q3).
