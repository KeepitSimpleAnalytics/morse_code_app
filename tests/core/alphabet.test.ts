import { describe, expect, it } from "vitest";
import {
  ALPHABET,
  decodePattern,
  lookupSymbol,
  phoneticOf,
  symbolsForPattern,
} from "../../src/core/alphabet";

describe("alphabet", () => {
  it("has A–Z, 0–9, 16 punctuation marks and 9 prosigns", () => {
    const count = (kind: string) => ALPHABET.filter((s) => s.kind === kind).length;
    expect(count("letter")).toBe(26);
    expect(count("digit")).toBe(10);
    expect(count("punct")).toBe(16);
    expect(count("prosign")).toBe(9);
  });

  it("has unique symbols and well-formed patterns", () => {
    expect(new Set(ALPHABET.map((s) => s.symbol)).size).toBe(ALPHABET.length);
    for (const s of ALPHABET) expect(s.pattern).toMatch(/^[.-]+$/);
  });

  it("gives every character in the same class a distinct pattern", () => {
    const nonProsign = ALPHABET.filter((s) => s.kind !== "prosign");
    expect(new Set(nonProsign.map((s) => s.pattern)).size).toBe(nonProsign.length);
  });

  it("knows the reference patterns", () => {
    expect(lookupSymbol("K")?.pattern).toBe("-.-");
    expect(lookupSymbol("0")?.pattern).toBe("-----");
    expect(lookupSymbol("?")?.pattern).toBe("..--..");
    expect(lookupSymbol("<SOS>")?.pattern).toBe("...---...");
    expect(lookupSymbol("<HH>")?.pattern).toBe("........");
  });

  it("flags ! and & as non-standard and nothing else", () => {
    expect(ALPHABET.filter((s) => s.nonStandard).map((s) => s.symbol)).toEqual(["!", "&"]);
  });

  it("renders phonetics with a final 'dit'", () => {
    expect(phoneticOf("-.-")).toBe("dah-di-dah");
    expect(phoneticOf(".-.")).toBe("di-dah-dit");
    expect(phoneticOf(".")).toBe("dit");
    expect(phoneticOf("--")).toBe("dah-dah");
    expect(lookupSymbol("S")?.phonetic).toBe("di-di-dit");
  });

  it("lists exactly the character/prosign pattern collisions", () => {
    const shared: Record<string, string[]> = {};
    for (const p of ALPHABET.filter((s) => s.kind === "prosign")) {
      const others = symbolsForPattern(p.pattern)
        .filter((s) => s !== p)
        .map((s) => s.symbol);
      if (others.length > 0) shared[p.symbol] = others;
    }
    // SPEC §5.1 lists the first three; "(" / <KN> share -.--. as well.
    expect(shared).toEqual({
      "<AR>": ["+"],
      "<BT>": ["="],
      "<KN>": ["("],
      "<AS>": ["&"],
    });
  });

  it("decodes shared patterns as prosigns by default, characters when asked", () => {
    expect(decodePattern("-...-")?.symbol).toBe("<BT>");
    expect(decodePattern("-...-", { preferProsigns: false })?.symbol).toBe("=");
    expect(decodePattern(".-.-.")?.symbol).toBe("<AR>");
    expect(decodePattern("-.-")?.symbol).toBe("K");
    expect(decodePattern("......-")).toBeUndefined();
  });
});
