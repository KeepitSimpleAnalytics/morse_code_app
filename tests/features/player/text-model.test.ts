import { describe, expect, it } from "vitest";
import { tokenize } from "../../../src/core/tokenize";
import {
  classifyEdit,
  overlaySegments,
  tokenIndexAtOffset,
  tokenIndexBySourceStart,
} from "../../../src/features/player/text-model";

describe("tokenIndexAtOffset (play from cursor)", () => {
  const tokens = tokenize("AB  CD").tokens; // A B _ C D, gap spans offsets 2–4

  it("picks the character under the caret", () => {
    expect(tokenIndexAtOffset(tokens, 0)).toBe(0);
    expect(tokenIndexAtOffset(tokens, 1)).toBe(1);
    expect(tokenIndexAtOffset(tokens, 4)).toBe(3);
  });

  it("skips to the next word from whitespace", () => {
    expect(tokenIndexAtOffset(tokens, 2)).toBe(3);
    expect(tokenIndexAtOffset(tokens, 3)).toBe(3);
  });

  it("returns null past the end", () => {
    expect(tokenIndexAtOffset(tokens, 6)).toBeNull();
  });

  it("finds tokens by source start", () => {
    expect(tokenIndexBySourceStart(tokens, 5)).toBe(4);
    expect(tokenIndexBySourceStart(tokens, 3)).toBeNull();
  });
});

describe("classifyEdit (type-to-transmit)", () => {
  it("detects typing at the end, deleting from the end, and other edits", () => {
    expect(classifyEdit("CQ", "CQ D")).toEqual({ kind: "append", added: " D", at: 2 });
    expect(classifyEdit("CQ DE", "CQ")).toEqual({ kind: "truncate", from: 2 });
    expect(classifyEdit("CQ", "XQ")).toEqual({ kind: "other" });
    expect(classifyEdit("CQ", "CQ")).toEqual({ kind: "other" });
  });
});

describe("overlaySegments", () => {
  it("covers the text exactly and marks active, unsupported and start", () => {
    const segs = overlaySegments(10, { start: 2, end: 3 }, [{ index: 5, char: "#" }], 7);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 3],
      [3, 5],
      [5, 6],
      [6, 7],
      [7, 10],
    ]);
    expect(segs.find((s) => s.active)).toMatchObject({ start: 2, end: 3 });
    expect(segs.find((s) => s.unsupported)).toMatchObject({ start: 5, end: 6 });
    expect(segs.find((s) => s.startMark)).toMatchObject({ start: 7 });
  });

  it("handles astral unsupported characters (two UTF-16 units)", () => {
    const segs = overlaySegments(3, null, [{ index: 0, char: "\u{1F600}" }], null);
    expect(segs[0]).toMatchObject({ start: 0, end: 2, unsupported: true });
  });
});
