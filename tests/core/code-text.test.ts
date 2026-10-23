import { describe, expect, it } from "vitest";
import { codeText, decodeMorseText, INVALID_MARK } from "../../src/core/code-text";
import { tokenize } from "../../src/core/tokenize";

const tok = (s: string) => tokenize(s).tokens;

describe("codeText", () => {
  it("renders ASCII with spaces between letters and / between words", () => {
    expect(codeText(tok("HI MOM"), "ascii", "slash")).toBe(".... .. / -- --- --");
    expect(codeText(tok("HI MOM"), "ascii", "space")).toBe(".... ..   -- --- --");
  });

  it("renders dots and dashes as · and –", () => {
    expect(codeText(tok("K"), "dots", "slash")).toBe("–·–");
  });

  it("renders phonetics", () => {
    expect(codeText(tok("KR"), "phonetic", "slash")).toBe("dah-di-dah di-dah-dit");
  });
});

describe("decodeMorseText", () => {
  it("decodes the spec example", () => {
    expect(decodeMorseText(".... . .-.. .-.. --- / .-- --- .-. .-.. -..")).toEqual({
      text: "HELLO WORLD",
      errors: [],
    });
  });

  it("accepts every element character and word separator in SPEC §7.8", () => {
    expect(decodeMorseText("···· ·–   –·–").text).toBe("HA K");
    expect(decodeMorseText("._ | _._").text).toBe("A K");
    expect(decodeMorseText(".-\n-.-").text).toBe("A K");
  });

  it("prefers prosigns for shared patterns", () => {
    expect(decodeMorseText(".-.-.").text).toBe("<AR>");
    expect(decodeMorseText(".-.-.", { preferProsigns: false }).text).toBe("+");
  });

  it("marks invalid sequences with � and lists them", () => {
    const r = decodeMorseText("... ......- x-. ...");
    expect(r.text).toBe(`S${INVALID_MARK}${INVALID_MARK}S`);
    expect(r.errors).toEqual([
      { sequence: "......-", index: 4, reason: "unknown-pattern" },
      { sequence: "x-.", index: 12, reason: "invalid-character" },
    ]);
  });

  it("round-trips text through codeText", () => {
    const text = "CQ CQ DE W1ABC <AR>";
    expect(decodeMorseText(codeText(tok(text), "ascii", "slash")).text).toBe(text);
    expect(decodeMorseText(codeText(tok(text), "dots", "space")).text).toBe(text);
  });

  it("returns nothing for empty input", () => {
    expect(decodeMorseText("   ")).toEqual({ text: "", errors: [] });
  });
});
