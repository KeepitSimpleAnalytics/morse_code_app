import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../../src/core/timeline";

interface PlayCall {
  elements: readonly TimelineElement[];
  listener: { onToken?: (i: number) => void; onDone?: () => void };
}

const plays: PlayCall[] = [];
const stops = vi.fn(() => 0);
const ticks = vi.fn();
/** The sound of each character ends this long after it is played, as heard. */
const SOUND_MS = 200;

vi.mock("../../../src/audio/engine", () => ({
  audioEngine: {
    start: () => Promise.resolve({ ctx: { currentTime: 0 }, keyGain: {} }),
    setFrequency: () => undefined,
    setVolume: () => undefined,
    outputLatencySec: () => 0,
    heardAt: () => ({ ms: performance.now() + SOUND_MS, source: "output-timestamp" }),
    tick: () => {
      ticks();
    },
  },
}));

vi.mock("../../../src/audio/scheduler", () => ({
  browserTimers: {},
  KeyingScheduler: class {
    last: readonly TimelineElement[] = [];
    play(elements: readonly TimelineElement[], _rise: number, listener: PlayCall["listener"]) {
      this.last = elements;
      plays.push({ elements, listener });
    }
    endTime() {
      const e = this.last[this.last.length - 1];
      return e ? (e.start + e.dur) / 1000 : null;
    }
    stop = stops;
    pendingTokens = () => 0;
  },
}));

const { openTestProfile } = await import("../../app/harness");
const { useSettings } = await import("../../../src/state/settings");
const { requireProfile } = await import("../../../src/state/app");
const { useIcrStore } = await import("../../../src/features/icr/store");
const icr = await import("../../../src/features/icr/controller");
const { ICR_NEXT_DELAY_MS } = await import("../../../src/core/icr");
const { loadWeights } = await import("../../../src/features/copy/weights");

type Store = Awaited<ReturnType<typeof openTestProfile>>;
let store: Store;
const s = () => useIcrStore.getState();
const lastPlay = () => plays[plays.length - 1] as PlayCall;
const now = () => performance.now();

/** Presses the right key `delay` ms after the sound ends, and waits for the next character. */
async function answerRight(delay = 400): Promise<void> {
  const ch = icr.currentChar() ?? "";
  expect(icr.onKey(ch.toLowerCase(), now() + SOUND_MS + delay)).toBe(true);
  await vi.advanceTimersByTimeAsync(ICR_NEXT_DELAY_MS);
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  plays.length = 0;
  ticks.mockClear();
  store = await openTestProfile();
  icr.resetIcr();
  useSettings.getState().set("icr.count", 10);
  useSettings.getState().set("learning.adaptive", false);
});

afterEach(() => {
  icr.resetIcr();
  vi.useRealTimers();
});

describe("ICR round", () => {
  it("times each answer from the end of the sound and writes one trial per character", async () => {
    await icr.start();
    expect(s().phase).toBe("listening");
    expect(["K", "M"]).toContain(icr.currentChar()); // level 1: K and M
    for (let i = 0; i < 10; i++) await answerRight(300 + i * 10);

    expect(s().phase).toBe("results");
    const summary = s().result?.summary;
    expect(summary).toMatchObject({ attempts: 10, correct: 10, accuracy: 1 });
    expect(summary?.medianMs).toBe(345);
    expect(ticks).toHaveBeenCalledTimes(10);

    const [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ mode: "icr", completed: true, sentChars: 10 });
    expect(session?.settingsSnapshot).toMatchObject({
      effectiveTimeoutMs: 1500,
      chars: ["K", "M"],
    });
    const trials = await store.listTrials(session?.id ?? "");
    expect(trials.map((t) => t.responseMs)).toEqual([
      300, 310, 320, 330, 340, 350, 360, 370, 380, 390,
    ]);
    const stats = await store.getCharStats(requireProfile().id);
    expect(stats.every((x) => x.ewmaRt !== null)).toBe(true);
  });

  it("a key pressed while the character still sounds counts as 0 ms and silences it", async () => {
    await icr.start();
    stops.mockClear();
    const ch = icr.currentChar() ?? "";
    icr.onKey(ch, now() + 50);
    expect(stops).toHaveBeenCalled();
    expect(s().answer).toMatchObject({ correct: true, responseMs: 0 });
  });

  it("a timeout counts as the timeout, shows the character and replays it once", async () => {
    useSettings.getState().set("icr.timeoutMs", 1000);
    await icr.start();
    const ch = icr.currentChar();
    const before = plays.length;
    await vi.advanceTimersByTimeAsync(SOUND_MS + 1000);
    expect(s().phase).toBe("feedback");
    expect(s().answer).toMatchObject({ ch, typed: null, correct: false, responseMs: 1000 });
    expect(plays.length).toBe(before + 1); // the replay
    lastPlay().listener.onDone?.();
    await vi.advanceTimersByTimeAsync(ICR_NEXT_DELAY_MS);
    expect(s().phase).toBe("listening");
    expect(s().answered).toBe(1);
  });

  it("a wrong key is recorded with what was pressed; other keys are ignored", async () => {
    await icr.start();
    const ch = icr.currentChar();
    expect(icr.onKey("Shift", now() + 500)).toBe(false);
    expect(icr.onKey("Enter", now() + 500)).toBe(false);
    const wrong = ch === "K" ? "M" : "K";
    expect(icr.onKey(wrong, now() + SOUND_MS + 600)).toBe(true);
    expect(s().answer).toMatchObject({ ch, typed: wrong, correct: false, responseMs: 600 });
    expect(icr.onKey(ch ?? "", now() + 900)).toBe(false); // not listening any more
  });

  it("Target tightens the timeout to the recent median minus 10%", async () => {
    useSettings.getState().set("icr.count", 10);
    await icr.start();
    for (let i = 0; i < 10; i++) await answerRight(800);
    await icr.loadStats();
    expect(s().medianMs).toBe(800);
    icr.dismissResults();
    useSettings.getState().set("icr.target", true);
    await icr.start();
    expect(s().timeoutMs).toBe(720);
  });

  it("pausing asks the unanswered character again and doesn't count hidden time", async () => {
    await icr.start();
    const ch = icr.currentChar();
    vi.advanceTimersByTime(100);
    icr.pause("hidden");
    expect(s().phase).toBe("paused");
    await vi.advanceTimersByTimeAsync(60_000); // no timeout fires while paused
    expect(s().answered).toBe(0);
    await icr.resume();
    expect(s().phase).toBe("listening");
    expect(icr.currentChar()).toBe(ch);
    await answerRight();
    await icr.stop();
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.activeMs).toBeLessThan(2000);
  });

  it("stop with no answers scores nothing; with answers it shows the results", async () => {
    await icr.start();
    await icr.stop();
    expect(s().phase).toBe("idle");
    expect(s().notice).toMatch(/nothing was scored/);

    vi.advanceTimersByTime(1000);
    await icr.start();
    await answerRight();
    await icr.stop();
    expect(s().phase).toBe("results");
    expect(s().result).toMatchObject({ completed: false });
    expect(s().result?.summary.attempts).toBe(1);
  });

  it("a failed save stops the round until it is retried", async () => {
    await icr.start();
    vi.spyOn(store, "recordTrial").mockRejectedValueOnce(new Error("disk full"));
    const ch = icr.currentChar() ?? "";
    icr.onKey(ch, now() + SOUND_MS + 300);
    await vi.advanceTimersByTimeAsync(ICR_NEXT_DELAY_MS);
    expect(s().phase).toBe("unsaved");
    expect(s().error).toMatch(/disk full/);
    await icr.retrySave();
    expect(s().phase).toBe("listening");
    expect(s().answered).toBe(1);
  });

  it("a timed round ends once its active time is up", async () => {
    useSettings.getState().set("icr.roundKind", "minutes");
    useSettings.getState().set("icr.minutes", 1);
    await icr.start();
    expect(s().total).toBeNull();
    await answerRight();
    // Active time comes from Date; move it on without firing the character timeout.
    vi.setSystemTime(Date.now() + 60_000);
    await answerRight();
    expect(s().phase).toBe("results");
    expect(s().result?.completed).toBe(true);
  });

  it("leaves prosigns out of a custom set and refuses fewer than two characters", async () => {
    useSettings.getState().set("icr.charset", "custom");
    useSettings.getState().set("icr.custom", "K<AR>");
    await icr.start();
    expect(s().phase).toBe("idle");
    expect(s().notice).toMatch(/at least two/);
    expect(s().notice).toMatch(/<AR>/);
    useSettings.getState().set("icr.custom", "KM<AR>");
    await icr.start();
    expect(s().phase).toBe("listening");
    expect(s().notice).toMatch(/left out: <AR>/);
  });

  it("adaptive selection uses ICR weights: slow characters weigh more", async () => {
    useSettings.getState().set("learning.adaptive", true);
    useSettings.getState().set("icr.count", 200);
    await icr.start();
    // Answer K slowly and M quickly for a while.
    for (let i = 0; i < 60; i++) {
      const ch = icr.currentChar();
      await answerRight(ch === "K" ? 1400 : 200);
    }
    await icr.stop();
    const profileId = requireProfile().id;
    const icrW = await loadWeights(store, profileId, ["K", "M"], "icr");
    const copyW = await loadWeights(store, profileId, ["K", "M"], "copy");
    // Both always right, so only ICR's response-time factor separates them.
    expect(icrW.get("K") ?? 0).toBeGreaterThan((icrW.get("M") ?? 0) + 1);
    expect(Math.abs((copyW.get("K") ?? 0) - (copyW.get("M") ?? 0))).toBeLessThan(0.2);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.settingsSnapshot).toMatchObject({ adaptive: true });
  });
});

describe("races and recovery (code review, phase 6)", () => {
  it("a reset while closing doesn't mark a finished round incomplete", async () => {
    await icr.start();
    for (let i = 0; i < 9; i++) await answerRight();
    // Hold the close open, so the reset lands while the round is closing.
    const real = store.endSession.bind(store);
    let release = (): void => undefined;
    vi.spyOn(store, "endSession").mockImplementationOnce(async (id, end) => {
      await new Promise<void>((r) => {
        release = r;
      });
      await real(id, end);
    });
    await answerRight();
    expect(s().phase).toBe("closing");
    icr.resetIcr();
    release();
    await vi.advanceTimersByTimeAsync(10);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.completed).toBe(true);
  });

  it("a retry after a save that committed but reported failure counts as saved", async () => {
    await icr.start();
    const real = store.recordTrial.bind(store);
    vi.spyOn(store, "recordTrial").mockImplementationOnce(async (rec) => {
      await real(rec);
      throw new Error("lost reply");
    });
    await answerRight();
    expect(s().phase).toBe("listening");
    expect(s().answered).toBe(1);
  });

  it("a double retry saves once; stop waits for a retry in flight", async () => {
    await icr.start();
    const spy = vi.spyOn(store, "recordTrial").mockRejectedValueOnce(new Error("disk full"));
    await answerRight();
    expect(s().phase).toBe("unsaved");
    const first = icr.retrySave();
    const second = icr.retrySave();
    expect(s().phase).toBe("resuming");
    const stopping = icr.stop();
    await Promise.all([first, second, stopping]);
    expect(spy).toHaveBeenCalledTimes(2); // the failure, then one retry
    expect(s().phase).toBe("results");
    expect(s().result?.summary.attempts).toBe(1);
  });

  it("a pause while resuming takes effect, so nothing plays or times out", async () => {
    await icr.start();
    icr.pause("hidden");
    const before = plays.length;
    const resuming = icr.resume();
    expect(s().phase).toBe("resuming");
    icr.pause("left");
    await resuming;
    expect(s().phase).toBe("paused");
    expect(plays.length).toBe(before);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s().answered).toBe(0);
  });

  it("a key after the deadline is a timeout; one before the sound starts is ignored", async () => {
    await icr.start();
    const ch = icr.currentChar() ?? "";
    expect(icr.onKey(ch, now() - 1000)).toBe(true); // before the sound: ignored
    expect(s().phase).toBe("listening");
    icr.onKey(ch, now() + SOUND_MS + 1600); // timeout is 1500
    expect(s().answer).toMatchObject({ typed: null, correct: false, responseMs: 1500 });
  });

  it("a start that fails after the session opened closes it", async () => {
    const { audioEngine } = await import("../../../src/audio/engine");
    vi.spyOn(audioEngine, "heardAt").mockImplementationOnce(() => {
      throw new Error("no clock");
    });
    await icr.start();
    expect(s().phase).toBe("idle");
    expect(s().error).toMatch(/no clock/);
    await vi.advanceTimersByTimeAsync(10);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.endedAt).not.toBeNull();
    expect(session?.completed).toBe(false);
  });

  it("closing failure: retry, or show the results anyway", async () => {
    await icr.start();
    await answerRight();
    const spy = vi.spyOn(store, "endSession").mockRejectedValueOnce(new Error("locked"));
    await icr.stop();
    expect(s().phase).toBe("unclosed");
    spy.mockRejectedValueOnce(new Error("locked again"));
    await icr.retryFinish();
    expect(s().phase).toBe("unclosed");
    icr.resultsWithoutClosing();
    expect(s().phase).toBe("results");
    expect(s().notice).toMatch(/marked incomplete/);
  });
});
