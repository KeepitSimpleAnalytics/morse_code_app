import { decodePattern } from "./alphabet";
import type { Token } from "./tokenize";

/**
 * Text ↔ Morse code text, for the Text Player (SPEC §7.8): rendering the code view
 * in three formats, and reverse-decoding pasted dots and dashes.
 */

export type CodeFormat = "ascii" | "dots" | "phonetic";
export type WordSeparator = "slash" | "space";

export const CODE_FORMAT_LABELS: Record<CodeFormat, string> = {
  ascii: ".-",
  dots: "·–",
  phonetic: "di-dah",
};

/** The code for one token in the given format. Gaps render as the word separator. */
export function tokenCode(token: Token, format: CodeFormat, wordSep: WordSeparator): string {
  if (token.type === "gap") return wordSep === "slash" ? "/" : "";
  const { pattern, phonetic } = token.symbol;
  switch (format) {
    case "ascii":
      return pattern;
    case "dots":
      return pattern.replaceAll(".", "·").replaceAll("-", "–");
    case "phonetic":
      return phonetic;
  }
}

/** The whole code as one string: letters separated by spaces, words by " / " (or 3 spaces). */
export function codeText(
  tokens: readonly Token[],
  format: CodeFormat,
  wordSep: WordSeparator,
): string {
  const wordGap = wordSep === "slash" ? " / " : "   ";
  let out = "";
  tokens.forEach((t, i) => {
    if (t.type === "gap") {
      out += wordGap;
      return;
    }
    if (i > 0 && tokens[i - 1]?.type === "char") out += " ";
    out += tokenCode(t, format, wordSep);
  });
  return out;
}

export interface DecodeError {
  /** The offending sequence as written. */
  readonly sequence: string;
  /** Offset into the input. */
  readonly index: number;
  readonly reason: "unknown-pattern" | "invalid-character";
}

export interface DecodeResult {
  readonly text: string;
  readonly errors: DecodeError[];
}

export const INVALID_MARK = "�";

// SPEC §7.8 accepts ".", "-", "·" (U+00B7), "–" (U+2013) and "_".
const DOT = new Set([".", "·"]);
const DAH = new Set(["-", "–", "_"]);

/** Word separators: "/", "|", a line break, or three or more spaces. */
const WORD_SEPARATOR = /\s*[/|]\s*|\s*\n\s*|\s{3,}/g;

/**
 * Decodes Morse written as text. Letters are separated by one or two spaces.
 * Unknown sequences become "�" and are listed in `errors`.
 */
export function decodeMorseText(
  input: string,
  { preferProsigns = true }: { preferProsigns?: boolean } = {},
): DecodeResult {
  const errors: DecodeError[] = [];
  const spans: { text: string; start: number }[] = [];
  let cursor = 0;
  for (const m of input.matchAll(WORD_SEPARATOR)) {
    spans.push({ text: input.slice(cursor, m.index), start: cursor });
    cursor = m.index + m[0].length;
  }
  spans.push({ text: input.slice(cursor), start: cursor });

  const words: string[] = [];
  for (const { text, start } of spans) {
    let word = "";
    for (const m of text.matchAll(/\S+/g)) {
      const raw = m[0];
      let pattern = "";
      let invalid = false;
      for (const ch of raw) {
        if (DOT.has(ch)) pattern += ".";
        else if (DAH.has(ch)) pattern += "-";
        else invalid = true;
      }
      const symbol = invalid ? undefined : decodePattern(pattern, { preferProsigns });
      if (symbol) {
        word += symbol.symbol;
      } else {
        word += INVALID_MARK;
        errors.push({
          sequence: raw,
          index: start + m.index,
          reason: invalid ? "invalid-character" : "unknown-pattern",
        });
      }
    }
    if (word.length > 0) words.push(word);
  }
  return { text: words.join(" "), errors };
}
