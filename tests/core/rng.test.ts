import { describe, expect, it } from "vitest";
import { mulberry32, seedFromString } from "../../src/core/rng";

describe("mulberry32", () => {
  it("is deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
  });

  it("matches the canonical mulberry32 implementation", () => {
    // bryc/code jshash/PRNGs.md (fetched 2026-10-23), verbatim apart from types.
    /* eslint-disable */
    // prettier-ignore
    function canonical(a: number) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    /* eslint-enable */
    for (const seed of [0, 1, 42, 0xdeadbeef]) {
      const ours = mulberry32(seed);
      const ref = canonical(seed);
      for (let i = 0; i < 1000; i++) expect(ours.next()).toBe(ref());
    }
  });

  it("differs between seeds", () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it("stays in range and is roughly uniform", () => {
    const r = mulberry32(123);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const b = Math.floor(x * 10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    for (const b of buckets) expect(Math.abs(b - 10000)).toBeLessThan(500);
  });

  it("int, intBetween and pick respect their bounds", () => {
    const r = mulberry32(9);
    for (let i = 0; i < 1000; i++) {
      expect(r.int(3)).toBeLessThan(3);
      const v = r.intBetween(2, 7);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(7);
      expect(["a", "b"]).toContain(r.pick(["a", "b"]));
    }
    expect(() => r.pick([])).toThrow(RangeError);
    expect(() => r.int(0)).toThrow(RangeError);
    expect(() => mulberry32(1.5)).toThrow(RangeError);
  });

  it("derives stable 32-bit seeds from strings", () => {
    expect(seedFromString("session-abc")).toBe(seedFromString("session-abc"));
    expect(seedFromString("session-abc")).not.toBe(seedFromString("session-abd"));
    expect(seedFromString("")).toBe(0x811c9dc5);
    expect(Number.isInteger(seedFromString("x"))).toBe(true);
  });
});
