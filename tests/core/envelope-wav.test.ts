import { describe, expect, it } from "vitest";
import {
  curveValueAt,
  effectiveRiseMs,
  elementGainAt,
  FALL_CURVE,
  RISE_CURVE,
} from "../../src/core/envelope";
import { buildTimeline } from "../../src/core/timeline";
import { computeTiming } from "../../src/core/timing";
import { tokenize } from "../../src/core/tokenize";
import { encodeWav16, synthesize, WAV_SAMPLE_RATE, wavFilename } from "../../src/core/wav";

describe("envelope", () => {
  it("is a 64-point raised cosine from 0 to 1, and the fall mirrors it", () => {
    expect(RISE_CURVE).toHaveLength(64);
    expect(RISE_CURVE[0]).toBe(0);
    expect(RISE_CURVE[63]).toBeCloseTo(1, 7);
    for (let i = 1; i < 64; i++)
      expect(RISE_CURVE[i]).toBeGreaterThanOrEqual(RISE_CURVE[i - 1] ?? 0);
    for (let i = 0; i < 64; i++) expect(FALL_CURVE[i]).toBe(RISE_CURVE[63 - i]);
    expect((RISE_CURVE[31] ?? 0) + (RISE_CURVE[32] ?? 0)).toBeCloseTo(1, 6); // symmetric about the midpoint
  });

  it("clamps rise time to 0.4 × the shortest element so curves never overlap", () => {
    const at = (wpm: number) =>
      buildTimeline(tokenize("EE").tokens, computeTiming({ charWpm: wpm, effWpm: wpm }));
    expect(effectiveRiseMs(5, at(20))).toBe(5); // dot 60 ms
    expect(effectiveRiseMs(10, at(60))).toBeCloseTo(8, 9); // dot 20 ms → max 8 ms
    expect(() => effectiveRiseMs(1, at(20))).toThrow(RangeError);
    expect(() => effectiveRiseMs(11, at(20))).toThrow(RangeError);
  });

  it("interpolates like setValueCurveAtTime and holds the end value", () => {
    expect(curveValueAt(RISE_CURVE, 0, 10, -1)).toBe(0);
    expect(curveValueAt(RISE_CURVE, 0, 10, 10)).toBeCloseTo(1, 7);
    expect(curveValueAt(RISE_CURVE, 0, 10, 5)).toBeCloseTo(0.5, 2);
    const el = { on: true, start: 100, dur: 60, tokenIndex: 0 };
    expect(elementGainAt(el, 5, 99)).toBe(0);
    expect(elementGainAt(el, 5, 130)).toBe(1);
    expect(elementGainAt(el, 5, 160)).toBe(0);
  });
});

describe("WAV", () => {
  const elements = buildTimeline(tokenize("E").tokens, computeTiming({ charWpm: 20, effWpm: 20 }));

  it("writes a valid 16-bit mono PCM header", () => {
    const samples = synthesize(elements, { frequency: 600, volume: 0.5, riseMs: 5 });
    const bytes = encodeWav16(samples);
    const v = new DataView(bytes.buffer);
    const ascii = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(12)).toBe("fmt ");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe("data");
    expect(v.getUint32(40, true)).toBe(samples.length * 2);
    expect(bytes.length).toBe(44 + samples.length * 2);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
  });

  it("covers lead-in, the element and the tail", () => {
    const samples = synthesize(elements, { frequency: 600, volume: 0.5, riseMs: 5, tailMs: 100 });
    // 100 ms lead-in + 60 ms dot + 100 ms tail = 260 ms
    expect(samples.length).toBe(Math.ceil(0.26 * WAV_SAMPLE_RATE));
    const lead = samples.slice(0, Math.floor(0.099 * WAV_SAMPLE_RATE));
    expect(Math.max(...lead.map(Math.abs))).toBe(0);
    const peak = Math.max(...samples.map(Math.abs));
    expect(peak).toBeGreaterThan(0.49);
    expect(peak).toBeLessThanOrEqual(0.5);
  });

  it("clips safely and rejects bad volume", () => {
    const bytes = encodeWav16(new Float32Array([2, -2]));
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(() => synthesize(elements, { frequency: 600, volume: 2, riseMs: 5 })).toThrow(
      RangeError,
    );
  });

  it("suggests morse-<first-words>.wav", () => {
    expect(wavFilename("CQ CQ de W1AW, k")).toBe("morse-cq-cq-de.wav");
    expect(wavFilename("  Hello!  ")).toBe("morse-hello.wav");
    expect(wavFilename("<AR> ...")).toBe("morse-ar.wav");
    expect(wavFilename("??? !!!")).toBe("morse.wav");
  });
});
