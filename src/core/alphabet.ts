/**
 * The Morse alphabet (SPEC §5.1). Patterns use "." and "-".
 *
 * Letters, digits and punctuation follow ITU-R M.1677-1. `!` and `&` are not ITU
 * but are in common use, so they are included and flagged `nonStandard`.
 * Prosigns are written as `<XX>` tokens.
 */

export type SymbolKind = "letter" | "digit" | "punct" | "prosign";

export interface MorseSymbol {
  /** The text form: "A", "5", "?", or "<AR>" for prosigns. */
  readonly symbol: string;
  readonly pattern: string;
  readonly kind: SymbolKind;
  readonly name?: string;
  /** "di-dah" rendering, e.g. K = "dah-di-dah". */
  readonly phonetic: string;
  readonly nonStandard?: true;
}

/** Spoken rendering: every element is "di"/"dah", except a final dot, which is "dit". */
export function phoneticOf(pattern: string): string {
  return [...pattern]
    .map((el, i) => (el === "-" ? "dah" : i === pattern.length - 1 ? "dit" : "di"))
    .join("-");
}

type Entry = [symbol: string, pattern: string, name?: string, nonStandard?: true];

const LETTERS: Entry[] = [
  ["A", ".-"],
  ["B", "-..."],
  ["C", "-.-."],
  ["D", "-.."],
  ["E", "."],
  ["F", "..-."],
  ["G", "--."],
  ["H", "...."],
  ["I", ".."],
  ["J", ".---"],
  ["K", "-.-"],
  ["L", ".-.."],
  ["M", "--"],
  ["N", "-."],
  ["O", "---"],
  ["P", ".--."],
  ["Q", "--.-"],
  ["R", ".-."],
  ["S", "..."],
  ["T", "-"],
  ["U", "..-"],
  ["V", "...-"],
  ["W", ".--"],
  ["X", "-..-"],
  ["Y", "-.--"],
  ["Z", "--.."],
];

const DIGITS: Entry[] = [
  ["0", "-----"],
  ["1", ".----"],
  ["2", "..---"],
  ["3", "...--"],
  ["4", "....-"],
  ["5", "....."],
  ["6", "-...."],
  ["7", "--..."],
  ["8", "---.."],
  ["9", "----."],
];

const PUNCTUATION: Entry[] = [
  [".", ".-.-.-", "Full stop"],
  [",", "--..--", "Comma"],
  ["?", "..--..", "Question mark"],
  ["/", "-..-.", "Slash"],
  ["=", "-...-", "Equals / double hyphen"],
  ["+", ".-.-.", "Plus"],
  ["-", "-....-", "Hyphen"],
  ["'", ".----.", "Apostrophe"],
  ['"', ".-..-.", "Quotation mark"],
  ["(", "-.--.", "Open bracket"],
  [")", "-.--.-", "Close bracket"],
  [":", "---...", "Colon"],
  [";", "-.-.-.", "Semicolon"],
  ["@", ".--.-.", "At sign"],
  ["!", "-.-.--", "Exclamation mark", true],
  ["&", ".-...", "Ampersand", true],
];

const PROSIGNS: Entry[] = [
  ["<AR>", ".-.-.", "End of message"],
  ["<SK>", "...-.-", "End of contact"],
  ["<BT>", "-...-", "Break / new paragraph"],
  ["<KN>", "-.--.", "Invitation to a named station only"],
  ["<AS>", ".-...", "Wait"],
  ["<BK>", "-...-.-", "Break-in"],
  ["<CL>", "-.-..-..", "Closing station"],
  ["<SOS>", "...---...", "Distress"],
  ["<HH>", "........", "Error"],
];

function build(entries: Entry[], kind: SymbolKind): MorseSymbol[] {
  return entries.map(([symbol, pattern, name, nonStandard]) => ({
    symbol,
    pattern,
    kind,
    phonetic: phoneticOf(pattern),
    ...(name === undefined ? {} : { name }),
    ...(nonStandard ? { nonStandard } : {}),
  }));
}

export const ALPHABET: readonly MorseSymbol[] = [
  ...build(LETTERS, "letter"),
  ...build(DIGITS, "digit"),
  ...build(PUNCTUATION, "punct"),
  ...build(PROSIGNS, "prosign"),
];

const BY_SYMBOL = new Map(ALPHABET.map((s) => [s.symbol, s]));
const BY_PATTERN = new Map<string, MorseSymbol[]>();
for (const s of ALPHABET) {
  const list = BY_PATTERN.get(s.pattern);
  if (list) list.push(s);
  else BY_PATTERN.set(s.pattern, [s]);
}

export function lookupSymbol(symbol: string): MorseSymbol | undefined {
  return BY_SYMBOL.get(symbol);
}

/** Every symbol with this pattern. Some patterns are shared, e.g. "=" and "<BT>". */
export function symbolsForPattern(pattern: string): readonly MorseSymbol[] {
  return BY_PATTERN.get(pattern) ?? [];
}

/**
 * Decodes one character pattern. Where a pattern is shared by a character and a
 * prosign ("=" / <BT>, "+" / <AR>, "&" / <AS>, "(" / <KN>), the prosign wins when
 * `preferProsigns` is on (the "Decode prosigns" setting, default on).
 */
export function decodePattern(
  pattern: string,
  { preferProsigns = true }: { preferProsigns?: boolean } = {},
): MorseSymbol | undefined {
  const candidates = symbolsForPattern(pattern);
  if (candidates.length <= 1) return candidates[0];
  return candidates.find((s) => (s.kind === "prosign") === preferProsigns) ?? candidates[0];
}

export const LETTER_SYMBOLS = ALPHABET.filter((s) => s.kind === "letter").map((s) => s.symbol);
export const DIGIT_SYMBOLS = ALPHABET.filter((s) => s.kind === "digit").map((s) => s.symbol);
export const PUNCT_SYMBOLS = ALPHABET.filter((s) => s.kind === "punct").map((s) => s.symbol);
export const PROSIGN_SYMBOLS = ALPHABET.filter((s) => s.kind === "prosign").map((s) => s.symbol);
