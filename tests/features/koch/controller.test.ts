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

const { openTestProfile } = await import("../../app/harness");
const { useSettings } = await import("../../../src/state/settings");
const { requireProfile } = await import("../../../src/state/app");
const { useKochStore } = await import("../../../src/features/koch/store");
const koch = await import("../../../src/features/koch/controller");
const player = await import("../../../src/features/player/controller");
const { usePlayerStore } = await import("../../../src/features/player/store");

type Store = Awaited<ReturnType<typeof openTestProfile>>;
let store: Store;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastPlay = () => plays[plays.length - 1] as PlayCall;
const s = () => useKochStore.getState();

/** Heard every token of the last play, then it ended. */
function playToEnd(): void {
  const call = lastPlay();
  for (const e of call.elements) if (e.on) call.listener.onToken?.(e.tokenIndex);
  call.listener.onDone?.();
}

async function startAndPlayLesson(): Promise<string> {
  await koch.startLesson();
  if (s().phase === "intro") await koch.beginLesson();
  expect(s().phase).toBe("playing");
  const sent = koch.currentPromptTokens();
  const text = sent.map((t) => (t.type === "char" ? t.symbol.symbol : " ")).join("");
  playToEnd();
  expect(s().phase).toBe("finishing");
  return text;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  plays.length = 0;
  store = await openTestProfile();
  koch.resetKoch();
  // 1-minute lessons at 20 WPM: long enough to count towards passing.
  useSettings.getState().set("koch.minutes", 1);
  await koch.loadLevel();
});

afterEach(() => {
  koch.resetKoch();
  vi.useRealTimers();
});

describe("Koch lesson flow", () => {
  it("starts at level 1 with K and M", () => {
    expect(s().phase).toBe("idle");
    expect(s().info).toMatchObject({ level: 1, chars: ["K", "M"], lessons: 0, bestAccuracy: null });
  });

  it("introduces K and M before the first lesson, then not again", async () => {
    await koch.startLesson();
    expect(s().phase).toBe("intro");
    expect(s().intro?.chars).toEqual(["K", "M"]);
    expect(lastPlay().elements.filter((e) => e.on)).toHaveLength(9); // K K K = 3 × 3 elements
    lastPlay().listener.onDone?.();
    await flush();
    expect(s().intro?.index).toBe(1); // M plays next
    koch.closeIntro();
    expect(useSettings.getState().values["koch.introSeen"]).toEqual({ lcwo: 1 });
    await koch.startLesson();
    expect(s().phase).toBe("playing");
  });

  it("scores a full lesson, writes it as one trial and passes at 100%", async () => {
    const text = await startAndPlayLesson();
    s().set({ typed: text });
    await koch.finishLesson();

    expect(s().phase).toBe("results");
    const r = s().result;
    expect(r?.score.accuracy).toBe(1);
    expect(r?.outcome).toEqual({ passed: true, notCounted: null, nextChar: "U" });
    expect(r?.decision).toBeNull(); // advancement defaults to "ask first"

    const [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ mode: "koch", completed: true, accuracy: 1 });
    expect(session?.settingsSnapshot).toMatchObject({ kochOrder: "lcwo", kochLevel: 1 });
    expect(session?.activeMs).toBeGreaterThanOrEqual(0);
    const trials = await store.listTrials(session?.id ?? "");
    expect(trials).toHaveLength(1);
    expect(trials[0]?.prompt).toBe(text);
    const stats = await store.getCharStats(requireProfile().id);
    expect(stats.map((x) => x.ch).sort()).toEqual(["K", "M"]);
    expect(s().info?.lessons).toBe(1);
  });

  it("Advance moves up a level and records why", async () => {
    s().set({ typed: await startAndPlayLesson() });
    await koch.finishLesson();
    await koch.advance();
    expect(s().result?.decision).toBe("advanced");
    expect(s().info?.level).toBe(2);
    const history = await store.getKochHistory(requireProfile().id);
    expect(history.map((h) => [h.level, h.reason])).toEqual([[2, "passed"]]);
    // The next lesson introduces U.
    await koch.startLesson();
    expect(s().phase).toBe("intro");
    expect(s().intro?.chars).toEqual(["U"]);
  });

  it("auto advancement moves up without asking", async () => {
    useSettings.getState().set("learning.advancement", "auto");
    s().set({ typed: await startAndPlayLesson() });
    await koch.finishLesson();
    expect(s().result).toMatchObject({ decision: "advanced", autoAdvanced: true });
    expect(s().info?.level).toBe(2);
  });

  it("a failed lesson stays at the level", async () => {
    await startAndPlayLesson();
    s().set({ typed: "K" });
    await koch.finishLesson();
    expect(s().result?.outcome.passed).toBe(false);
    expect(s().result?.suggestStepBack).toBe(false);
    expect(s().info?.level).toBe(1);
  });

  it("stopping early scores only what was sent and can't pass", async () => {
    await koch.startLesson();
    await koch.beginLesson();
    const call = lastPlay();
    // Hear the first group (tokens 0–4) and the start of the second.
    for (const i of [0, 1, 2, 3, 4, 6]) call.listener.onToken?.(i);
    const sent = koch.currentPromptTokens();
    const firstTwo = sent
      .slice(0, 11)
      .map((t) => (t.type === "char" ? t.symbol.symbol : " "))
      .join("");
    s().set({ typed: firstTwo });
    await koch.stopLesson();

    expect(s().phase).toBe("results");
    expect(s().result).toMatchObject({ completed: false, prompt: firstTwo });
    expect(s().result?.score.accuracy).toBe(1);
    expect(s().result?.outcome).toMatchObject({ passed: false, notCounted: "stopped" });
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.completed).toBe(false);
  });

  it("stopping before anything is heard scores nothing", async () => {
    await koch.startLesson();
    await koch.beginLesson();
    await koch.stopLesson();
    expect(s().phase).toBe("idle");
    expect(s().notice).toMatch(/nothing was scored/);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ completed: false });
    expect(await store.listTrials(session?.id ?? "")).toEqual([]);
  });

  it("pausing excludes the paused time and resumes at the interrupted group", async () => {
    await koch.startLesson();
    await koch.beginLesson();
    const call = lastPlay();
    vi.advanceTimersByTime(3000);
    for (const i of [0, 1, 2, 3, 4, 6, 7]) call.listener.onToken?.(i);
    koch.pauseLesson("hidden");
    expect(s()).toMatchObject({ phase: "paused", pausedBy: "hidden" });
    vi.advanceTimersByTime(60_000); // hidden for a minute
    await koch.resumeLesson();
    expect(s().phase).toBe("playing");
    // The second group (starting at token 6) is played again from its start.
    expect(lastPlay().elements[0]?.tokenIndex).toBe(6);
    vi.advanceTimersByTime(2000);
    playToEnd();
    s().set({ typed: "" });
    await koch.finishLesson();
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.activeMs).toBe(5000);
  });

  it("suggests stepping back after three weak lessons, and only when asked does it", async () => {
    await store.setKochLevel(requireProfile().id, "lcwo", 3, "manual", 1);
    useSettings.getState().set("koch.introSeen", { lcwo: 3 });
    await koch.loadLevel();
    for (let i = 0; i < 3; i++) {
      await startAndPlayLesson();
      s().set({ typed: "" });
      await koch.finishLesson();
      expect(s().result?.suggestStepBack).toBe(i === 2);
    }
    expect(s().info?.level).toBe(3);
    await koch.stepBack();
    expect(s().result?.decision).toBe("steppedBack");
    expect(s().info?.level).toBe(2);
    const history = await store.getKochHistory(requireProfile().id);
    expect(history.at(-1)).toMatchObject({ level: 2, reason: "regressed" });
  });

  it("jump to level keeps history and changes the learned set", async () => {
    await koch.jumpToLevel(5);
    expect(s().info?.chars).toEqual(["K", "M", "U", "R", "E", "S"]);
    const history = await store.getKochHistory(requireProfile().id);
    expect(history.at(-1)).toMatchObject({ level: 5, reason: "manual" });
  });

  it("keeps the typed text and shows the error if saving fails", async () => {
    await startAndPlayLesson();
    s().set({ typed: "KM" });
    vi.spyOn(store, "recordTrial").mockRejectedValueOnce(new Error("disk full"));
    await koch.finishLesson();
    expect(s().phase).toBe("finishing");
    expect(s().typed).toBe("KM");
    expect(s().error).toMatch(/disk full/);
  });
});

describe("review fixes: races and failures", () => {
  /** Starts a lesson past the intro and returns once it is playing. */
  async function playing(): Promise<void> {
    useSettings.getState().set("koch.introSeen", { lcwo: 1 });
    await koch.startLesson();
    expect(s().phase).toBe("playing");
  }

  it("a double start opens one lesson, not two", async () => {
    useSettings.getState().set("koch.introSeen", { lcwo: 1 });
    await Promise.all([koch.startLesson(), koch.startLesson(), koch.beginLesson()]);
    expect(s().phase).toBe("playing");
    expect(await store.listSessions(requireProfile().id)).toHaveLength(1);
  });

  it("leaving the screen while a lesson is starting cancels it, with no audio left playing", async () => {
    useSettings.getState().set("koch.introSeen", { lcwo: 1 });
    const started = koch.startLesson();
    expect(s().phase).toBe("starting");
    koch.pauseLesson("left");
    await started;
    expect(s().phase).toBe("idle");
    expect(plays).toHaveLength(0);
    expect(koch.lessonInProgress()).toBe(false);
  });

  it("a profile switch during the start doesn't write to the old profile", async () => {
    useSettings.getState().set("koch.introSeen", { lcwo: 1 });
    const started = koch.startLesson();
    koch.resetKoch();
    await started;
    expect(plays).toHaveLength(0);
    expect(s().phase).toBe("loading");
    const sessions = await store.listSessions(requireProfile().id);
    expect(sessions.every((x) => !x.completed && x.endedAt !== null)).toBe(true);
  });

  it("Stop during Resume scores the lesson and doesn't restart the audio", async () => {
    await playing();
    lastPlay().listener.onToken?.(0);
    koch.pauseLesson("user");
    const before = plays.length;
    const resumed = koch.resumeLesson();
    expect(s().phase).toBe("resuming");
    const stopped = koch.stopLesson();
    await Promise.all([resumed, stopped]);
    expect(s().phase).toBe("results");
    expect(plays).toHaveLength(before);
  });

  it("Resume keeps the lesson's own speed after the settings change", async () => {
    await playing();
    const call = lastPlay();
    for (const i of [0, 1]) call.listener.onToken?.(i);
    koch.pauseLesson("left");
    useSettings.getState().set("timing.speeds", { charWpm: 40, effWpm: 40 });
    await koch.resumeLesson();
    const firstOn = (c: PlayCall) => c.elements.find((e) => e.on) as TimelineElement;
    // The same first character, keyed at the original 20 WPM.
    expect(firstOn(lastPlay()).dur).toBeCloseTo(firstOn(call).dur);
  });

  it("Advance moves up the order the lesson was taken in, even if the order changed", async () => {
    s().set({ typed: await startAndPlayLesson() });
    await koch.finishLesson();
    useSettings.getState().set("learning.kochOrder", "g4fon");
    await koch.advance();
    const progress = await store.getKochProgress(requireProfile().id);
    expect(progress.map((p) => [p.orderId, p.level])).toEqual([["lcwo", 2]]);
  });

  it("retrying after the session close failed doesn't write the trial twice", async () => {
    const text = await startAndPlayLesson();
    s().set({ typed: text });
    vi.spyOn(store, "endSession").mockRejectedValueOnce(new Error("locked"));
    await koch.finishLesson();
    expect(s().phase).toBe("finishing");
    expect(s().error).toMatch(/locked/);
    await koch.finishLesson();
    expect(s().phase).toBe("results");
    const [session] = await store.listSessions(requireProfile().id);
    expect(await store.listTrials(session?.id ?? "")).toHaveLength(1);
    expect(session).toMatchObject({ completed: true, sentChars: text.replace(/ /g, "").length });
  });

  it("a failure after the lesson is saved still shows the results", async () => {
    useSettings.getState().set("learning.advancement", "auto");
    s().set({ typed: await startAndPlayLesson() });
    vi.spyOn(store, "setKochLevel").mockRejectedValueOnce(new Error("busy"));
    await koch.finishLesson();
    expect(s().phase).toBe("results");
    expect(s().error).toMatch(/lesson was saved.*busy/);
    expect(s().result?.decision).toBeNull(); // so Advance can be tried by hand
    expect(koch.lessonInProgress()).toBe(false);
  });

  it("a stopped lesson whose saving failed can be saved again", async () => {
    await playing();
    lastPlay().listener.onToken?.(0);
    vi.spyOn(store, "recordTrial").mockRejectedValueOnce(new Error("disk full"));
    await koch.stopLesson();
    expect(s().phase).toBe("unsaved");
    await koch.retryStopped();
    expect(s().phase).toBe("results");
    expect(s().result?.completed).toBe(false);
  });

  it("lessons under a minute don't count as the best or towards stepping back", async () => {
    useSettings.getState().set("koch.lengthKind", "groups");
    useSettings.getState().set("koch.groups", 5);
    s().set({ typed: await startAndPlayLesson() });
    await koch.finishLesson();
    expect(s().result?.score.accuracy).toBe(1);
    expect(s().info).toMatchObject({ lessons: 0, bestAccuracy: null });
  });

  it("taking the audio ends the Text Player's type-to-transmit", async () => {
    usePlayerStore.setState({ liveMode: true, status: "live" });
    await playing();
    expect(usePlayerStore.getState()).toMatchObject({ liveMode: false, status: "idle" });
    // A keystroke in the Player now does nothing instead of throwing.
    expect(() => {
      player.onLiveEdit("", "A");
    }).not.toThrow();
  });
});
