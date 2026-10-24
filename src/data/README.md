# Bundled data: sources and licenses

Every bundled data file is listed here with its source and license (CLAUDE.md, SPEC §13).

## `koch-orders.json`

Character sequences are facts, so they aren't copyrightable. The sources are credited below, and each order was checked character by character on 2026-10-23. `tests/core/koch.test.ts` locks them in.

| Order            | Source                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lcwo` (default) | LCWO source code, the global `$kochchar` array in [`inc/functions.php`](https://github.com/dj1yfk/lcwo/blob/master/inc/functions.php) (Fabian Kurz, DJ1YFK). The admin says the order came from DF2OK's site ([forum thread](https://lcwo.net/forum/628)).                                    | 41 characters. A different array in `inc/courselesson.php` is a per-user override (`uid == 161`) and doesn't apply. Cross-checked against the "LCWO" order on [morsecode.world](https://morsecode.world/international/trainer/character.html). |
| `g4fon`          | Dave Finley N1IRZ, "suggested sequence" in his Koch method article ([qsl.net/kb5wck/super.html](http://www.qsl.net/kb5wck/super.html), © 1994). The [G4FON trainer page](http://web.archive.org/web/2015/http://www.g4fon.net/CW%20Trainer.htm) cites this article as the basis of its order. | 40 characters. Identical to the "Koch (as used in G4FON)" order on morsecode.world. N1IRZ's list continues with the prosigns `<BT> <SK> <AR>`; SPEC §7.1 leaves them out, and so does this file.                                               |
| `classic-v1`     | Morse Trainer v1, `KOCH_SEQUENCE` in `legacy/v1/morse.js`.                                                                                                                                                                                                                                    | 37 characters: the G4FON order with `.` `,` `/` removed (`?` is kept). A test reads the v1 file to confirm the match.                                                                                                                          |

## Word lists (`v1-common.json`, `cw-abbrev.json`, `qcodes.json`)

Each file is `{id, name, source, license, items}`, and each item is `{word, meaning?}`. The lists were checked against the sources below on 2026-10-23, and `tests/core/practice-generators.test.ts` locks in their sizes and that every word can be played.

| File             | Source                                                                                                                                                                                                                                                                                                                                                               | License                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `v1-common.json` | Morse Trainer v1, `COMMON_WORDS` in `legacy/v1/morse.js`. A test reads the v1 file to confirm the match.                                                                                                                                                                                                                                                             | Part of this project.                                                 |
| `cw-abbrev.json` | Common amateur CW abbreviations, checked against [Wikipedia's Morse code abbreviations](https://en.wikipedia.org/wiki/Morse_code_abbreviations), the [Pierpont list](https://www.qsl.net/ng3p/haminfo/pierpont/c27.htm) and the [W3DF list](https://www.qsl.net/w3df/cwabbrev.html). NAME, INFO, TEMP, HAM and SOLID are common QSO words rather than abbreviations. | Abbreviations are facts. The meanings are this project's own wording. |
| `qcodes.json`    | The ITU-R M.1172 Q-code series, checked against [Wikipedia's Q code tables](https://en.wikipedia.org/wiki/Q_code) and the [ARRL Q-signal list](https://www.qsl.net/n4emp/Qsignals.html). QST and QNI are ARRL amateur signals. It includes all 18 v1 Q-codes, and a test confirms this.                                                                              | Codes are facts. The meanings are this project's own wording.         |

## `prefixes.json`

There are 249 callsign prefixes from the ITU table of allocation of international call sign series (Radio Regulations Appendix 42), limited to the prefixes amateurs use followed by a digit. Each entry is `{prefix, entity, weight, us?, digits?}`.

- **Weights** are this project's own rough estimate of on-air activity. They are not measured data.
- **`us`** marks the United States blocks used by "US only" (W, K, N, AA–AK, KA–KU, WA–WE).
- **`digits`** limits the digit where only some digits mean the entity: HB0 is Liechtenstein, not Switzerland; PJ2/PJ4 are Curaçao and Bonaire; VR2 is Hong Kong; 3D2 is Fiji.
- SE was left out because it isn't confirmed as an amateur prefix in Sweden, and C6 (Bahamas) because its calls have no digit after the prefix (C6A…).
- Allocations are facts. The weights are this project's own.
