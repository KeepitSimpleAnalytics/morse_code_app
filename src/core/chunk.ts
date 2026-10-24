import { tokenize } from "./tokenize";

/**
 * Custom Practice chunking (SPEC §7.7): split pasted text into items, by line or
 * into N words per item, kept in order. Characters with no Morse code are dropped
 * before playing and scoring (§8.1) and reported, so nothing is silently lost.
 */

export type ChunkMode =
  { readonly kind: "line" } | { readonly kind: "words"; readonly perItem: number };

export const WORDS_PER_ITEM_MIN = 1;
export const WORDS_PER_ITEM_MAX = 20;

export interface ChunkResult {
  /** Items in order, each normalized: upper case, single spaces, prosigns as "<AR>". */
  readonly items: string[];
  /** Distinct characters that were dropped because they have no Morse code. */
  readonly unsupported: string[];
}

/** Normalizes text to its playable symbols, or "" when nothing is playable. */
function playable(text: string, dropped: Set<string>): string {
  const { tokens, unsupported } = tokenize(text);
  for (const u of unsupported) dropped.add(u.char);
  let out = "";
  for (const t of tokens) {
    if (t.type === "char") out += t.symbol.symbol;
    else if (out !== "" && !out.endsWith(" ")) out += " ";
  }
  return out.trimEnd();
}

export function chunkText(text: string, mode: ChunkMode): ChunkResult {
  if (
    mode.kind === "words" &&
    (!Number.isInteger(mode.perItem) ||
      mode.perItem < WORDS_PER_ITEM_MIN ||
      mode.perItem > WORDS_PER_ITEM_MAX)
  ) {
    throw new RangeError(`words per item must be within 1–20, got ${mode.perItem}`);
  }
  const dropped = new Set<string>();
  let items: string[];
  if (mode.kind === "line") {
    items = text.split(/\r\n|\r|\n/).map((line) => playable(line, dropped));
  } else {
    const words = playable(text, dropped)
      .split(" ")
      .filter((w) => w !== "");
    items = [];
    for (let i = 0; i < words.length; i += mode.perItem) {
      items.push(words.slice(i, i + mode.perItem).join(" "));
    }
  }
  return { items: items.filter((s) => s !== ""), unsupported: [...dropped] };
}
