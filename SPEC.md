# Morse Trainer v2 — Product & Technical Specification

Status: Draft 1 · 2026-10-23
Target: Tauri v2 desktop app. **Primary: Windows 10/11 (x64)** — the intended user is on Windows, and every release is gated on it.
Secondary: macOS 11+ (universal binary). CI builds it and it must compile, but it is best-effort and never blocks a release (§1.3).
Replaces: v1 static web app (`index.html`, `morse.js`, `styles.css`, Docker/nginx), which moves to `legacy/v1/` for reference.

---

## 1. Goals and non-goals

### 1.1 Goals
1. **Progress that lasts.** All progress is stored in a local SQLite database owned by the app. It never depends on a browser, origin or port. Progress can be exported and imported, and is backed up automatically.
2. **Correct teaching method.** Score each character, track every character, adapt to weak characters, train instant recognition, and stop scoring whole messages as all-or-nothing.
3. **Keep every v1 feature** (§3), with the v1 bugs fixed (§4).
4. **Text Player.** Type text and hear it played as Morse. A v1 user asked for this specifically. Details in §7.8.
5. **Sending practice.** Use the keyboard or a USB paddle adapter, with a decoder and timing feedback.
6. **No setup for users.** One installer per OS, with no runtime to install.

### 1.2 Non-goals for v2.0
- Linux, Android and iOS builds. The code must not block them later, but they aren't tested or shipped.
- Cloud sync, accounts and multi-device sync. The export/import format (§9.5) is the hook for adding this later.
- Decoding Morse from a microphone or radio audio.
- On-air or network features.

---

### 1.3 Platform priority
- **Windows is the only platform that gates a release.** Manual QA (§14.3), latency measurements (`docs/latency.md`) and the installer experience are verified on Windows 10 and 11.
- **macOS** stays in the CI matrix so the code doesn't drift into Windows-only assumptions:
  - No hard-coded `\` paths; use Tauri path APIs.
  - No Win32-only crates without a `cfg` guard.
  - Shortcuts use Cmd/Ctrl.
- A macOS failure in CI is a warning to fix, not a blocker. A `.dmg` is attached to releases as "untested".

## 2. Tech stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Tauri 2.x** (latest stable) | Rust stable toolchain, MSVC on Windows |
| Frontend | **React 18 + TypeScript (strict) + Vite** | |
| State | **Zustand** | One store per feature plus a `settings` store and a `session` store |
| Styling | CSS Modules + CSS custom-property design tokens | Light, dark and system themes |
| Charts | **Recharts** | Stats dashboard |
| Validation | **zod** | Settings, export/import, DB row parsing |
| Storage | **SQLite via `tauri-plugin-sql`** (sqlite feature) | Migrations are defined in Rust (§9) |
| Audio | **Web Audio API** in the webview | WebView2 (Chromium) on Windows is the reference engine. WKWebView on macOS is best-effort. Rust audio is only a fallback (§13) |
| Tests | **Vitest** (core and stores), `cargo test` (Rust) | The core logic must be pure and testable without a DOM |
| Lint/format | ESLint, Prettier, `cargo fmt`, `cargo clippy -D warnings` | |
| Package manager | **pnpm** | |

Tauri plugins: `sql`, `dialog`, `fs`, `window-state`, `single-instance`, `updater` (phase 10), `notification` (optional, phase 9).

App identifier: `com.keepitsimpleanalytics.morsetrainer`. Product name: **Morse Trainer** (see the open questions in §16).

---

## 3. Parity: v1 features that must carry over

| v1 feature | v2 location | Change |
|---|---|---|
| Koch Method mode, auto-generated 8–10 character messages | Koch Lessons (§7.1) | Timed lessons in groups, per-character scoring, automatic advancement |
| Koch order (v1 order: G4FON with punctuation removed) | Koch order option **"Classic (v1)"** | LCWO and G4FON orders are also available |
| Random Letters (10 random A–Z) | Random Groups (§7.3) | Configurable character set and group size |
| Common Words (40 three-letter words) | Words (§7.4) | Top-100 and top-500 lists, CW abbreviations, Koch-filtered option |
| Callsigns (US 1×3 pattern) | Callsigns (§7.5) | Realistic worldwide formats |
| Q-Codes (18 codes, one per message) | Words → Q-codes list (§7.4) | 40+ codes, with the meaning shown after answering |
| Custom Text | Custom Practice (§7.7) and Text Player (§7.8) | |
| Character speed 5–40 WPM | Settings → Timing | Range widened to 5–60 |
| Effective (Farnsworth) speed with "linked" behaviour and an Actual WPM indicator | Settings → Timing | Same linked behaviour, without the v1 load bug |
| Tone frequency 400–1000 Hz, step 50 | Settings → Audio | 300–1200 Hz, step 10 |
| Play / Repeat / Stop | All listening modes | Keyboard shortcuts (§10.3) |
| Live dot/dash visual during playback | Setting "Show code" | Default is **after answering**, not live (§10.4) |
| Answer box, Check, Reveal | All copy modes | Scored per character (§8) |
| Session stats (correct / incorrect / rate) | Session summary plus the Stats dashboard (§7.10) | |
| Koch level accuracy and "Advance" button | Koch Lessons | Rolling, per-lesson accuracy; automatic or prompted advancement |
| Reset statistics | Settings → Data | Requires confirmation and is scoped per profile |
| Progress saved to localStorage | SQLite (§9) | One-time v1 import (§9.6) |
| Raised envelope for click reduction | Audio engine (§6) | Raised-cosine shape with configurable rise time |
| Teaching tips in README and footer | "Tips" panel and first-run guide (§10.5) | |

---

## 4. Known v1 defects that must not recur

Each of these needs a regression test where one is feasible.

1. On load, `syncEffectiveToChar()` overwrote the saved effective speed while `farnsworthLocked` stayed `false`. → Settings hydrate exactly as saved, and the linked/unlinked state is derived from `effective >= char` rather than stored separately.
2. Whole-message exact-match scoring made the 90% threshold nearly unreachable. → Per-character alignment scoring (§8).
3. Koch accuracy was a lifetime total per level, so early mistakes kept the score down permanently. → Use per-lesson accuracy and rolling metrics.
4. Reveal recorded nothing, so hard items could be skipped without penalty. Each wrong retry counted as another failure. → A trial is scored once, on the first submission or on reveal. Reveal counts as all characters missed. Retries are allowed but don't change the score.
5. Every playback created a new `AudioContext` that was never closed. → One shared context for the whole app (§6).
6. Playback was scheduled at `currentTime`, so the first ramp could be clipped. → Start 100 ms ahead.
7. Characters with no Morse code were silently skipped during playback but still expected in the answer. → The tokenizer reports unsupported characters. The UI marks them and they are excluded from both playback and scoring.
8. Newlines weren't treated as word gaps, and double spaces made answers fail. → Normalize all whitespace.
9. Mode and custom text weren't saved. → All settings and the last mode are saved.
10. Non-Koch modes ignored the learned character set. → Every generator accepts an optional allowed character set.
11. Reset wiped the Koch level silently. → Destructive actions require confirmation.
12. The README claimed advancement was automatic and that you drop back below 70%, but neither was implemented. → Both are implemented as configurable behaviour (§7.1).

---

## 5. Morse core (`src/core/`, pure TypeScript)

The core has no DOM, Web Audio or Tauri imports. It is fully unit-tested.

### 5.1 Alphabet (`alphabet.ts`)
- **Letters:** A–Z. **Digits:** 0–9.
- **Punctuation:** `. , ? / = + - ' " ( ) : ; @ ! &` with ITU patterns. `!` (`-.-.--`) and `&` (`.-...`) are non-ITU but common, so they are included and flagged `nonStandard: true`.
- **Prosigns** are written as tokens in angle brackets: `<AR>` `.-.-.`, `<SK>` `...-.-`, `<BT>` `-...-`, `<KN>` `-.--.`, `<AS>` `.-...`, `<BK>` `-...-.-`, `<CL>` `-.-..-..`, `<SOS>` `...---...`, `<HH>` `........` (error).
  - Notes: `=` and `<BT>` share a pattern, as do `+` and `<AR>`, and `&` and `<AS>`. Decoding prefers the prosign form when the setting "Decode prosigns" is on (default on).
- Each entry has the shape `{ symbol, pattern, kind: 'letter'|'digit'|'punct'|'prosign', name?, phonetic }`. `phonetic` is the "di-dah" rendering, for example K = "dah-di-dah".

### 5.2 Tokenizer (`tokenize.ts`)
`tokenize(text) → { tokens: Token[], unsupported: {char, index}[] }`
- Convert to upper case and normalize Unicode (NFKC). Map curly quotes to straight quotes.
- Any run of whitespace (spaces, tabs, newlines) becomes one `WORD_GAP` token. Leading and trailing whitespace is dropped.
- `<XX>` becomes a prosign token if `XX` is known. Otherwise each character is tokenized separately and an unsupported entry is recorded for the brackets.
- Each token keeps `sourceStart` and `sourceEnd` offsets into the original text, so the UI can highlight it (needed by §7.8).

### 5.3 Timing (`timing.ts`)
- `dot = 1200 / charWpm` ms (PARIS).
- Farnsworth (ARRL formula, which v1 already implemented correctly): when `effWpm < charWpm`,
  `extraUnit = ((60000/effWpm) − (50 · dot)) / 19`;
  `charGap = 3·dot + 3·extraUnit`, `wordGap = 7·dot + 7·extraUnit`.
- Additional setting: an **extra word-spacing multiplier** (1.0–3.0, default 1.0) applied on top of `wordGap`.
- **Acceptance tests:**
  - At 20/20 WPM, `"PARIS "` (with its trailing word gap) lasts exactly **3000 ms**.
  - At 20 WPM characters and 10 WPM effective, it lasts exactly **6000 ms**.
  - At 5/5 WPM, it lasts 12 000 ms.

### 5.4 Timeline (`timeline.ts`)
`buildTimeline(tokens, timing, opts) → Element[]`, where each element is `{ on: boolean, start: ms, dur: ms, tokenIndex }`.
- This is the single source of truth for audio scheduling, visual highlighting, WAV export and decoder tests.
- Options:
  - `speedJitter`: 0–10% per message, applied to the whole message.
  - `pitchJitter`: handled in audio, not here.
  - `leadIn`: default 100 ms.

### 5.5 Generators (`generators/`)
Every generator accepts `{ rng, allowedChars?, weights? }` and returns `string[]` items.
- The RNG is **seedable**: mulberry32 seeded from the session ID. A session can then be replayed exactly and tests are deterministic.
- Generators:
  - `groups.ts`: random groups. Length is fixed (1–10) or random within [min, max].
  - `koch.ts`: groups from the first N characters of the selected order, with weighting (§7.1).
  - `words.ts`: draws from the word lists. With `allowedChars`, only words made entirely of allowed characters are drawn.
  - `callsigns.ts`: §7.5.
  - `qso.ts`: §7.6.
  - `adaptive.ts`: weighted selection (§8.3).

### 5.6 Scoring (`scoring.ts`)
Specified in §8.

### 5.7 Decoder (`decoder.ts`)
Specified in §7.9. It turns key events into elements and then into text.

### 5.8 Keyer (`keyer.ts`)
An iambic keyer state machine (§7.9).

### 5.9 WAV encoder (`wav.ts`)
- Renders a timeline to mono 16-bit PCM at 44.1 kHz, with the same envelope as live audio.
- Uses `OfflineAudioContext` when it is available. Otherwise it synthesizes the samples directly. Both paths must produce equivalent output, verified by a test that compares the RMS of each element window.

---

## 6. Audio engine (`src/audio/`)

- **One `AudioContext` for the whole app**, created lazily on the first user gesture. Resume it when needed. Never close it while the app is running.
- **Signal graph:**
  `OscillatorNode (sine, always running) → keyGain (keyed) → toneFilter (optional bandpass) → mix`
  `NoiseSource → noiseGain → mix`
  `QRM oscillator → qrmGain → mix`
  `mix → masterGain (volume) → destination`
- **Keying:** the oscillator runs continuously. `keyGain` follows a raised-cosine curve via `setValueCurveAtTime` (64-point `Float32Array`).
  - Rise and fall time: 2–10 ms, default 5 ms.
  - Clamp the rise time to ≤ 0.4 × dot so curves never overlap. Overlapping curves throw exceptions.
- **Lookahead scheduler:** a timer runs every 50 ms and schedules elements up to 1.5 s ahead of `ctx.currentTime`, reading from a queue. This gives:
  - **Stop:** call `cancelScheduledValues(now)`, ramp to 0 over the rise time, and clear the queue. Latency is at most 20 ms.
  - **Pause/Resume** (Text Player only): stop scheduling and remember the element index.
  - **Live append:** the Text Player's type-to-transmit mode and the keyer sidetone push elements onto the queue.
- **Progress events:** a `requestAnimationFrame` loop compares `ctx.currentTime` with element start times and emits `onToken(tokenIndex)` and `onDone()`. Don't use `setTimeout` chains for visual sync.
- **Changing frequency mid-play:** use `setTargetAtTime` on `osc.frequency`.
- **Realism settings** (per mode, off by default; implemented in phase 9):
  - **Noise:** white or pink noise (pink via the Voss-McCartney algorithm), with SNR from −10 to +30 dB.
  - **QSB:** gain modulated by a low-frequency oscillator, 0.05–0.5 Hz, depth 0–90%.
  - **QRM:** a second random-text station at ±50–400 Hz offset, at 3–20 dB lower level.
  - **Bandpass filter:** "receiver filter", 200–1000 Hz wide, centred on the tone.
- **Pitch jitter:** an optional random tone per message within ±N Hz.
- **Latency check:** in Settings → Audio, a "Test sidetone latency" button shows `ctx.baseLatency + ctx.outputLatency`. If this is over 40 ms on a target OS, raise it as an issue (§13).

---

## 7. Modes and features

### Common pattern for "copy" modes
These are Koch, Groups, Words, Callsigns, QSO and Custom.

- **Config panel** (collapsible): the mode's options, plus a speed summary that opens a timing popover.
- **Run styles:**
  - **Per item:** play one item, then the user types and submits. Supports Repeat (up to N times, default unlimited, each counted) and Reveal.
  - **Stream / copy as you go:** play a sequence of items for a set duration. The user types continuously into a large text area and scoring happens at the end. This is the default for Koch lessons.
- **Results panel:** an aligned diff (§8.2), accuracy, characters per minute, and a list of the weakest characters this session. Buttons for "Replay with text shown" and "Practice these characters".
- **Writing results:** every trial is written to the database as soon as it is scored (§9.4). A crash loses at most the current trial.

### 7.1 Koch Lessons
- **Orders**, selectable in Settings with LCWO as the default:
  - **LCWO:** `K M U R E S N A P T L W I . J Z = F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X`
  - **G4FON:** `K M R S U A P T L O W I . N J E F 0 Y , V G 5 / Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X`
  - **Classic (v1):** `K M R S U A P T L O W I N J E F 0 Y V G 5 Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X`
  - *Implementer:* verify the LCWO and G4FON sequences against lcwo.net and the G4FON documentation before shipping, and record the sources in `src/data/README.md`.
- **Level** N means the first N+1 characters (level 1 is K and M), as in v1. Progress is stored per profile and per order.
- **Lesson:**
  - Duration is 1–10 minutes (default 2), or a number of groups.
  - Groups have 5 characters by default, or a random length of 2–7.
  - Copy as you go.
  - Settings snapshot taken per lesson: character and effective WPM, and frequency.
- **New-character introduction:** on reaching a new level, a short intro plays the new character 3 times with its name and phonetic rendering. It can be skipped and is replayable from the level card.
- **Weighting:** the newest character is drawn with weight 2.0 (configurable, 1–4). The others follow adaptive weights (§8.3) when "Adaptive" is on (default on).
- **Advancement:** when lesson accuracy is ≥ threshold (default 90%, range 80–98) on a lesson of at least 1 minute:
  - **Prompt** (default): show "You passed! Add *R*?" with Advance and Stay buttons.
  - **Auto:** advance immediately.
- **Regression:** if the last 3 lessons at this level are all below the floor (default 70%), suggest dropping back one level. It is a suggestion and never automatic.
- **Level card:** shows the current level, the learned characters (each a tile coloured by accuracy), the best lesson accuracy at this level, the lessons taken at this level, and a "Jump to level" control (with confirmation; progress history is kept).

### 7.2 Instant Character Recognition (ICR)
- **Character set:** learned Koch characters (default), all characters, or a custom set.
- **Flow:**
  1. Play one character.
  2. A timer starts at the **end of the character's sound**.
  3. The user presses a key. Single-key input, no Enter needed.
- **Feedback:**
  - **Correct:** a soft tick sound (optional), a flash of the character, then the next character after 300 ms.
  - **Wrong or timeout:** show the correct character large, replay it once, then continue.
- **Timeout:** 0.5–5 s, default 1.5 s. A "Target" option tightens the timeout to the user's median response time minus 10%, with a floor of 300 ms.
- **Round:** 50 characters by default, or a duration. The summary shows accuracy and the median, p90 and slowest response time per character.
- **Selection:** adaptive weighting (§8.3) using both accuracy and response time.
- Prosigns are excluded from ICR by default, because they can't be entered with a single key.

### 7.3 Random Groups
- **Character set** checkboxes: letters, digits, punctuation, prosigns; or a custom string; or "Koch learned".
- **Group length:** fixed or random [min, max]. Number of groups or duration.
- **Weighting:** uniform or adaptive.

### 7.4 Words
Bundled lists in `src/data/`, each a JSON file with `{id, name, source, license, items}`:

| List | Contents | Notes |
|---|---|---|
| `english-top100`, `english-top500` | Most frequent English words | Source must be public domain or CC-compatible, e.g. counts derived from Project Gutenberg. Record the license. |
| `cw-abbrev` | ≥ 80 entries, each `{word, meaning}` | CQ DE K KN BK R RST UR FB OM YL XYL TNX TU PSE HR ES WX RIG ANT PWR 73 88 GM GA GE GN AGN NR CUL HW SRI ... |
| `qcodes` | ≥ 40 entries, each `{word, meaning}` | Includes all 18 from v1 |
| `v1-common` | The 40 words from v1 | Parity |
| User lists | Created and edited in-app | Stored in the database (§9) |

- **Options:**
  - "Only words using learned Koch characters". The word-count preview must show more than 0 before the user can start.
  - Lists with meanings show the meaning after the answer.

### 7.5 Callsigns
- **Generator:**
  - Weighted worldwide prefix table (`src/data/prefixes.json`, ≥ 150 prefixes, weighted roughly by on-air activity).
  - Format templates: 1×1, 1×2, 1×3, 2×1, 2×2, 2×3.
  - Optional portable or affix forms: `/P`, `/M`, `/QRP`, `/MM`, and prefix-slash forms such as `VE3/W1ABC` (frequency setting 0–30%).
  - Optional "US only" (v1 behaviour).
- **Real calls:** the user can import a **MASTER.SCP** file through a file dialog. It is stored in the app data folder and never bundled, because of licensing. When it is present, a "Use real calls" toggle draws from it.
- **Contest-pileup lite** (phase 9): 2–3 calls played overlapping at different pitches and speeds. The user copies any one of them, and it is scored against whichever call matches best.

### 7.6 QSO Simulation (phase 9)
- **Templates** in `src/data/qso-templates.json` with slots: `{call1} {call2} {name} {qth} {rst} {rig} {pwr} {ant} {wx} {temp}`. Slot values are drawn from data files.
- **Styles:** ragchew (exchange of name, QTH, RST, rig, WX), contest (RST + serial or state), and POTA/SOTA-style short exchanges.
- **Flow:** play the whole QSO (copy as you go), then a form asks for the fields (name, QTH, RST, ...). Score each field, plus a full-text diff for reference.

### 7.7 Custom Practice
- A text box, or **Import .txt** (through the dialog plugin, up to 1 MB). It can also be loaded from a Text Player snippet.
- **Chunking:** split into items by sentence, by line, or into N words per item. Order is sequential or shuffled.
- Played per item or streamed, and scored as in §8.

### 7.8 Text Player ("type it, hear it")
This was requested by a v1 user. It is a first-class tool, not a quiz mode, and ships early (phase 2).

- **Layout:**
  - Top: a large multi-line text editor, up to 20 000 characters.
  - Under the editor: a code view showing the Morse rendering, kept in sync with the text.
  - Bottom: a transport bar.
- **Transport:**
  - Play / Pause / Stop.
  - **Loop** toggle.
  - **Play from cursor:** clicking a word or character in either the text or the code view sets the start point.
  - Speed, effective speed, tone and volume controls inline. These are **Player settings**, saved separately from the training settings, so playing with the Player doesn't change lesson speeds.
- **Highlighting:** the character currently sounding is highlighted in both views (using token `sourceStart`/`sourceEnd`). The view auto-scrolls.
- **Unsupported characters:** shown with a wavy underline and a tooltip "Not in Morse — skipped". A count is shown in the status bar.
- **Type-to-transmit (live mode)** toggle:
  - Each character typed is queued and played as soon as possible, with correct character and word gaps.
  - Backspace removes queued characters that haven't played yet. Characters already played are not "unplayed".
  - The queue length is shown.
- **Prosign palette:** buttons that insert `<AR>`, `<SK>`, `<BT>`, `<KN>` and so on.
- **Code display formats:** `.-` (ASCII), `·–` (dots and dashes) or `di-dah` (phonetic). Separator options: space between letters, ` / ` between words.
- **Reverse decode:**
  - Paste Morse such as `.... . .-.. .-.. --- / .-- --- .-. .-.. -..` and get text.
  - Accepts `.`, `-`, `·`, `–`, `_`. Words are separated by `/`, `|` or 3 or more spaces.
  - Invalid sequences are shown as `�` with an error list.
- **Export:**
  - **Copy code** to the clipboard.
  - **Export WAV**, using the current Player settings and the realism settings if enabled. A save dialog suggests the filename `morse-<first-words>.wav`.
- **Snippet library:** save, rename, delete and load named texts, stored per profile in the database. Each can be sent to Custom Practice.
- **Hide text toggle:** blurs the editor so the user can quiz themselves, then reveal it.

### 7.9 Sending Practice (phase 8)
- **Input sources:**
  1. **Keyboard as a straight key:** default key Space. Configurable to any key, captured by `event.code`.
  2. **Keyboard as paddles:** default **Left Ctrl = dit, Right Ctrl = dah**. This matches common USB paddle adapters (e.g. VBand-style), which emulate Ctrl keys, so those adapters work with no drivers. Configurable, with a swap option.
  3. **MIDI** (optional, phase 8b): read in Rust with the `midir` crate and sent to the frontend as Tauri events. The user picks the note-on/off mapping in a "Learn" dialog.
     - Web MIDI isn't used, because WKWebView doesn't support it.
  4. **Serial port lines** (optional, phase 8b): read with the Rust `serialport` crate, polling CTS/DSR every 1 ms on a background thread and emitting change events.
- **Keyer:**
  - Straight key, or **Iambic A / Iambic B**, with dit/dah memory, at a configurable WPM (5–50).
  - Weighting 50% (normal) adjustable to 30–70%. Dah ratio 3.0 (2.5–4.0).
  - The state machine in `keyer.ts` is driven by audio-clock time:
    - A 2 ms `setInterval` tick plus key-event timestamps from `event.timeStamp`.
    - Elements are scheduled on the audio clock at `now + 5 ms`.
    - Target: total jitter under 5 ms. Verify by measurement and record the result in `docs/latency.md`.
- **Sidetone:** the same audio engine keyed live. Separate sidetone frequency and volume settings.
- **Decoder:**
  - **Iambic mode** uses the known keyer WPM.
  - **Straight-key mode** estimates speed adaptively:
    - Key-down durations are clustered into dit and dah with running 2-means.
    - The dit estimate is an exponential moving average.
    - Gaps are classified as element, character or word using thresholds at 2× and 5× the dit estimate (configurable).
- **Practice flow:**
  - A prompt shows text to send, drawn from Koch characters, words, callsigns or custom text.
  - The decoded text appears live beneath it. An idle gap of 2 s or more finalizes the attempt.
  - It is scored against the prompt with §8.
- **Timing analysis panel:**
  - Histogram of key-down durations (dit/dah clusters), the measured dah:dit ratio, and character and word spacing as a ratio of ideal.
  - Per character: a "too short / too long" indication.
  - Plain-language hints, e.g. "Your character spacing is 40% short — letters are running together."
- **Free-send mode:** no prompt. Just decode and display, for fun or as a check.

### 7.10 Stats Dashboard
- **Overview tiles:**
  - Today's practice minutes against the daily goal.
  - Current streak and best streak.
  - Koch level for the active order.
  - Accuracy over the last 7 days.
  - Median ICR response time.
- **Character grid:** one tile per character, coloured by EWMA accuracy (§8.3) using a colour-blind-safe sequential palette, with the value printed on the tile. Hover shows attempts, accuracy, median response time and last-seen date. Clicking a tile opens that character's detail: trend line and most-confused-with list.
- **Confusion matrix:** a heatmap of sent character (rows) against typed character (columns). Only rows with ≥ 1 error are shown. The top 10 confusion pairs are also listed ("You hear **H** as **S** 23% of the time").
- **Trends:**
  - Accuracy per session over time, filterable by mode.
  - Character and effective WPM over time.
  - Practice minutes per day (bars).
- **Calendar heatmap:** the last 12 months of practice minutes.
- **Session history:** a sortable, filterable table. Opening a session shows its settings snapshot, the per-trial diff, and "Replay this session", which uses the seed (§5.5).
- **Practice my weak characters:** opens Random Groups with the 6 weakest characters (minimum 20 attempts) plus Koch-learned filler, with adaptive weighting on.

### 7.11 Goals, streaks and achievements
- **Daily goal:** 5–60 minutes, default 10. A day counts towards the streak when listening plus sending time is ≥ the goal. Days use the local time zone.
- **Reminder** (optional, phase 9): a desktop notification at a set time if the goal isn't met, using `tauri-plugin-notification`. It works only while the app is running or in the tray; see §16.
- **Achievements** (phase 9): a small fixed set, defined in `src/data/achievements.json` and evaluated after each session. Examples:
  - First lesson; Koch levels 5, 10, 20 and complete.
  - Streaks of 7, 30 and 100 days.
  - 20 and 25 WPM character copy at ≥ 90%.
  - First QSO simulation.
  - First sent callsign scored at 100%.

### 7.12 Profiles
- Multiple local profiles (name plus colour) for shared computers. There are no passwords.
- The profile switcher is in the top bar. The last-used profile opens on launch.
- All progress, settings, snippets and lists are per profile. App-level preferences (window state, theme) are global.
- Create, rename and delete. Deleting requires typing the profile name, and offers to export first.

---

## 8. Scoring and adaptivity (`src/core/scoring.ts`, `adaptive.ts`)

### 8.1 Normalization
- Both the sent and typed text are tokenized (§5.2), so prosigns compare as single tokens. The user may type `<AR>` or `+`; both match an `<AR>` prompt.
- Whitespace runs collapse to one word gap. Case is ignored.
- Unsupported characters in the prompt are excluded beforehand.

### 8.2 Alignment
- Levenshtein alignment over **token arrays**, with a backtrace. Costs: substitution 1, insertion 1, deletion 1. On ties, prefer substitution over an insertion/deletion pair.
- Each **sent** token gets an outcome: `correct`, `substituted(typedToken)` or `missed`. Extra typed tokens are `inserted`.
- Word gaps take part in the alignment but are **excluded** from accuracy and from per-character statistics.
- **Metrics:**
  - `errors = substitutions + misses + insertions`
  - `accuracy = max(0, 1 − errors / sentCharCount)`
  - `cpm` = correct characters per minute of audio
- The UI diff uses colour **plus** a symbol, so meaning never relies on colour alone:
  - Correct: plain text.
  - Substituted: the sent character with the typed character under it, e.g. `H` over `s`.
  - Missed: `_`.
  - Inserted: `+x`.
- **Required test cases:**
  - Identical text.
  - Every token missed.
  - One insertion at the start (must not cascade into later errors).
  - Swapped characters.
  - Prosign typed as `+`.
  - Extra spaces and newlines in the answer.
  - Empty answer.
  - Answer longer than the prompt.

### 8.3 Adaptive weighting
- **Per profile, per character:**
  - `ewmaAcc`, initial 0.5, alpha 0.08.
  - `ewmaRt` in ms, for ICR only; alpha 0.1.
  - `attempts`, `correct`, `lastSeen`.
- **Weight:** `w = 1 + 3·(1 − ewmaAcc) + rtFactor + recencyFactor`, where
  - `rtFactor = clamp((ewmaRt − 600) / 600, 0, 2)`, used in ICR mode only;
  - `recencyFactor = 0.5` if the character hasn't been seen in the last 3 sessions.
- The Koch newest-character multiplier (§7.1) is applied on top.
- Weights are normalized. Selection uses the seeded RNG.
- No character may appear more than 3 times in a row.
- `char_stats` is a cache that can be rebuilt from `char_events` (§9). A Settings → Data → "Rebuild statistics" action does this, with a test proving the rebuild matches the incremental result.

---

## 9. Persistence

### 9.1 Location
- Database file: `$APPDATA/morse-trainer.db`, using Tauri's `appDataDir`.
  - Windows: `%APPDATA%\com.keepitsimpleanalytics.morsetrainer\`
  - macOS: `~/Library/Application Support/com.keepitsimpleanalytics.morsetrainer/`
- Backups: `$APPDATA/backups/`.
- Settings → Data shows the path, with an "Open folder" button.

### 9.2 Schema
Version 1, created in a Rust migration (`src-tauri/migrations/0001_init.sql`). All timestamps are Unix epoch milliseconds in UTC, stored as INTEGER.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
);

CREATE TABLE settings (               -- per-profile key/value, value is JSON validated by zod
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,                 -- koch|icr|groups|words|callsigns|qso|custom|send|player
  started_at INTEGER NOT NULL, ended_at INTEGER, active_ms INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL,
  settings_snapshot TEXT NOT NULL,    -- JSON: wpm, eff, freq, order, level, charset, realism...
  sent_chars INTEGER NOT NULL DEFAULT 0, correct_chars INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0, accuracy REAL,
  completed INTEGER NOT NULL DEFAULT 0   -- 0 if abandoned
);
CREATE INDEX idx_sessions_profile_time ON sessions(profile_id, started_at);

CREATE TABLE trials (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0, repeats INTEGER NOT NULL DEFAULT 0,
  response_ms INTEGER, accuracy REAL NOT NULL, alignment TEXT NOT NULL,   -- JSON
  created_at INTEGER NOT NULL
);

CREATE TABLE char_events (            -- one row per sent character; source of truth for stats
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, ch TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct','substituted','missed')),
  typed TEXT, response_ms INTEGER, char_wpm INTEGER NOT NULL, mode TEXT NOT NULL
);
CREATE INDEX idx_char_events_profile_ch ON char_events(profile_id, ch, ts);

CREATE TABLE char_stats (             -- derived cache, rebuildable
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, ch TEXT NOT NULL,
  ewma_acc REAL NOT NULL, ewma_rt REAL, attempts INTEGER NOT NULL, correct INTEGER NOT NULL,
  last_seen INTEGER NOT NULL, PRIMARY KEY (profile_id, ch)
);

CREATE TABLE koch_progress (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, level INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, order_id)
);
CREATE TABLE koch_level_history (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, level INTEGER NOT NULL, reached_at INTEGER NOT NULL,
  reason TEXT NOT NULL                -- passed|manual|regressed|imported
);

CREATE TABLE snippets (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE word_lists (             -- user-created lists
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, items TEXT NOT NULL,   -- JSON array of {word, meaning?}
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE achievements (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL, earned_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, achievement_id)
);
```

- Enable `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`.
- Daily activity is computed by a query over `sessions.active_ms`, grouped by local date in TypeScript, so there is no time-zone logic in SQL.

### 9.3 Storage abstraction (`src/storage/`)
- `interface Store { profiles…, settings…, sessions…, trials…, charEvents…, stats…, snippets…, wordLists…, koch…, export(), import() }`. It is typed and async.
- `SqliteStore` is the production implementation.
- `MemoryStore` is for unit tests **and** for running `pnpm dev:web` in a plain browser.
  - In web dev mode a **red banner** says "Dev mode — progress is not saved".
  - This is the only fallback, and it is explicit. The production build must refuse to start without SQLite and show an error screen with the database path and the error text.

### 9.4 Write policy
- **Settings:** write 300 ms after the last change (debounced), and flush on window close using Tauri's `onCloseRequested`.
- **Trials and char events:** write in **one transaction per trial**, as soon as the trial is scored.
- **Session row:** inserted at start and updated at end. On launch, any session with `ended_at IS NULL` is closed with `completed = 0`.
- Never write on every slider `input` event without debouncing.

### 9.5 Export / import
- **Export:** Settings → Data → **Export…** writes JSON through a save dialog:
  ```json
  { "format": "morse-trainer-export", "formatVersion": 1, "appVersion": "2.0.0",
    "exportedAt": 0, "profiles": [ { "profile": {}, "settings": [], "sessions": [], "trials": [],
    "charEvents": [], "kochProgress": [], "kochLevelHistory": [], "snippets": [],
    "wordLists": [], "achievements": [] } ] }
  ```
  The user can choose to export all profiles or only the current one.
- **Import:**
  - Validate the file with zod. Show a summary first ("2 profiles, 340 sessions").
  - Then the user picks **Merge** (add records whose IDs don't already exist, matching profiles by ID) or **Replace** (wipe and load).
  - Replace triggers an automatic backup first.
  - Afterwards, rebuild `char_stats`.
- **Automatic backups:**
  - On the first launch of each day, and before any migration or Replace import, copy the database to `backups/morse-trainer-YYYYMMDD-HHMMSS.db` using SQLite `VACUUM INTO`, run as a Rust command.
  - Keep the newest 14.
  - Settings → Data has a "Restore from backup…" option.

### 9.6 v1 import
- Settings → Data → **Import v1 progress**. The dialog explains how to get the data:
  1. Open the old app in the browser.
  2. Press F12 to open the console.
  3. Run `copy(localStorage.morseCodeTrainerProgress)`.
  4. Paste the result here.
- **Mapping:**
  - `kochLevel` → `koch_progress` for order `classic-v1`, with history reason `imported`.
  - `charSpeed`, `effectiveSpeed`, `frequency` → training settings.
  - `stats.correct` and `stats.incorrect` → one synthetic session, mode `koch`, marked `imported` in `settings_snapshot`, with no char events.

---

## 10. UI / UX

### 10.1 Shell
- **Window:** default 1200×800, minimum 960×640. Window size and position are remembered (`window-state`). Single instance.
- **Left sidebar:**
  - **Learn:** Koch, ICR
  - **Practice:** Groups, Words, Callsigns, QSO, Custom
  - **Tools:** Text Player, Sending
  - **Progress:** Stats
  - **Settings** at the bottom
- **Top bar:** profile switcher, streak flame with day count, today's minutes as a progress ring against the goal, and a speed chip (e.g. "20/15 WPM · 600 Hz") that opens the timing popover.
- **Theme:** light, dark or system. All colours come from tokens in `src/styles/tokens.css`. Contrast is WCAG AA or better.
- **Production build:**
  - Disable the webview's default context menu (except in text fields).
  - Disable reload shortcuts: Ctrl/Cmd+R and F5.
  - Disable devtools.

### 10.2 Settings sections
- **Timing:**
  - Character WPM 5–60, default 20.
  - Effective WPM 3 to the character speed, default 15. Linked behaviour as in v1: dragging effective at or above the character speed re-links them, and while linked, moving character speed moves effective too.
  - Extra word spacing.
  - Actual WPM indicator.
- **Audio:** tone 300–1200 Hz (default 600), volume, rise time, pitch jitter, sidetone frequency and volume, latency test.
- **Realism defaults:** noise, QSB, QRM, filter.
- **Display:**
  - Show code: never, after answer (default), or live.
  - Code format.
  - Font size: 100–200%.
  - Reduce motion.
- **Learning:** Koch order, pass threshold, regression floor, advancement mode (prompt or auto), adaptive on/off, newest-character weight, daily goal.
- **Keys:** straight-key key, paddle keys, swap paddles, iambic mode, keyer WPM, weighting, MIDI mapping, serial port.
- **Data:** database path and Open folder; Export; Import; Import v1; Backups and Restore; Rebuild stats; Reset profile progress (type to confirm); Delete profile.
- **About:** version, links, licenses for bundled data.

### 10.3 Keyboard shortcuts
On macOS, Cmd replaces Ctrl. Shortcuts are shown in tooltips and on a `?` overlay.

| Action | Shortcut |
|---|---|
| Play new / next | Ctrl+Enter |
| Repeat | Ctrl+Space |
| Stop | Esc |
| Submit answer | Enter (per-item modes) |
| Reveal | Ctrl+Shift+Enter |
| Text Player play/pause | Ctrl+Enter in the editor, or Space when the editor isn't focused |
| Go to a mode | Ctrl+1…9 |
| Shortcut overlay | `?` |

The keys used by Sending Practice are captured only while that screen is focused and armed. A visible "Key armed" indicator shows this.

### 10.4 Visual code display
Defaults to showing **after** the answer, because a live dot/dash display teaches counting, which v1's own tips warn against. "Live" stays available as an option. The Text Player always shows code.

### 10.5 First run
- Create a profile (name) → short "How to learn" (3 cards, condensed from the v1 README tips) → recommended start: Koch level 1 at 20/15 WPM.
- The cards are always reachable from Help.

### 10.6 Accessibility
- Every control works from the keyboard, focus is visible, and controls have ARIA labels.
- Results are announced through an `aria-live` region.
- No colour-only meaning anywhere: diff, character grid, heatmaps.
- Respect `prefers-reduced-motion`.

---

## 11. Tauri / Rust side (`src-tauri/`)

- Rust code stays small; logic lives in TypeScript unless it needs native access.
- **Commands:**
  - `backup_db(reason) -> path`
  - `list_backups()`
  - `restore_backup(path)`, which needs a restart: show a dialog, then relaunch through `tauri-plugin-process`.
  - `db_path()`
  - **Phase 8b:** `midi_list_ports()`, `midi_open(port)`, `midi_close()`, `serial_list_ports()`, `serial_open(port, lines)`, `serial_close()`. Input changes arrive as events `key-input { source, down, ts_us }`.
- **SQL plugin:** migrations are registered with `tauri_plugin_sql::Builder::add_migrations("sqlite:morse-trainer.db", migrations)`.
- **Capabilities** (`src-tauri/capabilities/default.json`), least privilege:
  - SQL `allow-load`, `allow-execute`, `allow-select` for this database only.
  - Dialog open and save.
  - fs read and write **only** for paths returned by dialogs, plus `$APPDATA/**`.
  - window-state.
  - process restart.
- **CSP** in `tauri.conf.json`: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src ipc: http://ipc.localhost`. No remote content.
- **Bundle:**
  - **Windows:** NSIS installer, per-user install (no admin), with `webviewInstallMode: downloadBootstrapper`.
  - **macOS (secondary):** `.dmg`, universal target `universal-apple-darwin`, `minimumSystemVersion: "11.0"`. Unsigned.
  - **Windows details:**
    - Install to `%LOCALAPPDATA%` with Start Menu and optional desktop shortcuts, and an uninstaller in Apps & Features.
    - The uninstaller must **not** delete the app data folder by default (progress survives a reinstall). Offer it as an opt-in checkbox.
    - Supports Windows 10 21H2+ and Windows 11, x64. ARM64 Windows is out of scope for v2.0.
- **Icons:** generate them with `pnpm tauri icon`, from a source SVG in `design/icon.svg` (a simple key or "CW" glyph).

---

## 12. Repository layout

```
/                          (repo root)
├─ SPEC.md  CLAUDE.md  README.md
├─ legacy/v1/              (old index.html, morse.js, styles.css, Dockerfile, nginx.conf, compose)
├─ design/icon.svg
├─ docs/latency.md         (measured audio/keyer latency per OS)
├─ src/
│  ├─ core/                alphabet, tokenize, timing, timeline, scoring, adaptive, decoder, keyer, wav, rng, generators/
│  ├─ audio/               engine.ts, scheduler.ts, noise.ts, sidetone.ts
│  ├─ storage/             store.ts (interface), sqlite.ts, memory.ts, export.ts, import-v1.ts, schemas.ts (zod)
│  ├─ state/               settings.ts, session.ts, profile.ts
│  ├─ features/            koch/ icr/ groups/ words/ callsigns/ qso/ custom/ player/ sending/ stats/ settings/ profiles/ onboarding/
│  ├─ components/          shared UI (Diff, CharGrid, Heatmap, Transport, SpeedPopover, ConfirmDialog, …)
│  ├─ data/                wordlists/*.json, qcodes.json, cw-abbrev.json, prefixes.json, qso-templates.json, achievements.json, README.md (sources + licenses)
│  ├─ styles/tokens.css
│  └─ main.tsx, App.tsx
├─ src-tauri/              Cargo.toml, tauri.conf.json, capabilities/, migrations/, src/{main.rs, lib.rs, backup.rs, midi.rs, serial.rs}
├─ tests/                  (Vitest specs mirror src/core and src/storage)
└─ .github/workflows/      ci.yml, release.yml
```

---

## 13. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| WebView2 suspends audio or timers in background or minimized windows | Resume the context on every Play gesture. Pause sessions when `visibilitychange` reports the window is hidden, and don't count hidden time as `active_ms`. |
| Windows audio output latency differs between devices (shared-mode WASAPI, Bluetooth headsets 100–200 ms) | Measure on the target machine in phase 2. Show a warning in Settings → Audio when output latency is over 40 ms ("Bluetooth audio adds delay — use wired headphones for sending practice"). |
| Sidetone latency is too high for keying (> 40 ms) | Fallback plan: move sidetone and keyer into Rust with `cpal`, keyed directly from native input. Don't build this unless measurement requires it. |
| Paddle keys conflict with OS shortcuts (e.g. Ctrl+key combos, Windows key, Alt opening menus) | Capture `keydown` with `preventDefault` while armed, and ignore auto-repeat (`event.repeat`). Allow remapping. |
| macOS gets little or no real testing | Accepted (§1.3). CI keeps it compiling. Label the `.dmg` as untested. |
| Word-list and data licensing | Every bundled data file records its source and license in `src/data/README.md`. MASTER.SCP is user-imported only. |
| Unsigned installer triggers Windows SmartScreen ("Windows protected your PC") | Acceptable for v2.0. The README shows the "More info → Run anyway" steps with a screenshot. Signing is a later item (§16). |
| The database file grows from `char_events` | About 300 rows per 5-minute lesson is roughly 100k rows per year, well under 20 MB. No pruning in v2.0. |

---

## 14. Testing and quality

### 14.1 Unit tests (Vitest, required for merge)
- **Timing:** the PARIS tests in §5.3, plus Farnsworth at 25/18 within 0.1 ms of the formula.
- **Tokenizer:** prosigns, unsupported characters, whitespace, Unicode quotes, source offsets.
- **Scoring:** every case in §8.2.
- **Generators:**
  - With a set seed, output is deterministic.
  - Output only uses allowed characters (property test, 1 000 runs per generator).
  - Koch level N never emits characters beyond N.
- **Adaptive:** weights rise for weak characters; no character appears more than 3 times in a row.
- **Decoder:** run a timeline through synthetic key events and decode it.
  - Must round-trip `"CQ CQ DE W1ABC K"` and the full alphabet at 10, 20, 30 and 40 WPM.
  - Must also round-trip with ±15% random timing jitter, in straight-key mode with adaptive speed.
- **Keyer:** state-machine traces for Iambic A and B squeeze cases match reference sequences.
- **Storage:**
  - MemoryStore and SqliteStore pass the **same contract test suite**. Run SqliteStore through `better-sqlite3` in Node with the same migration SQL.
  - Export → import (Replace) produces identical data.
  - The `char_stats` rebuild matches incremental updates.
  - v1 import maps fields correctly.
- **Settings:** hydration round-trip, including the regression test for v1 defect #1.

### 14.2 CI (`.github/workflows/ci.yml`)
- Matrix: `windows-latest` (required check) and `macos-latest` (`continue-on-error: true`).
- Steps: `pnpm i --frozen-lockfile` → lint → typecheck → vitest → `cargo fmt --check` → `cargo clippy -D warnings` → `cargo test` → `pnpm tauri build` (debug bundle as an artifact).
- `release.yml`: on a `v*` tag, use `tauri-apps/tauri-action` to build the NSIS installer and the universal `.dmg`, then create a draft GitHub Release. The Windows installer is the primary asset; the `.dmg` is labelled "macOS (untested)".

### 14.3 Manual QA checklist
Run on **Windows** before each release; Windows 11 is required, and Windows 10 when a machine is available. macOS is optional:
1. Fresh install launches, first-run flow appears, and a profile is created.
2. Koch lesson plays, is scored, and the result persists after quitting and relaunching.
3. Effective speed below character speed survives a relaunch (v1 defect #1).
4. Text Player: Play, Pause, Loop, play-from-cursor, type-to-transmit, WAV export opens in the system player.
5. ICR timing feels immediate, with no stutter over 50 characters.
6. Sending with Left/Right Ctrl paddles: sidetone is clean and the decode is correct at 20 WPM.
7. Export, delete the profile, import, and everything is restored.
8. Kill the app mid-lesson (Task Manager → End task), relaunch: completed trials are present and the session is marked incomplete.
9. Dark and light themes; 200% font scale; keyboard-only navigation through a whole lesson.
10. Repeated Play and Stop 100 times leaves audio working with no growth in memory (v1 defect #5).
11. Install, practice, uninstall and reinstall: progress is still there. A fresh install on a machine without admin rights succeeds.
12. Minimize mid-lesson: the session pauses, and `active_ms` excludes the hidden time.
13. Switch audio output (speakers → headphones) during playback: audio continues on the new device or recovers on the next Play.

---

## 15. Delivery phases

Each phase ends with its tests green, the app runnable through `pnpm tauri dev` on Windows, and a commit. Don't start a phase until the previous phase's acceptance criteria are met.

| Phase | Scope | Acceptance |
|---|---|---|
| **0. Scaffold** | Move v1 to `legacy/v1/`. Create the Tauri 2 + React + TS + Vite project. ESLint, Prettier, Vitest. Shell layout with sidebar, theme tokens, CI workflow. | `pnpm tauri dev` opens the shell on Windows. Windows CI is green; the macOS job runs. |
| **1. Core** | `alphabet`, `tokenize`, `timing`, `timeline`, `rng`, `scoring`, basic generators | All of §14.1 except decoder, keyer and storage passes. |
| **2. Audio + Text Player** | Audio engine with lookahead scheduler, keyed gain, raised cosine. Full Text Player (§7.8) except snippets (which need storage). WAV export. Latency check, with results in `docs/latency.md` (on the Windows target machine). | QA items 4 and 10 pass. |
| **3. Storage + profiles + settings** | Migrations, SqliteStore, MemoryStore, contract tests, profiles, settings screens, debounced saving, backups, export/import, v1 import, snippets. | QA items 3, 7 and 8 pass. Storage tests pass. |
| **4. Koch + scoring UI + session flow** | Koch Lessons in full, results diff, char events, `char_stats`, advancement and regression, new-character intro. | QA item 2 passes. A full lesson works end to end. |
| **5. Other copy modes** | Random Groups, Words (with data lists), Callsigns, Custom Practice. | Generators' tests pass. Each mode completes and persists. |
| **6. ICR + adaptive** | ICR mode, response-time stats, adaptive weighting across modes. | QA item 5 passes. Adaptive tests pass. |
| **7. Stats dashboard** | Tiles, character grid, confusion matrix, trends, calendar, history with session replay, "Practice my weak characters". | Dashboard renders from real and seeded data. Replay reproduces the same items. |
| **8. Sending practice** | Keyboard straight key and paddles, iambic keyer, sidetone, decoder, timing analysis, free-send. **8b:** MIDI and serial in Rust. | QA item 6 passes. Decoder and keyer tests pass. |
| **9. Realism + extras** | Noise, QSB, QRM, filter, pileup-lite, QSO simulation, goals, streaks, achievements, optional reminders. | Each feature can be toggled and persists. No audio regressions. |
| **10. Release** | Icons, About, licenses, README rewrite (install notes for SmartScreen), `release.yml`, updater plugin wired to GitHub Releases. | A tag produces the Windows installer (plus the untested `.dmg`). The full QA checklist passes on Windows. |

---

## 16. Open questions

Defaults are in effect until the owner answers.

1. **App name:** "Morse Trainer" (default)?
2. **Default Koch order:** LCWO (default) or Classic (v1)?
3. **Code signing:** ship unsigned (default) and accept the SmartScreen click-through, or sign the Windows installer? Azure Trusted Signing is the cheapest option (about $10/month). An Apple Developer ID isn't needed while macOS is secondary.
4. **Tray icon:** run minimized to the tray so daily reminders work when the window is closed? Default: no tray, and reminders only while the app is running.
5. **Auto-update:** use GitHub Releases on `KeepitSimpleAnalytics/morse_code_app` (default)?
6. **Text Player, new user:** any specifics beyond §7.8, e.g. saving audio as MP3, or sharing Morse as a link or image?
