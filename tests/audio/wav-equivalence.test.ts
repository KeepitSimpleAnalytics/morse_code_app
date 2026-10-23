import { describe, expect, it } from "vitest";
import { OfflineAudioContext as NodeOfflineAudioContext } from "node-web-audio-api";
import { renderOffline } from "../../src/audio/offline-render";
import { effectiveRiseMs } from "../../src/core/envelope";
import { buildTimeline } from "../../src/core/timeline";
import { computeTiming } from "../../src/core/timing";
import { tokenize } from "../../src/core/tokenize";
import { synthesize, WAV_SAMPLE_RATE } from "../../src/core/wav";

function rms(samples: Float32Array, startMs: number, endMs: number): number {
  const a = Math.floor((startMs / 1000) * WAV_SAMPLE_RATE);
  const b = Math.floor((endMs / 1000) * WAV_SAMPLE_RATE);
  let sum = 0;
  for (let i = a; i < b; i++) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
}

describe("WAV: OfflineAudioContext and direct synthesis agree (SPEC §5.9)", () => {
  it("matches RMS in every element window", async () => {
    const elements = buildTimeline(
      tokenize("CQ DE W1ABC <AR>").tokens,
      computeTiming({ charWpm: 25, effWpm: 18 }),
    );
    const opts = { frequency: 600, volume: 0.7, riseMs: effectiveRiseMs(5, elements) };
    const direct = synthesize(elements, opts);
    const offline = await renderOffline(elements, opts, NodeOfflineAudioContext);
    expect(offline.length).toBe(direct.length);

    for (const el of elements) {
      const a = rms(direct, el.start, el.start + el.dur);
      const b = rms(offline, el.start, el.start + el.dur);
      if (el.on) {
        expect(Math.abs(a - b) / a, `element at ${el.start} ms`).toBeLessThan(0.01);
      } else {
        // Silence, apart from the boundary sample where an element ends at gain ≈ 0.
        expect(a).toBeLessThan(1e-3);
        expect(b).toBeLessThan(1e-3);
      }
    }
  });
});
