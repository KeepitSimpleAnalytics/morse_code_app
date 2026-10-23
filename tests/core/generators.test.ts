import { describe, expect, it } from "vitest";
import {
  DIGIT_SYMBOLS,
  LETTER_SYMBOLS,
  PROSIGN_SYMBOLS,
  PUNCT_SYMBOLS,
} from "../../src/core/alphabet";
import { createPicker } from "../../src/core/generators/adaptive";
import { generateGroups, type GroupLength } from "../../src/core/generators/groups";
import { generateKochGroups } from "../../src/core/generators/koch";
import { KOCH_ORDERS, kochChars, maxKochLevel } from "../../src/core/koch";
import { mulberry32, type Rng } from "../../src/core/rng";
import { tokenize } from "../../src/core/tokenize";

const ALL = [...LETTER_SYMBOLS, ...DIGIT_SYMBOLS, ...PUNCT_SYMBOLS, ...PROSIGN_SYMBOLS];
const RUNS = 1000;

/** Splits a generated item back into symbols ("K<AR>M" → ["K", "<AR>", "M"]). */
function symbolsOf(item: string): string[] {
  const { tokens, unsupported } = tokenize(item);
  expect(unsupported).toEqual([]);
  return tokens.map((t) => (t.type === "char" ? t.symbol.symbol : " "));
}

function randomSubset(rng: Rng, from: readonly string[]): string[] {
  const size = rng.intBetween(2, Math.min(12, from.length));
  const pool = [...from];
  const out: string[] = [];
  while (out.length < size) out.push(pool.splice(rng.int(pool.length), 1)[0] as string);
  return out;
}

function randomLength(rng: Rng): GroupLength {
  if (rng.next() < 0.5) return { kind: "fixed", length: rng.intBetween(1, 10) };
  const min = rng.intBetween(1, 10);
  return { kind: "random", min, max: rng.intBetween(min, 10) };
}

function maxRun(seq: readonly string[]): number {
  let best = 0;
  let run = 0;
  seq.forEach((s, i) => {
    run = i > 0 && seq[i - 1] === s ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

describe("generateGroups", () => {
  it("is deterministic for a seed", () => {
    const opts = {
      allowedChars: ["K", "M", "R", "S"],
      count: 10,
      length: { kind: "fixed", length: 5 },
    } as const;
    expect(generateGroups({ ...opts, rng: mulberry32(5) })).toEqual(
      generateGroups({ ...opts, rng: mulberry32(5) }),
    );
    expect(generateGroups({ ...opts, rng: mulberry32(5) })).not.toEqual(
      generateGroups({ ...opts, rng: mulberry32(6) }),
    );
  });

  it(`property: only allowed characters, right lengths, no runs over 3 (${RUNS} runs)`, () => {
    const meta = mulberry32(2026);
    for (let run = 0; run < RUNS; run++) {
      const allowed = randomSubset(meta, ALL);
      const length = randomLength(meta);
      const count = meta.intBetween(1, 8);
      const items = generateGroups({
        rng: mulberry32(meta.int(2 ** 32)),
        allowedChars: allowed,
        count,
        length,
      });
      expect(items).toHaveLength(count);
      const all: string[] = [];
      for (const item of items) {
        const syms = symbolsOf(item);
        for (const s of syms) expect(allowed).toContain(s);
        if (length.kind === "fixed") expect(syms).toHaveLength(length.length);
        else {
          expect(syms.length).toBeGreaterThanOrEqual(length.min);
          expect(syms.length).toBeLessThanOrEqual(length.max);
        }
        all.push(...syms);
      }
      expect(maxRun(all)).toBeLessThanOrEqual(3);
    }
  });

  it("rejects bad options instead of guessing", () => {
    const rng = mulberry32(1);
    const base = { rng, allowedChars: ["A", "B"], count: 1 };
    expect(() => generateGroups({ ...base, length: { kind: "fixed", length: 0 } })).toThrow(
      RangeError,
    );
    expect(() => generateGroups({ ...base, length: { kind: "fixed", length: 11 } })).toThrow(
      RangeError,
    );
    expect(() => generateGroups({ ...base, length: { kind: "random", min: 5, max: 3 } })).toThrow(
      RangeError,
    );
    expect(() =>
      generateGroups({ ...base, allowedChars: ["A"], length: { kind: "fixed", length: 5 } }),
    ).toThrow(/at least 2/);
  });
});

describe("generateKochGroups", () => {
  it("is deterministic for a seed", () => {
    const order = KOCH_ORDERS[0];
    if (!order) throw new Error("no orders");
    const make = () => generateKochGroups({ rng: mulberry32(11), order, level: 5, count: 6 });
    expect(make()).toEqual(make());
  });

  it(`property: level N never emits characters beyond N (${RUNS} runs)`, () => {
    const meta = mulberry32(77);
    for (let run = 0; run < RUNS; run++) {
      const order = meta.pick(KOCH_ORDERS);
      const level = meta.intBetween(1, maxKochLevel(order));
      const learned = kochChars(order, level);
      const items = generateKochGroups({
        rng: mulberry32(meta.int(2 ** 32)),
        order,
        level,
        count: meta.intBetween(1, 6),
        length: randomLength(meta),
      });
      for (const item of items) for (const s of symbolsOf(item)) expect(learned).toContain(s);
    }
  });

  it("draws the newest character about twice as often by default", () => {
    const order = KOCH_ORDERS[0];
    if (!order) throw new Error("no orders");
    // Level 2 (K M U): weights 1, 1, 2 → U expected at 50%.
    const items = generateKochGroups({ rng: mulberry32(3), order, level: 2, count: 4000 });
    const syms = items.join("");
    const share = [...syms].filter((c) => c === "U").length / syms.length;
    expect(share).toBeGreaterThan(0.47);
    expect(share).toBeLessThan(0.53);
  });

  it("applies adaptive weights on top of the newest-character multiplier", () => {
    const order = KOCH_ORDERS[0];
    if (!order) throw new Error("no orders");
    const weights = new Map([
      ["K", 4],
      ["M", 1],
      ["U", 1],
    ]);
    const items = generateKochGroups({
      rng: mulberry32(4),
      order,
      level: 2,
      count: 4000,
      weights,
      newestWeight: 1,
    });
    const syms = items.join("");
    const share = [...syms].filter((c) => c === "K").length / syms.length;
    // Uncapped, K would be 4/6. The no-more-than-3-in-a-row rule makes this a Markov
    // chain over K run lengths with stationary K share (1 + p + p²)·p / (1 + (1 + p + p²)·p)
    // for p = 2/3, which is 38/65 ≈ 0.585.
    expect(share).toBeCloseTo(38 / 65, 1);
    expect(Math.abs(share - 38 / 65)).toBeLessThan(0.015);
  });
});

describe("createPicker", () => {
  it("never repeats a character more than 3 times, even when heavily weighted", () => {
    const picker = createPicker(
      ["A", "B"],
      mulberry32(8),
      new Map([
        ["A", 1000],
        ["B", 1],
      ]),
    );
    const seq = Array.from({ length: 5000 }, () => picker.next());
    expect(maxRun(seq)).toBe(3);
  });

  it("rejects missing, zero or negative weights", () => {
    const rng = mulberry32(1);
    expect(() => createPicker(["A", "B"], rng, new Map([["A", 1]]))).toThrow(/no weight/);
    expect(() =>
      createPicker(
        ["A", "B"],
        rng,
        new Map([
          ["A", 1],
          ["B", 0],
        ]),
      ),
    ).toThrow(RangeError);
  });
});
