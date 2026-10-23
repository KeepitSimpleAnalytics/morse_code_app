import type { Token } from "../../core/tokenize";

/**
 * Pure helpers mapping between text offsets and tokens for the Text Player.
 */

/**
 * The index of the token to start playing from for a caret/click offset: the token
 * containing the offset, else the next character token after it. Null past the end.
 */
export function tokenIndexAtOffset(tokens: readonly Token[], offset: number): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (offset < t.sourceEnd) {
      if (t.type === "gap") return i + 1 < tokens.length ? i + 1 : null;
      return i;
    }
  }
  return null;
}

/** The token whose source starts at `start`, by binary search (tokens are in order). */
export function tokenIndexBySourceStart(tokens: readonly Token[], start: number): number | null {
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = (tokens[mid] as Token).sourceStart;
    if (s === start) return mid;
    if (s < start) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export type TextEdit =
  | { readonly kind: "append"; readonly added: string; readonly at: number }
  | { readonly kind: "truncate"; readonly from: number }
  | { readonly kind: "other" };

/** Classifies a text change for type-to-transmit: typing at the end, or deleting from it. */
export function classifyEdit(prev: string, next: string): TextEdit {
  if (next.length > prev.length && next.startsWith(prev)) {
    return { kind: "append", added: next.slice(prev.length), at: prev.length };
  }
  if (next.length < prev.length && prev.startsWith(next))
    return { kind: "truncate", from: next.length };
  return { kind: "other" };
}

export interface OverlaySegment {
  readonly start: number;
  readonly end: number;
  readonly active: boolean;
  readonly unsupported: boolean;
  /** The play-from point starts at this segment. */
  readonly startMark: boolean;
}

/**
 * Splits text into segments for the editor overlay: the character being heard,
 * unsupported characters, and the play-from marker. Segments cover the text exactly.
 */
export function overlaySegments(
  textLength: number,
  active: { start: number; end: number } | null,
  unsupported: readonly { index: number; char: string }[],
  startOffset: number | null,
): OverlaySegment[] {
  const cuts = new Set<number>([0, textLength]);
  const clamp = (n: number) => Math.max(0, Math.min(textLength, n));
  if (active) {
    cuts.add(clamp(active.start));
    cuts.add(clamp(active.end));
  }
  for (const u of unsupported) {
    cuts.add(clamp(u.index));
    cuts.add(clamp(u.index + u.char.length));
  }
  if (startOffset !== null) cuts.add(clamp(startOffset));
  const points = [...cuts].sort((a, b) => a - b);
  const bad = new Set(unsupported.map((u) => u.index));
  const out: OverlaySegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    if (end <= start) continue;
    out.push({
      start,
      end,
      active: active !== null && start >= active.start && end <= active.end,
      unsupported: bad.has(start),
      startMark: startOffset !== null && start === startOffset && startOffset > 0,
    });
  }
  return out;
}
