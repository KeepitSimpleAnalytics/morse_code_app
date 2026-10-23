import { describe, expect, it } from "vitest";
import { AudioContext as NodeAudioContext } from "node-web-audio-api";
import { AudioEngine } from "../../src/audio/engine";

describe("AudioEngine", () => {
  it("creates exactly one AudioContext, however many times it starts (SPEC §4 defect 5)", async () => {
    let made = 0;
    const contexts: NodeAudioContext[] = [];
    const engine = new AudioEngine(() => {
      made++;
      // sinkId "none" (newer than TypeScript's DOM types) needs no audio device, as on CI.
      const noDevice = { sinkId: { type: "none" } } as object;
      const ctx = new NodeAudioContext({ latencyHint: "interactive", ...noDevice });
      contexts.push(ctx);
      return ctx;
    });
    expect(engine.started).toBe(false);
    expect(engine.latency()).toBeNull();
    for (let i = 0; i < 100; i++) await engine.start();
    expect(made).toBe(1);
    expect(engine.contextsCreated).toBe(1);
    engine.setFrequency(700);
    engine.setVolume(0.5);
    expect(engine.latency()?.totalMs).toBeGreaterThanOrEqual(0);
    await contexts[0]?.close();
  });

  it("validates frequency and volume", () => {
    const engine = new AudioEngine(() => {
      throw new Error("not started in this test");
    });
    expect(() => {
      engine.setFrequency(0);
    }).toThrow(RangeError);
    expect(() => {
      engine.setVolume(1.5);
    }).toThrow(RangeError);
  });
});
