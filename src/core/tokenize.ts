import { lookupSymbol, type MorseSymbol } from "./alphabet";

/**
 * Tokenizer (SPEC §5.2). Turns free text into Morse tokens, keeping offsets into
 * the original text so the UI can highlight what's playing.
 */

export interface CharToken {
  readonly type: "char";
  readonly symbol: MorseSymbol;
  /** UTF-16 offsets into the original text, end exclusive. */
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface GapToken {
  readonly type: "gap";
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export type Token = CharToken | GapToken;

export interface Unsupported {
  readonly char: string;
  /** UTF-16 offset into the original text. */
  readonly index: number;
}

export interface TokenizeResult {
  readonly tokens: Token[];
  readonly unsupported: Unsupported[];
}

const QUOTE_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
};

const WHITESPACE = /^\s$/u;
const PROSIGN = /^<([A-Za-z]{2,3})>/;

/** Normalizes one code point: NFKC, straight quotes, upper case. May yield several chars. */
function normalizeCodePoint(cp: string): string {
  const nfkc = cp.normalize("NFKC");
  return [...nfkc]
    .map((c) => QUOTE_MAP[c] ?? c)
    .join("")
    .toUpperCase();
}

export function tokenize(text: string): TokenizeResult {
  const raw: Token[] = [];
  const unsupported: Unsupported[] = [];

  let i = 0;
  while (i < text.length) {
    // Prosign token: "<AR>" (case-insensitive). Unknown ones fall through and are
    // tokenized character by character, with the brackets reported as unsupported.
    if (text[i] === "<") {
      const m = PROSIGN.exec(text.slice(i));
      const symbol = m?.[1] ? lookupSymbol(`<${m[1].toUpperCase()}>`) : undefined;
      if (m && symbol) {
        raw.push({ type: "char", symbol, sourceStart: i, sourceEnd: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }

    const cp = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const start = i;
    const end = i + cp.length;
    i = end;

    if (WHITESPACE.test(cp)) {
      raw.push({ type: "gap", sourceStart: start, sourceEnd: end });
      continue;
    }

    for (const c of normalizeCodePoint(cp)) {
      if (WHITESPACE.test(c)) {
        raw.push({ type: "gap", sourceStart: start, sourceEnd: end });
        continue;
      }
      const symbol = c === "<" || c === ">" ? undefined : lookupSymbol(c);
      if (symbol && symbol.kind !== "prosign") {
        raw.push({ type: "char", symbol, sourceStart: start, sourceEnd: end });
      } else {
        unsupported.push({ char: cp, index: start });
        break;
      }
    }
  }

  return { tokens: collapseGaps(raw), unsupported };
}

/** Merges runs of gaps into one, and drops leading and trailing gaps. */
function collapseGaps(raw: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of raw) {
    const prev = out[out.length - 1];
    if (t.type === "gap") {
      if (!prev) continue;
      if (prev.type === "gap") {
        out[out.length - 1] = { ...prev, sourceEnd: t.sourceEnd };
        continue;
      }
    }
    out.push(t);
  }
  if (out[out.length - 1]?.type === "gap") out.pop();
  return out;
}

export function charTokens(tokens: readonly Token[]): CharToken[] {
  return tokens.filter((t): t is CharToken => t.type === "char");
}
