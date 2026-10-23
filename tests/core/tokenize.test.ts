import { describe, expect, it } from "vitest";
import { tokenize, type Token } from "../../src/core/tokenize";

const show = (tokens: Token[]) =>
  tokens.map((t) => (t.type === "gap" ? "_" : t.symbol.symbol)).join(" ");

describe("tokenize", () => {
  it("upper-cases and tokenizes characters", () => {
    expect(show(tokenize("cq de").tokens)).toBe("C Q _ D E");
  });

  it("collapses any whitespace run to one gap and trims the ends", () => {
    const { tokens } = tokenize("  A \t\n  B\r\n\nC   ");
    expect(show(tokens)).toBe("A _ B _ C");
  });

  it("parses known prosigns case-insensitively", () => {
    expect(show(tokenize("<AR> <sk>").tokens)).toBe("<AR> _ <SK>");
    expect(show(tokenize("K<BT>M").tokens)).toBe("K <BT> M");
  });

  it("tokenizes unknown prosigns character by character and reports the brackets", () => {
    const { tokens, unsupported } = tokenize("<ZZ>");
    expect(show(tokens)).toBe("Z Z");
    expect(unsupported).toEqual([
      { char: "<", index: 0 },
      { char: ">", index: 3 },
    ]);
  });

  it("reports unsupported characters and excludes them (SPEC §4 defect 7)", () => {
    const { tokens, unsupported } = tokenize("A#B é");
    expect(show(tokens)).toBe("A B");
    expect(unsupported).toEqual([
      { char: "#", index: 1 },
      { char: "é", index: 4 },
    ]);
  });

  it("does not leave double gaps around unsupported characters", () => {
    expect(show(tokenize("A # B").tokens)).toBe("A _ B");
    expect(show(tokenize("# A").tokens)).toBe("A");
  });

  it("maps curly quotes to straight quotes", () => {
    expect(show(tokenize("‘x’ “y”").tokens)).toBe(`' X ' _ " Y "`);
  });

  it("applies NFKC (full-width forms, ligatures)", () => {
    expect(show(tokenize("ＡＢ").tokens)).toBe("A B"); // full-width "ＡＢ"
    expect(show(tokenize("ﬁ").tokens)).toBe("F I"); // "ﬁ" ligature
  });

  it("keeps source offsets into the original text", () => {
    const text = "hi <AR>\n\nok";
    const { tokens } = tokenize(text);
    const spans = tokens.map((t) => text.slice(t.sourceStart, t.sourceEnd));
    expect(spans).toEqual(["h", "i", " ", "<AR>", "\n\n", "o", "k"]);
  });

  it("keeps offsets correct after astral characters", () => {
    const text = "\u{1F600}A";
    const { tokens, unsupported } = tokenize(text);
    expect(unsupported).toEqual([{ char: "\u{1F600}", index: 0 }]);
    expect(tokens[0]?.sourceStart).toBe(2);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(tokenize("").tokens).toEqual([]);
    expect(tokenize(" \n\t ").tokens).toEqual([]);
  });
});
