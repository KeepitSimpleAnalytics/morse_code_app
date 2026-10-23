import { describe, expect, it } from "vitest";
import { charsPerMinute, scoreRevealed, scoreTrial } from "../../src/core/scoring";

/** Compact rendering of the alignment: "K" correct, "H>s" substituted, "_K" missed, "+x" inserted. */
function diff(sent: string, typed: string): string {
  return scoreTrial(sent, typed)
    .ops.map((op) => {
      switch (op.op) {
        case "correct":
          return op.sent;
        case "substituted":
          return `${op.sent}>${op.typed}`;
        case "missed":
          return `_${op.sent}`;
        case "inserted":
          return `+${op.typed}`;
        case "gap":
          return op.kind === "matched" ? "|" : op.kind === "missed" ? "_|" : "+|";
      }
    })
    .join(" ");
}

describe("scoreTrial: SPEC §8.2 required cases", () => {
  it("identical text", () => {
    const s = scoreTrial("KMRSU", "kmrsu");
    expect(s.accuracy).toBe(1);
    expect(s.errors).toBe(0);
    expect(s.correct).toBe(5);
  });

  it("every token missed", () => {
    const s = scoreTrial("ABC DE", "XYZ");
    expect(s.correct).toBe(0);
    expect(s.accuracy).toBe(0);
  });

  it("one insertion at the start does not cascade", () => {
    const s = scoreTrial("PARIS", "XPARIS");
    expect(diff("PARIS", "XPARIS")).toBe("+X P A R I S");
    expect(s.correct).toBe(5);
    expect(s.insertions).toBe(1);
    expect(s.accuracy).toBeCloseTo(0.8, 12);
  });

  it("swapped characters are two substitutions", () => {
    const s = scoreTrial("AB", "BA");
    expect(diff("AB", "BA")).toBe("A>B B>A");
    expect(s.substitutions).toBe(2);
    expect(s.accuracy).toBe(0);
  });

  it("a prosign typed as its matching character is correct", () => {
    expect(scoreTrial("CQ <AR>", "CQ +").accuracy).toBe(1);
    expect(scoreTrial("CQ <AR>", "cq <ar>").accuracy).toBe(1);
    expect(scoreTrial("TU <BT>", "TU =").accuracy).toBe(1);
    expect(scoreTrial("A+B", "A<AR>B").accuracy).toBe(1);
  });

  it("extra spaces and newlines in the answer don't count (SPEC §4 defect 8)", () => {
    const s = scoreTrial("CQ DE W1ABC", "  cq\n\nde    w1abc \n");
    expect(s.accuracy).toBe(1);
    expect(s.errors).toBe(0);
  });

  it("empty answer: everything missed", () => {
    const s = scoreTrial("KM KM", "");
    expect(s.misses).toBe(4);
    expect(s.accuracy).toBe(0);
    expect(s.chars.every((c) => c.outcome === "missed")).toBe(true);
  });

  it("answer longer than the prompt: insertions, accuracy floored at 0", () => {
    const s = scoreTrial("K", "KMMMM");
    expect(s.correct).toBe(1);
    expect(s.insertions).toBe(4);
    expect(s.accuracy).toBe(0);
    expect(scoreTrial("KMRS", "KMRSX").accuracy).toBeCloseTo(0.75, 12);
  });
});

describe("scoreTrial: details", () => {
  it("excludes word gaps from accuracy but aligns them", () => {
    expect(diff("AB CD", "ABCD")).toBe("A B _| C D");
    expect(scoreTrial("AB CD", "ABCD").accuracy).toBe(1);
    expect(scoreTrial("ABCD", "AB CD").accuracy).toBe(1);
  });

  it("never aligns a character with a space", () => {
    expect(diff("ABC", "A C")).toBe("A +| _B C");
  });

  it("records per-character outcomes for char_events", () => {
    expect(scoreTrial("HSE", "SSX").chars).toEqual([
      { ch: "H", outcome: "substituted", typed: "S" },
      { ch: "S", outcome: "correct" },
      { ch: "E", outcome: "substituted", typed: "X" },
    ]);
  });

  it("treats typed unsupported characters as wrong, not invisible", () => {
    const s = scoreTrial("E", "é");
    expect(s.chars).toEqual([{ ch: "E", outcome: "substituted", typed: "é" }]);
  });

  it("excludes unsupported prompt characters from scoring (SPEC §4 defect 7)", () => {
    const s = scoreTrial("A#B", "AB");
    expect(s.sentCharCount).toBe(2);
    expect(s.accuracy).toBe(1);
  });

  it("refuses to score a prompt with nothing playable", () => {
    expect(() => scoreTrial("###", "x")).toThrow(/no playable/);
  });

  it("scores a reveal as every character missed (SPEC §4 defect 4)", () => {
    const s = scoreRevealed("CQ CQ");
    expect(s.misses).toBe(4);
    expect(s.accuracy).toBe(0);
  });

  it("computes characters per minute of audio", () => {
    expect(charsPerMinute(50, 60000)).toBe(50);
    expect(charsPerMinute(10, 30000)).toBe(20);
    expect(() => charsPerMinute(1, 0)).toThrow(RangeError);
  });
});
