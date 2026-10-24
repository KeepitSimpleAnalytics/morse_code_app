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
| 5. Other copy modes (trimmed)           | Built. Waiting for the owner to complete and persist a session in each mode in `pnpm tauri dev`.      | see git log      |
| 6. ICR + adaptive                       | Built. Waiting for the owner to run QA 5 (ICR timing feels immediate, no stutter over 50 characters). | see git log      |
| 7. Stats dashboard (trimmed)            | Built, and the code review's 13 fixes are done and re-reviewed.                                       | see git log      |
| (extra) Themes                          | Done: Dark (default), Light, High contrast, Night red, Green terminal, System default.                | see git log      |
| 8. Sending practice                     | Dropped, see SPEC §15.1.                                                                              | —                |
| 9. Realism + extras                     | Dropped, see SPEC §15.1.                                                                              | —                |
| 10. Release                             | Not started. Follows phase 7.                                                                         | —                |

## Scope cut (2026-10-23)

The owner judged v2 over-engineered and cut it back. Phase 4 and phase 6 stay in full. Phases 5 and 7 are trimmed, and phases 8 and 9 are dropped. SPEC §15 has the new scope and §15.1 lists everything deferred. Don't build anything on that list unless the owner asks.

## Open items (waiting on the owner)

0. The owner tried the app in `pnpm tauri dev` on 2026-10-23 and said it "looks good". The formal QA items below haven't been confirmed one by one.

1. **QA for phases 4 to 6.**
   - **Phase 6, QA 5:** run a 50-character ICR round in `pnpm tauri dev`. Timing should feel immediate, with no stutter. Then check the round summary: if it says some times were estimated, WebView2 didn't report its output timestamp (`AudioEngine.heardAt`), so tell me.
   - **Phase 5:** complete one session in each of Random Groups, Words, Callsigns and Custom. Quit, relaunch, and check the sessions are saved.
   - **Phase 4:** the items below.
   - **Item 2:** run a Koch lesson in `pnpm tauri dev`, score it, quit, relaunch, and check the lesson count and character tiles on the level card.
   - **Item 8:** kill the app mid-lesson (Task Manager → End task) and relaunch. The lesson's session is saved as incomplete. A Koch lesson is written as one trial when it is scored, so a killed lesson has no trial.
   - **Item 12:** minimize mid-lesson. The lesson pauses, and the hidden time isn't counted.
   - Phase 3 items 3 and 7 were skipped by the owner and are still worth doing once before release.
2. **Latency retest:** wired headphones on the Realtek analog jack. This is now low priority. The 40 ms limit only matters for sending sidetone, and sending practice (phase 8) has been dropped.
3. **Push and CI:** pushes must go out as the KeepitSimple GitHub account, never robabrown. This PC has no KeepitSimple SSH key yet, so ask the owner how to set one up. CI has never run.

## Decisions made so far (not yet revisited by the owner)

- **Phase 5 (owner, 2026-10-23):** a per-item session is 10 items by default (5–50 per mode). Custom Practice plays every chunk.
- **Phase 5 (owner, 2026-10-23):** adaptive weighting applies to drawn characters only (Koch, Random Groups, ICR). Words and Callsigns are drawn uniformly but still feed the character stats.
- **Phase 5 (my calls):**
  - Random Groups has its own Uniform/Adaptive choice (SPEC §7.3), default Adaptive. Settings → Learning → "Adaptive" now reads "Adaptive Koch and ICR".
  - "Practice these characters" opens Random Groups on those characters as a one-off override, shown as a chip with "Use my character set". It is never saved, and it needs two or more weak characters.
  - Leaving a practice screen or hiding the window pauses. Resuming replays an item that was cut off, and that replay isn't counted as a Repeat.
  - Copy modes record no response time, so they never touch `ewmaRt`.
  - Esc on the last item's feedback counts as finishing the session.
  - A snippet sent to Custom asks before replacing different text, and one over 20,000 characters is refused, never cut short.
  - Bundled data was checked by a research pass. QRJ, PKT, AGE, SE and C6 were dropped, ELE became EL, and HB/PJ/VR/3D only take the digits that mean their country. See `src/data/README.md`.
  - Added the `?` shortcut overlay (SPEC §10.3), which had never been built, with a keyboard button in the top bar. Esc in the speed popover no longer also stops a lesson.
  - The diff now follows Settings → Display → Code format (it always showed dots and dashes before).

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

## Themes (owner, 2026-10-23)

- Dark is the default for a fresh install. A saved choice is kept: theme is app-wide, stored in `meta`, and read back through `parseThemePreference`.
- The light theme was "too plain", and its dark sidebar looked bolted on. Its sidebar is now a deeper shade of the page paper, and the page background is a little warmer. The owner said the dark theme is "perfect", so it is unchanged.
- The owner asked for three new themes:
  - **High contrast:** white on black, yellow accent, cyan focus, no shadows.
  - **Night red:** all reds on near-black.
  - **Green terminal:** phosphor green, everything in the mono font, amber errors.
- The theme picker is now a native `<select>` (palette icon) in the top bar and in Settings → Display. "System" is labelled "System default" (owner) and follows the OS light/dark setting.
- How a theme works:
  - It is one `:root[data-theme="…"]` block in `src/styles/tokens.css`, plus an entry in `THEMES` and `THEME_LABELS` in `src/state/theme.ts`.
  - `tests/state/theme.test.ts` checks that every theme has a block.
  - Every text colour was checked for WCAG contrast against every surface it sits on (≥ 4.5:1). The figures are in each block's comment.
- Per-theme tokens added: `--sidebar-glow`, `--brand-mark-fg` and `--brand-mark-ring` (the logo tile stays midnight in every theme). The Text Player play button uses `--color-accent` in the three new themes.
- Colours still hard-coded on purpose: the red dev banner, the modal backdrop, white text on profile avatars, and the logo tile's dark gradient.

## Phase 6 follow-ups (decided 2026-10-23)

The owner asked me to research and decide these.

- **ICR doesn't add Koch's newest-character multiplier.** Adaptive ICR already targets weak and slow characters, the way MorseCode.World's adaptive ICR trainer does. A newly learned character starts with no stats, so it is already weighted up (low accuracy, plus the recency bonus).
- **Not built:** "Drill these in ICR", a speed-chip note saying a change applies from the next session, and storing the timing source with each session. They are small, but phase 5 and 6 are trimmed scope. Revisit only if the learner finds the speed behaviour confusing.

## How Phase 7 is put together

- `src/core/stats.ts`:
  - `dayStart`, `practiceMsSince`, `accuracySince` (weighted by characters sent, §8.2).
  - `confusions` ("You hear H as S 23% of the time").
  - `weakForPractice` (§7.10: the 6 weakest with ≥ 20 attempts, then filled from the learned Koch characters).
  - Tests are in `tests/core/stats.test.ts`.
- `Store.queryCharEvents(profileId, {ch, mode, outcome, withResponse, limit})`, newest first, in both stores, with a contract test. ICR's Target median uses it too.
- `src/features/stats/StatsScreen.tsx`:
  - Overview tiles: Koch level, accuracy over the last 7 days, today's practice, ICR median.
  - "Practise my weak characters".
  - The character grid; clicking a tile shows its detail and confusions.
  - Session history in pages of 20.
  - Tests are in `tests/features/stats/`.
- `App.tsx` routes screens with an exhaustive switch. The `ScreenIntro` placeholder was deleted, since every screen is built.

## Phase 7 review fixes (my calls)

- "Practise my weak characters" forces Adaptive for that practice only: the override is `{chars, weighting}`, and Random Groups shows "Adaptive, for this practice" in place of the Weighting toggle. The saved `groups.weighting` is untouched. Other "Practice these characters" buttons still follow the saved weighting.
- Migration `0002` adds `idx_char_events_profile_mode_ts`. An existing database takes a pre-migration backup on its first launch after this (by design). The Node test driver now runs every file in `src-tauri/migrations/`.
- `Store.countCharOutcomes` (GROUP BY outcome, typed) feeds the character detail. `queryCharEvents` rejects a negative or fractional `limit`.
- "Last 7 days" counts calendar days (`daysBefore`), so the window is right across a clock change.
- Character tiles: each theme sets `--tile-mix-max` (light 80%, dark 55%, high contrast 60%, night red 40%, green terminal 48%), the most accent the tile can mix in while its text keeps ≥ 4.5:1 at 100% accuracy. A flat 70% cap failed in four themes. Night red's range is narrow, but the value is printed on every tile.
- Not changed, on purpose: the open character is remembered per profile, so switching A → B → A shows it again. The per-character median shows "—" while loading and when there is no data.

## How Phase 6 is put together

- `src/core/icr.ts`:
  - Single-key mapping (prosigns excluded).
  - The Target timeout.
  - Median and percentile.
  - The round summary.
  - Tests are in `tests/core/icr.test.ts`.
- `src/audio/`:
  - `scheduler.endTime()`.
  - `engine.heardAt(t)`: maps an audio-clock time to `performance.now()` through `getOutputTimestamp()`. It falls back to `currentTime` plus latency before the device reports a timestamp, and the results then say how many times were estimated.
  - `engine.tick()`: the soft "correct" sound, on the shared context.
- `src/features/icr/`:
  - The controller (epoch/ticket as before, plus a `resuming` phase so a pause during a resume or retry takes effect), the store, and `IcrScreen.tsx`.
  - Tests are in `tests/features/icr/`, including the races the reviewer found.
- **Timing:**
  - A response is `KeyboardEvent.timeStamp` minus the heard end of the sound.
  - A key while it sounds counts as 0 ms (owner). A key before it starts is ignored.
  - A key after the deadline is a timeout, and a timeout is recorded at the timeout value.
- **Keys:**
  - A capture-phase listener takes answers before any other shortcut, and AltGr is allowed.
  - Mid-round, Space, Enter and `?` are swallowed.
  - Opening any dialog or menu pauses the round.
- **Adaptive:** `src/features/copy/weights.ts` is shared. Koch and Random Groups use copy weights, and ICR uses ICR weights (response-time factor). Answers are saved through `copy/save.ts`, which treats a retry of an already committed trial as success.
- Settings keys: `icr.*`.

## How Phase 5 is put together

- `src/core/`: `charset.ts` (Random Groups sets), `chunk.ts` (Custom splitting), `drill.ts` (session totals), `bundled.ts` (word lists and the prefix table), and `generators/words.ts` and `generators/callsigns.ts`. Tests are in `tests/core/practice-generators.test.ts`.
- `src/features/drill/`: one controller for all four modes, with a store per mode (`drillStores`).
  - `modes.ts` plans each mode's items.
  - `practise.ts` holds the entry points from other screens.
  - `DrillScreen.tsx` and `Setups.tsx` are the UI.
  - Tests are in `tests/features/drill/`, including a block for the races the reviewer found.
- `src/features/copy/`: parts shared with Koch (the diff, score metrics, weakest characters, live code), `copy.module.css`, and `weights.ts` (adaptive weights and recency, used the same way by every mode).
- Settings keys: `groups.*`, `words.*`, `callsigns.*` and `custom.*`.
- Concurrency follows Koch: each mode has its own epoch.
  - Every action that awaits audio sets its phase synchronously first, so double clicks can't act on a stale phase.
  - A pause during a save is applied when the save lands.
  - `finish()` marks the run `closing`, so a profile reset never closes the session a second time.

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
3. Run `pnpm i`, then `pnpm test`, `pnpm lint`, `pnpm typecheck`. In `src-tauri/`, run `cargo test` and `cargo clippy --all-targets -- -D warnings`. All of these pass at the latest commit: 377 TS tests and 8 Rust tests.
   - **pnpm on this PC (2026-10-23):** the corepack shim in `%APPDATA%\npm` is gone, so plain `pnpm` isn't found. Use `corepack pnpm <cmd>`.
   - `pnpm tauri dev` also runs `pnpm dev` itself (beforeDevCommand). For that, put a folder on PATH with a `pnpm.cmd` containing `@echo off` / `corepack pnpm %*`, then run `corepack pnpm tauri dev`. A real fix is to re-run `corepack enable` from an elevated shell, or with `--install-directory` pointing at a folder on PATH.
4. `pnpm tauri dev` runs the app.
   - Vite hot-reloads while code is being edited. A reload in the middle of a multi-file change can leave the window black ("does not provide an export named …"). Restart the dev app after a batch of edits. It isn't a bug in the app.
   - The database is `%APPDATA%\com.keepitsimpleanalytics.morsetrainer\morse-trainer.db`, with backups in `backups\` next to it.
   - For screenshots, use `pnpm dev:web` with `?demo=<screen id>`.
5. **Next: phase 10 (Release, SPEC §15).**
   - Icons, About with the data licences, a README with SmartScreen notes, `release.yml` and the updater.
   - Pushing is blocked until the KeepitSimple SSH key exists (open item 3).
   - The owner also needs to choose signed or unsigned (SPEC §16 Q3). The default is unsigned, and the owner leaned that way for a single learner.
