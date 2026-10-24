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

const noop = (): void => undefined;

/** Just enough AudioContext for heardAt() and tick(). */
function stubContext(over: Partial<Record<string, unknown>> = {}) {
  const node = () => ({
    connect(next: unknown) {
      return next;
    },
    disconnect: noop,
  });
  const param = () => ({
    value: 0,
    setValueAtTime: noop,
    setTargetAtTime: noop,
    linearRampToValueAtTime: noop,
    exponentialRampToValueAtTime: noop,
  });
  const started: number[] = [];
  const ctx = {
    state: "running",
    currentTime: 10,
    baseLatency: 0.01,
    outputLatency: 0.03,
    destination: node(),
    createOscillator: () => ({
      ...node(),
      type: "sine",
      frequency: param(),
      start: (t?: number) => started.push(t ?? 0),
      stop: noop,
      onended: null,
    }),
    createGain: () => ({ ...node(), gain: param() }),
    resume: () => Promise.resolve(),
    ...over,
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

describe("AudioEngine timing for ICR (SPEC §7.2)", () => {
  it("maps the audio clock to performance time through getOutputTimestamp", async () => {
    const { ctx } = stubContext({
      getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 5000 }),
    });
    const engine = new AudioEngine(() => ctx);
    await engine.start();
    // 0.6 s after the presented sample → 600 ms after its performance time.
    expect(engine.heardAt(10.5)).toEqual({ ms: 5600, source: "output-timestamp" });
  });

  it("falls back to currentTime plus latency, and says so, before a timestamp is available", async () => {
    const { ctx } = stubContext({
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    });
    const engine = new AudioEngine(() => ctx);
    await engine.start();
    const before = performance.now();
    const heard = engine.heardAt(10.5);
    expect(heard.source).toBe("latency");
    // 0.5 s ahead of currentTime, plus 40 ms of base and output latency.
    expect(heard.ms - before).toBeGreaterThanOrEqual(540 - 1);
    expect(heard.ms - before).toBeLessThan(560);
  });

  it("plays the tick on the shared context, and refuses before audio starts", async () => {
    const { ctx, started } = stubContext();
    const engine = new AudioEngine(() => ctx);
    expect(() => {
      engine.tick();
    }).toThrow(/hasn't started/);
    await engine.start();
    engine.tick();
    expect(engine.contextsCreated).toBe(1);
    expect(started).toHaveLength(2); // the keyed oscillator, then the tick
  });
});
