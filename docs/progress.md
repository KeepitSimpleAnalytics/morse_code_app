# Progress and handoff notes

Last updated 2026-10-23. Work happens on branch `v2`; nothing has been pushed yet.
`SPEC.md` is the source of truth. This file records where the build stands against
SPEC §15 and what is waiting on whom.

## Phase status

| Phase                                   | State                                                                                                 | Commit           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| 0. Scaffold                             | Done. "Windows CI green" is unverified because CI has never run (no push yet).                        | c74326b, 02c3385 |
| 1. Core                                 | Done and accepted.                                                                                    | 5a40863          |
| 2. Audio + Text Player                  | Done and accepted: QA 4 and 10 passed. Latency was measured at 50 ms (limit 40 ms), see `latency.md`. | 971fe20          |
| (extra) Live speed change while playing | Done.                                                                                                 | 09029a4          |
| 3. Storage, profiles, settings          | Built. The owner skipped QA 3 and 7 on 2026-10-23.                                                    | 8ec5d62          |
| 4. Koch, scoring UI, session flow       | Built. Waiting for the owner to run a full lesson in `pnpm tauri dev` (QA 2).                         | see git log      |
| 5. Other copy modes (trimmed)           | Not started.                                                                                          | —                |
| 6. ICR + adaptive                       | Not started.                                                                                          | —                |
| 7. Stats dashboard (trimmed)            | Not started.                                                                                          | —                |
| 8. Sending practice                     | Dropped, see SPEC §15.1.                                                                              | —                |
| 9. Realism + extras                     | Dropped, see SPEC §15.1.                                                                              | —                |
| 10. Release                             | Not started. Follows phase 7.                                                                         | —                |

## Scope cut (2026-10-23)

The owner judged v2 over-engineered and cut it back. Phase 4 and phase 6 stay in full. Phases 5 and 7 are trimmed, and phases 8 and 9 are dropped. SPEC §15 has the new scope and §15.1 lists everything deferred. Don't build anything on that list unless the owner asks.

## Open items (waiting on the owner)

1. **Phase 4 QA.**
   - **Item 2:** run a Koch lesson in `pnpm tauri dev`, score it, quit, relaunch, and check the lesson count and character tiles on the level card.
   - **Item 8:** kill the app mid-lesson (Task Manager → End task) and relaunch. The lesson's session is saved as incomplete. A Koch lesson is written as one trial when it is scored, so a killed lesson has no trial.
   - **Item 12:** minimize mid-lesson. The lesson pauses, and the hidden time isn't counted.
   - Phase 3 items 3 and 7 were skipped by the owner and are still worth doing once before release.
2. **Latency retest:** wired headphones on the Realtek analog jack. This is now low priority. The 40 ms limit only matters for sending sidetone, and sending practice (phase 8) has been dropped.
3. **Push and CI:** pushes must go out as the KeepitSimple GitHub account, never robabrown. This PC has no KeepitSimple SSH key yet, so ask the owner how to set one up. CI has never run.

## Decisions made so far (not yet revisited by the owner)

- "(" and `<KN>`, and "+" and `<AR>`, score as the same sound. Typed non-Morse characters count as wrong.
- Pause resumes at the start of the current character. A speed change while playing restarts the current character after a 250 ms debounce.
- Added the `tauri-plugin-opener` dependency, for Settings → Data → Open folder.
- v1 import stores the level on the `classic-v1` Koch order and switches the profile's Koch order to it.
- "Send snippet to Custom Practice" is deferred to Phase 5.
- The streak flame and goal ring in the top bar, and the Keys and Realism settings sections, are dropped along with phases 8 and 9. The QSO and Sending screens were removed from the sidebar, so Ctrl+1…8 now cover the modes and Settings has no number. The daily-goal slider was removed; its setting key stays so saved values remain valid.
- **Koch (phase 4, approved by the owner):**
  - A lesson is scored as one trial, with one alignment over the whole text, so losing your place doesn't wreck later groups.
  - Stopping early scores only the characters that started playing, so the unplayed rest of a group never counts as missed (owner, 2026-10-23). That lesson can't pass.
  - Lessons with under a minute of audio can't pass.
  - "Practice these characters" is hidden until phase 5 (it needs Random Groups).
  - During a lesson, only the timer and the typing box show.
- **Koch (my calls):**
  - When the last group has played, the lesson waits for you to finish typing, then Enter scores it.
  - Pause (a button, a hidden window, or leaving the screen) replays the interrupted group on resume.
  - The new-character intro shows once per level and order (`koch.introSeen`); level 1 introduces K and M.
  - A lesson starts with 1.5 s of silence to get ready.
  - The step-back check only counts lessons since the level was last changed.
  - Speed and tone come from the existing speed chip in the top bar; the lesson card has no speed control of its own.
  - "Best lesson here", the lesson count and the step-back check only count lessons with at least a minute of audio (the snapshot records `audioMs`).
  - Profiles saved on the removed QSO or Sending screens open on Koch, without an invalid-setting warning.
  - Koch and the Text Player share one keying scheduler (`src/audio/shared.ts`).

## How Phase 4 is put together

- `src/core/lesson.ts`: planning a timed lesson from the seed, played-groups and resume maths, pass/step-back rules, and the weakest-characters summary. Tests are in `tests/core/lesson.test.ts`.
- `src/features/koch/controller.ts`: the lesson state machine, the database writes and the level changes. `store.ts` holds its state, and `KochScreen.tsx` is the UI. Tests are in `tests/features/koch/`.
- Settings keys: `koch.lengthKind`, `koch.minutes`, `koch.groups`, `koch.groupSize` and `koch.introSeen`.
- Concurrency: every awaiting action takes a ticket from `epoch`. Pause, Stop, leaving the screen and a profile switch move it on, so a stale action gives up after its await. Saving records `trialSaved` and `sessionClosed` on the running lesson, so a retry never writes twice.
- A failure after the lesson is saved (moving up, or the step-back check) shows on the results screen. It never sends the user back.

## How Phase 3 is put together

- **Rust (`src-tauri/src`)**
  - `backup.rs`: DB path, `VACUUM INTO` backups, keep the newest 14, staged restore that is applied at the next startup.
  - `db.rs`: the `db_transaction` command. The SQL plugin pools connections, so BEGIN/COMMIT sent from JS is not one transaction; this command runs a batch on one connection inside a real transaction.
  - `lib.rs`: plugins, migrations and the startup report.
  - Schema: `migrations/0001_init.sql`.
- **Storage (`src/storage`)**
  - `store.ts` is the `Store` interface, with two implementations: `sqlite.ts` (through `tauri-driver.ts`) and `memory.ts`.
  - Both run the same suite, `tests/storage/contract.ts`. SqliteStore runs in Node on better-sqlite3 with the same migration file.
  - Export/import is in `export.ts` and `schemas.ts` (zod); v1 import is in `import-v1.ts`.
- **App state**
  - `src/state/app.ts`: phase, store, profiles, notices.
  - `src/state/settings.ts`: debounced writer (300 ms).
  - `src/state/settings-schema.ts`: every per-profile key with its default.
  - `src/app/boot.ts`: opens SQLite, or the fatal screen; MemoryStore only for `pnpm dev:web`.
  - `src/app/session.ts`: profile lifecycle.
  - `src/app/bindings.ts`: saves Player fields, the current screen and the theme.
  - `src/app/data-actions.ts`: everything in Settings → Data.
- **UI**
  - `src/features/onboarding`, `src/features/settings`, `src/features/profiles`.
  - `src/features/player/Snippets.tsx`.
  - Shared primitives in `src/components/ui.tsx`.

## Picking up again

1. Read `CLAUDE.md`, then this file, then the SPEC section for the next phase.
2. Ask the owner for the open items above.
3. Run `pnpm i`, then `pnpm test`, `pnpm lint`, `pnpm typecheck`. In `src-tauri/`, run `cargo test` and `cargo clippy --all-targets -- -D warnings`. All of these pass at the phase 4 commit: 274 TS tests and 8 Rust tests.
4. `pnpm tauri dev` runs the app.
   - The database is `%APPDATA%\com.keepitsimpleanalytics.morsetrainer\morse-trainer.db`, with backups in `backups\` next to it.
   - For screenshots, use `pnpm dev:web` with `?demo=<screen id>`.
5. Next is Phase 5 (trimmed, SPEC §15): Random Groups, Words, Callsigns and Custom Practice. It reuses the copy-mode pieces from phase 4: the diff and results panel in `KochScreen.tsx`, and `buildTrialRecord`. Also wire up "Practice these characters" on the Koch results.
