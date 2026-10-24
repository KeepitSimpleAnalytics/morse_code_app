import { DIGIT_SYMBOLS, LETTER_SYMBOLS, PROSIGN_SYMBOLS, PUNCT_SYMBOLS } from "./alphabet";
import { tokenize } from "./tokenize";

/**
 * Character sets for Random Groups (SPEC §7.3): any mix of letters, digits,
 * punctuation and prosigns, or a custom string. Symbols are in alphabet order,
 * with prosigns written as "<AR>".
 */

export interface CharClasses {
  readonly letters: boolean;
  readonly digits: boolean;
  readonly punct: boolean;
  readonly prosigns: boolean;
}

/** A set needs two different characters, so no character runs more than 3 in a row (§8.3). */
export const MIN_CHARSET = 2;

export function charsetFromClasses(c: CharClasses): string[] {
  return [
    ...(c.letters ? LETTER_SYMBOLS : []),
    ...(c.digits ? DIGIT_SYMBOLS : []),
    ...(c.punct ? PUNCT_SYMBOLS : []),
    ...(c.prosigns ? PROSIGN_SYMBOLS : []),
  ];
}

export interface CustomCharset {
  /** Distinct symbols in the order first typed. Spaces are ignored. */
  readonly chars: string[];
  /** Distinct characters that have no Morse code, in the order first typed. */
  readonly unsupported: string[];
}

/** Parses a custom set such as "KMRS<AR>". Case is ignored. */
export function parseCustomCharset(text: string): CustomCharset {
  const { tokens, unsupported } = tokenize(text);
  const chars: string[] = [];
  for (const t of tokens) {
    if (t.type === "char" && !chars.includes(t.symbol.symbol)) chars.push(t.symbol.symbol);
  }
  return { chars, unsupported: [...new Set(unsupported.map((u) => u.char))] };
}
