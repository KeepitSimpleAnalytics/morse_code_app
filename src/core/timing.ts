/**
 * Morse timing (SPEC §5.3), using the PARIS standard: one word is 50 dot units.
 * Farnsworth spacing follows the ARRL formula: characters keep their full speed and
 * the extra time is spread over the 19 spacing units in PARIS.
 */

export interface TimingInput {
  /** Character speed, WPM. */
  readonly charWpm: number;
  /** Effective (Farnsworth) speed, WPM. At or above charWpm means no extra spacing. */
  readonly effWpm: number;
  /** Extra word-spacing multiplier, 1.0–3.0, applied to the word gap. Default 1. */
  readonly wordSpacing?: number;
}

/** All durations in milliseconds. */
export interface Timing {
  readonly dot: number;
  readonly dah: number;
  /** Silence between the elements of one character. */
  readonly elementGap: number;
  /** Silence between characters (replaces the element gap). */
  readonly charGap: number;
  /** Silence between words (replaces the character gap). */
  readonly wordGap: number;
}

export const WORD_SPACING_MIN = 1;
export const WORD_SPACING_MAX = 3;

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

/** Length of one dot unit in ms at the given character speed. */
export function dotMs(charWpm: number): number {
  assertPositive("charWpm", charWpm);
  return 1200 / charWpm;
}

/** The extra spacing unit added by Farnsworth timing (0 when effWpm >= charWpm). */
export function farnsworthExtraUnit(charWpm: number, effWpm: number): number {
  assertPositive("effWpm", effWpm);
  if (effWpm >= charWpm) return 0;
  return (60000 / effWpm - 50 * dotMs(charWpm)) / 19;
}

export function computeTiming({ charWpm, effWpm, wordSpacing = 1 }: TimingInput): Timing {
  if (
    !Number.isFinite(wordSpacing) ||
    wordSpacing < WORD_SPACING_MIN ||
    wordSpacing > WORD_SPACING_MAX
  ) {
    throw new RangeError(`wordSpacing must be within 1.0–3.0, got ${wordSpacing}`);
  }
  const dot = dotMs(charWpm);
  const extra = farnsworthExtraUnit(charWpm, effWpm);
  return {
    dot,
    dah: 3 * dot,
    elementGap: dot,
    charGap: 3 * dot + 3 * extra,
    wordGap: (7 * dot + 7 * extra) * wordSpacing,
  };
}
