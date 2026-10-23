import { tokenize, type CharToken, type Token } from "./tokenize";

/**
 * Per-character scoring (SPEC §8). Both texts are tokenized, aligned with a
 * Levenshtein backtrace, and every sent character gets an outcome.
 */

/** A typed character the tokenizer couldn't map to Morse. It never matches. */
interface UnknownToken {
  readonly type: "unknown";
  readonly char: string;
}

type TypedToken = Token | UnknownToken;

export type AlignmentOp =
  | { readonly op: "correct"; readonly sent: string; readonly typed: string }
  | { readonly op: "substituted"; readonly sent: string; readonly typed: string }
  | { readonly op: "missed"; readonly sent: string }
  | { readonly op: "inserted"; readonly typed: string }
  /** Word gaps align too, but never count towards accuracy (SPEC §8.2). */
  | { readonly op: "gap"; readonly kind: "matched" | "missed" | "inserted" };

export type CharOutcome = "correct" | "substituted" | "missed";

export interface CharResult {
  /** The sent symbol, e.g. "K" or "<AR>". */
  readonly ch: string;
  readonly outcome: CharOutcome;
  /** What was typed in its place, for substitutions. */
  readonly typed?: string;
}

export interface TrialScore {
  readonly ops: AlignmentOp[];
  /** One entry per sent character, in order (the source of char_events). */
  readonly chars: CharResult[];
  readonly sentCharCount: number;
  readonly correct: number;
  readonly substitutions: number;
  readonly misses: number;
  readonly insertions: number;
  readonly errors: number;
  /** max(0, 1 − errors / sentCharCount). */
  readonly accuracy: number;
}

const GAP_TEXT = " ";

function textOf(t: TypedToken): string {
  if (t.type === "char") return t.symbol.symbol;
  if (t.type === "unknown") return t.char;
  return GAP_TEXT;
}

/**
 * Two characters match when they sound the same. Typing "+" for <AR>, or "=" for
 * <BT>, is correct (SPEC §8.1): the listener cannot tell them apart.
 */
function sameSound(a: CharToken, b: TypedToken): boolean {
  return b.type === "char" && a.symbol.pattern === b.symbol.pattern;
}

/** Tokenizes typed text, keeping unsupported characters in place as unknown tokens. */
function tokenizeTyped(text: string): TypedToken[] {
  const { tokens, unsupported } = tokenize(text);
  if (unsupported.length === 0) return tokens;
  const located: { at: number; token: TypedToken }[] = [
    ...tokens.map((token) => ({ at: token.sourceStart, token })),
    ...unsupported.map((u) => ({ at: u.index, token: { type: "unknown", char: u.char } as const })),
  ];
  return located.sort((x, y) => x.at - y.at).map((l) => l.token);
}

const INF = Number.POSITIVE_INFINITY;

function subCost(s: Token, t: TypedToken): number {
  if (s.type === "gap") return t.type === "gap" ? 0 : INF;
  if (t.type === "gap") return INF; // a character never aligns with a space
  return sameSound(s, t) ? 0 : 1;
}

/** Aligns already-tokenized sent text against typed text. */
export function alignTokens(sent: readonly Token[], typedText: string): TrialScore {
  const sentCharCount = sent.filter((t) => t.type === "char").length;
  if (sentCharCount === 0) {
    throw new Error("Cannot score a prompt with no playable characters");
  }
  const typed = tokenizeTyped(typedText);
  const n = sent.length;
  const m = typed.length;

  // dp[i][j]: cost of aligning sent[0..i) with typed[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const row = (i: number): number[] => dp[i] as number[];
  for (let i = 1; i <= n; i++) row(i)[0] = i;
  for (let j = 1; j <= m; j++) row(0)[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sent[i - 1] as Token;
      const t = typed[j - 1] as TypedToken;
      row(i)[j] = Math.min(
        (row(i - 1)[j - 1] as number) + subCost(s, t),
        (row(i - 1)[j] as number) + 1,
        (row(i)[j - 1] as number) + 1,
      );
    }
  }

  // Backtrace. Ties prefer a diagonal step (match/substitution) over an
  // insertion/deletion pair, then a deletion (missed) over an insertion.
  const ops: AlignmentOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cur = row(i)[j] as number;
    const s = i > 0 ? (sent[i - 1] as Token) : undefined;
    const t = j > 0 ? (typed[j - 1] as TypedToken) : undefined;
    if (s && t && cur === (row(i - 1)[j - 1] as number) + subCost(s, t)) {
      if (s.type === "gap") ops.push({ op: "gap", kind: "matched" });
      else if (sameSound(s, t))
        ops.push({ op: "correct", sent: s.symbol.symbol, typed: textOf(t) });
      else ops.push({ op: "substituted", sent: s.symbol.symbol, typed: textOf(t) });
      i--;
      j--;
    } else if (s && cur === (row(i - 1)[j] as number) + 1) {
      ops.push(
        s.type === "gap" ? { op: "gap", kind: "missed" } : { op: "missed", sent: s.symbol.symbol },
      );
      i--;
    } else if (t) {
      ops.push(
        t.type === "gap" ? { op: "gap", kind: "inserted" } : { op: "inserted", typed: textOf(t) },
      );
      j--;
    } else {
      throw new Error("Alignment backtrace failed"); // unreachable with a valid table
    }
  }
  ops.reverse();

  const chars: CharResult[] = [];
  let correct = 0;
  let substitutions = 0;
  let misses = 0;
  let insertions = 0;
  for (const op of ops) {
    switch (op.op) {
      case "correct":
        correct++;
        chars.push({ ch: op.sent, outcome: "correct" });
        break;
      case "substituted":
        substitutions++;
        chars.push({ ch: op.sent, outcome: "substituted", typed: op.typed });
        break;
      case "missed":
        misses++;
        chars.push({ ch: op.sent, outcome: "missed" });
        break;
      case "inserted":
        insertions++;
        break;
      case "gap":
        break;
    }
  }
  const errors = substitutions + misses + insertions;
  return {
    ops,
    chars,
    sentCharCount,
    correct,
    substitutions,
    misses,
    insertions,
    errors,
    accuracy: Math.max(0, 1 - errors / sentCharCount),
  };
}

/** Scores typed text against the sent text. Unsupported prompt characters are excluded. */
export function scoreTrial(sentText: string, typedText: string): TrialScore {
  return alignTokens(tokenize(sentText).tokens, typedText);
}

/** A revealed trial: every sent character counts as missed (SPEC §4 defect 4). */
export function scoreRevealed(sentText: string): TrialScore {
  return scoreTrial(sentText, "");
}

/** Correct characters per minute of audio. */
export function charsPerMinute(correctChars: number, audioMs: number): number {
  if (!Number.isFinite(audioMs) || audioMs <= 0) {
    throw new RangeError(`audioMs must be positive, got ${audioMs}`);
  }
  return (correctChars * 60000) / audioMs;
}
