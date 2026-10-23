import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../../src/core/timeline";

interface PlayCall {
  elements: readonly TimelineElement[];
  listener: { onToken?: (i: number) => void; onDone?: () => void };
}

const plays: PlayCall[] = [];
const stops = vi.fn(() => 0);

vi.mock("../../../src/audio/engine", () => ({
  audioEngine: {
    start: () => Promise.resolve({ ctx: { currentTime: 0 }, keyGain: {} }),
    setFrequency: () => undefined,
    setVolume: () => undefined,
    outputLatencySec: () => 0,
  },
}));

vi.mock("../../../src/audio/scheduler", () => ({
  browserTimers: {},
  KeyingScheduler: class {
    play(elements: readonly TimelineElement[], _rise: number, listener: PlayCall["listener"]) {
      plays.push({ elements, listener });
    }
    stop = stops;
    pendingTokens = () => 0;
  },
}));

const { usePlayerStore } = await import("../../../src/features/player/store");
const player = await import("../../../src/features/player/controller");

const firstToken = (call: PlayCall | undefined) => call?.elements[0]?.tokenIndex;
const lastPlay = () => plays[plays.length - 1];
const setSpeed = (charWpm: number) => {
  usePlayerStore.getState().set({ speeds: { charWpm, effWpm: charWpm } });
};

beforeEach(() => {
  vi.useFakeTimers();
  plays.length = 0;
  usePlayerStore.setState({
    text: "AB CD",
    speeds: { charWpm: 20, effWpm: 20 },
    loop: false,
    startOffset: null,
    status: "idle",
    liveMode: false,
  });
});

afterEach(() => {
  player.stop();
  vi.useRealTimers();
});

describe("live speed change", () => {
  it("restarts from the sounding character at the new speed once the slider settles", async () => {
    await player.play();
    expect(plays).toHaveLength(1);
    lastPlay()?.listener.onToken?.(3); // "C" is sounding

    setSpeed(25);
    setSpeed(30);
    setSpeed(35);
    await vi.advanceTimersByTimeAsync(player.SPEED_RESTART_DEBOUNCE_MS - 1);
    expect(plays).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(plays).toHaveLength(2);
    expect(firstToken(lastPlay())).toBe(3);
    // 35 WPM: dot = 1200 / 35 ms.
    const dah = lastPlay()?.elements.find((e) => e.on);
    expect(dah?.dur).toBeCloseTo((3 * 1200) / 35);
    expect(usePlayerStore.getState().status).toBe("playing");
  });

  it("doesn't restart when paused or stopped before the slider settles", async () => {
    await player.play();
    setSpeed(30);
    player.pause();
    await vi.advanceTimersByTimeAsync(player.SPEED_RESTART_DEBOUNCE_MS * 2);
    expect(plays).toHaveLength(1);

    setSpeed(25); // paused: the new speed applies on resume
    await vi.advanceTimersByTimeAsync(player.SPEED_RESTART_DEBOUNCE_MS * 2);
    expect(plays).toHaveLength(1);
  });

  it("keeps looping from the original start after a speed restart", async () => {
    usePlayerStore.setState({ loop: true });
    await player.play();
    lastPlay()?.listener.onToken?.(3);
    setSpeed(30);
    await vi.advanceTimersByTimeAsync(player.SPEED_RESTART_DEBOUNCE_MS);
    expect(firstToken(lastPlay())).toBe(3);

    lastPlay()?.listener.onDone?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(plays).toHaveLength(3);
    expect(firstToken(lastPlay())).toBe(0);
  });
});
