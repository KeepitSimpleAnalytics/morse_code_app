import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LETTER_SYMBOLS } from "../../src/core/alphabet";
import { PREFIXES, WORD_LISTS, wordList } from "../../src/core/bundled";
import { charsetFromClasses, parseCustomCharset } from "../../src/core/charset";
import { chunkText } from "../../src/core/chunk";
import {
  CALLSIGN_FORMATS,
  eligiblePrefixes,
  generateCallsigns,
  type CallsignFormat,
} from "../../src/core/generators/callsigns";
import { generateWords, wordSymbols, wordsUsing } from "../../src/core/generators/words";
import { KOCH_ORDERS, kochChars, maxKochLevel } from "../../src/core/koch";
import { mulberry32, type Rng } from "../../src/core/rng";
import { tokenize } from "../../src/core/tokenize";

const RUNS = 1000;

function randomFormats(rng: Rng): CallsignFormat[] {
  const out = CALLSIGN_FORMATS.filter(() => rng.next() < 0.5);
  return out.length > 0 ? out : [rng.pick(CALLSIGN_FORMATS)];
}

describe("charsets", () => {
  it("builds a set from character classes", () => {
    const set = charsetFromClasses({ letters: true, digits: true, punct: false, prosigns: true });
    expect(set).toContain("A");
    expect(set).toContain("0");
    expect(set).toContain("<AR>");
    expect(set).not.toContain(".");
    expect(
      charsetFromClasses({ letters: false, digits: false, punct: false, prosigns: false }),
    ).toEqual([]);
  });

  it("parses a custom set: distinct, upper case, prosigns, spaces ignored", () => {
    expect(parseCustomCharset("k m k <ar>?é")).toEqual({
      chars: ["K", "M", "<AR>", "?"],
      unsupported: ["é"],
    });
  });
});

describe("generateWords", () => {
  const list = wordList("cw-abbrev").items;

  it("is deterministic for a seed", () => {
    const a = generateWords({ rng: mulberry32(3), items: list, count: 20 });
    expect(generateWords({ rng: mulberry32(3), items: list, count: 20 })).toEqual(a);
    expect(generateWords({ rng: mulberry32(4), items: list, count: 20 })).not.toEqual(a);
  });

  it("never repeats a word back to back", () => {
    const words = generateWords({ rng: mulberry32(9), items: list, count: 500 });
    words.forEach((w, i) => {
      if (i > 0) expect(w.word).not.toBe(words[i - 1]?.word);
    });
  });

  it(`only uses allowed characters (${RUNS} runs)`, () => {
    const rng = mulberry32(42);
    for (let run = 0; run < RUNS; run++) {
      const order = rng.pick(KOCH_ORDERS);
      const level = rng.intBetween(10, maxKochLevel(order));
      const allowed = kochChars(order, level);
      const l = rng.pick(WORD_LISTS).items;
      if (wordsUsing(l, allowed).length === 0) continue;
      const words = generateWords({ rng, items: l, allowedChars: allowed, count: 5 });
      for (const w of words) {
        for (const s of wordSymbols(w.word)) expect(allowed).toContain(s);
      }
    }
  });

  it("filters to words made of learned characters and refuses an empty pool", () => {
    expect(wordsUsing(list, ["E", "T"])).toEqual([]);
    expect(() =>
      generateWords({ rng: mulberry32(1), items: list, allowedChars: ["E", "T"], count: 1 }),
    ).toThrow(/no words/);
    expect(wordsUsing(list, ["C", "Q", "D", "E"]).map((w) => w.word)).toEqual(["CQ", "DE", "C"]);
  });
});

describe("generateCallsigns", () => {
  const pattern = /^([A-Z0-9]{1,2})(\d)([A-Z]{1,3})$/;

  it("is deterministic for a seed", () => {
    const opts = { prefixes: PREFIXES, formats: CALLSIGN_FORMATS, usOnly: false, count: 20 };
    const a = generateCallsigns({ ...opts, rng: mulberry32(7) });
    expect(generateCallsigns({ ...opts, rng: mulberry32(7) })).toEqual(a);
    expect(generateCallsigns({ ...opts, rng: mulberry32(8) })).not.toEqual(a);
  });

  it(`follows the chosen formats and prefix table (${RUNS} runs)`, () => {
    const rng = mulberry32(11);
    const known = new Set(PREFIXES.map((p) => p.prefix));
    const us = new Set(PREFIXES.filter((p) => p.us).map((p) => p.prefix));
    for (let run = 0; run < RUNS; run++) {
      const formats = randomFormats(rng);
      const usOnly = rng.next() < 0.3;
      const [call] = generateCallsigns({ rng, prefixes: PREFIXES, formats, usOnly, count: 1 });
      const m = pattern.exec(call ?? "");
      expect(m, call).not.toBeNull();
      const [, prefix = "", , suffix = ""] = m ?? [];
      expect(formats).toContain(`${prefix.length}x${suffix.length}`);
      expect(known.has(prefix)).toBe(true);
      if (usOnly) expect(us.has(prefix)).toBe(true);
      expect(tokenize(call ?? "").unsupported).toEqual([]);
    }
  });

  it("weights prefixes", () => {
    const calls = generateCallsigns({
      rng: mulberry32(5),
      prefixes: [
        { prefix: "W", entity: "x", weight: 9 },
        { prefix: "G", entity: "y", weight: 1 },
      ],
      formats: ["1x2"],
      usOnly: false,
      count: 2000,
    });
    const w = calls.filter((c) => c.startsWith("W")).length;
    expect(w / calls.length).toBeGreaterThan(0.85);
    expect(w / calls.length).toBeLessThan(0.95);
  });

  it("uses only a prefix's allowed digits", () => {
    const calls = generateCallsigns({
      rng: mulberry32(2),
      prefixes: [{ prefix: "VR", entity: "Hong Kong", weight: 1, digits: "2" }],
      formats: ["2x2"],
      usOnly: false,
      count: 200,
    });
    for (const c of calls) expect(c).toMatch(/^VR2[A-Z]{2}$/);
    expect(PREFIXES.find((p) => p.prefix === "HB")?.digits).not.toContain("0");
  });

  it("refuses impossible options", () => {
    const rng = mulberry32(1);
    expect(() =>
      generateCallsigns({ rng, prefixes: PREFIXES, formats: [], usOnly: false, count: 1 }),
    ).toThrow();
    expect(
      eligiblePrefixes(PREFIXES, ["1x3"], true)
        .map((p) => p.prefix)
        .sort(),
    ).toEqual(["K", "N", "W"]);
  });
});

describe("chunkText", () => {
  it("splits by line, dropping blank lines and unsupported characters", () => {
    expect(chunkText("cq cq de w1abc\n\n  hello   world \r\nnaïve ☺", { kind: "line" })).toEqual({
      items: ["CQ CQ DE W1ABC", "HELLO WORLD", "NAVE"],
      unsupported: ["ï", "☺"],
    });
  });

  it("splits into N words per item, in order", () => {
    expect(chunkText("one two three\nfour five", { kind: "words", perItem: 2 }).items).toEqual([
      "ONE TWO",
      "THREE FOUR",
      "FIVE",
    ]);
  });

  it("keeps prosigns and rejects a bad word count", () => {
    expect(chunkText("tu <sk>", { kind: "line" }).items).toEqual(["TU <SK>"]);
    expect(() => chunkText("x", { kind: "words", perItem: 0 })).toThrow(RangeError);
  });
});

describe("bundled data (SPEC §7.4, §7.5)", () => {
  it("has the list sizes the SPEC asks for, all playable", () => {
    expect(wordList("v1-common").items).toHaveLength(40);
    expect(wordList("cw-abbrev").items.length).toBeGreaterThanOrEqual(80);
    expect(wordList("qcodes").items.length).toBeGreaterThanOrEqual(40);
    for (const l of WORD_LISTS) {
      const words = l.items.map((w) => w.word);
      expect(new Set(words).size, l.id).toBe(words.length);
      for (const w of words) expect(() => wordSymbols(w)).not.toThrow();
    }
    for (const l of [wordList("cw-abbrev"), wordList("qcodes")]) {
      for (const w of l.items) expect(w.meaning, w.word).toBeTruthy();
    }
  });

  it("matches v1's common words and includes all 18 v1 Q-codes", () => {
    const src = readFileSync("legacy/v1/morse.js", "utf8");
    const listOf = (name: string) =>
      [
        ...(new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src)?.[1] ?? "").matchAll(
          /'([^']+)'/g,
        ),
      ].map((m) => m[1]);
    expect(wordList("v1-common").items.map((w) => w.word)).toEqual(listOf("COMMON_WORDS"));
    const v1Q = listOf("Q_CODES");
    expect(v1Q).toHaveLength(18);
    const q = wordList("qcodes").items.map((w) => w.word);
    for (const code of v1Q) expect(q).toContain(code);
  });

  it("has at least 150 distinct prefixes with positive weights", () => {
    expect(PREFIXES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(PREFIXES.map((p) => p.prefix)).size).toBe(PREFIXES.length);
    for (const p of PREFIXES) {
      expect(p.weight).toBeGreaterThan(0);
      expect(p.prefix).toMatch(/^[A-Z0-9]{1,2}$/);
      expect(LETTER_SYMBOLS.includes(p.prefix[0] ?? "") || /\d/.test(p.prefix[0] ?? "")).toBe(true);
    }
  });
});
