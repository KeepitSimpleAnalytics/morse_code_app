import { describe, expect, it } from "vitest";
import v1Source from "../../legacy/v1/morse.js?raw";
import { lookupSymbol } from "../../src/core/alphabet";
import {
  kochChars,
  kochOrder,
  KOCH_ORDERS,
  maxKochLevel,
  newestKochChar,
} from "../../src/core/koch";

// Verified on 2026-10-23 against the sources recorded in src/data/README.md.
const VERIFIED = {
  lcwo: "K M U R E S N A P T L W I . J Z = F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X",
  g4fon: "K M R S U A P T L O W I . N J E F 0 Y , V G 5 / Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X",
  "classic-v1": "K M R S U A P T L O W I N J E F 0 Y V G 5 Q 9 Z H 3 8 B ? 4 2 7 C 1 D 6 X",
} as const;

describe("Koch orders", () => {
  it("match the verified sequences exactly", () => {
    for (const [id, seq] of Object.entries(VERIFIED)) {
      expect(kochOrder(id as keyof typeof VERIFIED).chars.join(" ")).toBe(seq);
    }
    expect(KOCH_ORDERS.map((o) => o.id)).toEqual(["lcwo", "g4fon", "classic-v1"]);
  });

  it("Classic (v1) is exactly v1's KOCH_SEQUENCE", () => {
    const block = /const KOCH_SEQUENCE = \[([\s\S]*?)\];/.exec(v1Source)?.[1];
    expect(block).toBeDefined();
    const v1 = [...(block ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kochOrder("classic-v1").chars).toEqual(v1);
  });

  it("contains only unique characters that exist in the alphabet", () => {
    for (const order of KOCH_ORDERS) {
      expect(new Set(order.chars).size).toBe(order.chars.length);
      for (const ch of order.chars) expect(lookupSymbol(ch), `${order.id}: ${ch}`).toBeDefined();
    }
  });

  it("level N is the first N+1 characters; level 1 is K and M", () => {
    const lcwo = kochOrder("lcwo");
    expect(kochChars(lcwo, 1)).toEqual(["K", "M"]);
    expect(kochChars(lcwo, 3)).toEqual(["K", "M", "U", "R"]);
    expect(newestKochChar(lcwo, 3)).toBe("R");
    expect(kochChars(lcwo, maxKochLevel(lcwo))).toHaveLength(41);
  });

  it("rejects out-of-range levels", () => {
    const g = kochOrder("g4fon");
    expect(() => kochChars(g, 0)).toThrow(RangeError);
    expect(() => kochChars(g, maxKochLevel(g) + 1)).toThrow(RangeError);
    expect(() => kochChars(g, 1.5)).toThrow(RangeError);
  });
});
