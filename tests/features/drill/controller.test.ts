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
const { useNavStore } = await import("../../../src/state/nav");
const { drillStores } = await import("../../../src/features/drill/store");
const drill = await import("../../../src/features/drill/controller");
const { practiseChars, practiseInCustom } = await import("../../../src/features/drill/practise");
const { wordList } = await import("../../../src/core/bundled");
const { audioEngine } = await import("../../../src/audio/engine");

type Store = Awaited<ReturnType<typeof openTestProfile>>;
let store: Store;

const lastPlay = () => plays[plays.length - 1] as PlayCall;
const s = (mode: Parameters<typeof drill.start>[0] = "groups") => drillStores[mode].getState();

function finishPlaying(): void {
  lastPlay().listener.onDone?.();
}

/** Answers the current item correctly (or with `typed`) and waits for feedback. */
async function answer(mode: Parameters<typeof drill.start>[0], typed?: string): Promise<void> {
  finishPlaying();
  s(mode).set({ typed: typed ?? s(mode).item?.text ?? "" });
  await drill.submit(mode);
  expect(s(mode).phase).toBe("feedback");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  plays.length = 0;
  store = await openTestProfile();
  drill.resetDrills();
  useSettings.getState().set("groups.items", 5);
  useSettings.getState().set("words.items", 5);
  useSettings.getState().set("callsigns.items", 5);
});

afterEach(() => {
  drill.resetDrills();
  vi.useRealTimers();
});

describe("per-item sessions", () => {
  it("plays, scores and saves each item as its own trial, then shows the results", async () => {
    await drill.start("groups");
    expect(s().phase).toBe("playing");
    expect(s().total).toBe(5);
    expect(s().item?.text).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      await answer("groups", i === 0 ? "" : undefined);
      await drill.next("groups");
    }
    expect(s().phase).toBe("results");
    const summary = s().summary;
    expect(summary?.items).toHaveLength(5);
    expect(summary?.completed).toBe(true);
    expect(summary?.totals.sentCharCount).toBe(25);
    expect(summary?.totals.correct).toBe(20); // the first item was left blank

    const [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ mode: "groups", completed: true, sentChars: 25 });
    expect(session?.accuracy).toBeCloseTo(0.8);
    expect(session?.settingsSnapshot).toMatchObject({ items: 5, groupLength: 5 });
    const trials = await store.listTrials(session?.id ?? "");
    expect(trials.map((t) => t.idx)).toEqual([0, 1, 2, 3, 4]);
    // Copy modes record no response times, so ewmaRt stays empty.
    const stats = await store.getCharStats(requireProfile().id);
    expect(stats.every((x) => x.ewmaRt === null)).toBe(true);
  });

  it("counts repeats and scores a reveal as all missed", async () => {
    await drill.start("groups");
    finishPlaying();
    await drill.repeat("groups");
    await drill.repeat("groups");
    expect(s().repeats).toBe(2);
    expect(plays).toHaveLength(3);
    s().set({ typed: s().item?.text ?? "" });
    await drill.reveal("groups");
    expect(s().feedback).toMatchObject({ revealed: true, repeats: 2 });
    expect(s().feedback?.score.correct).toBe(0);
    const [session] = await store.listSessions(requireProfile().id);
    const [trial] = await store.listTrials(session?.id ?? "");
    expect(trial).toMatchObject({ revealed: true, repeats: 2, accuracy: 0 });
  });

  it("submitting while the item still plays stops the audio and scores it", async () => {
    await drill.start("groups");
    stops.mockClear();
    s().set({ typed: s().item?.text ?? "" });
    await drill.submit("groups");
    expect(stops).toHaveBeenCalled();
    expect(s().feedback?.score.accuracy).toBe(1);
  });

  it("stop keeps answered items and shows them; with none it scores nothing", async () => {
    await drill.start("groups");
    await drill.stop("groups");
    expect(s().phase).toBe("idle");
    expect(s().notice).toMatch(/nothing was scored/);
    let [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ completed: false, sentChars: 0 });

    vi.advanceTimersByTime(1000);
    await drill.start("groups");
    await answer("groups");
    await drill.next("groups");
    await drill.stop("groups");
    expect(s().phase).toBe("results");
    expect(s().summary).toMatchObject({ completed: false, planned: 5 });
    expect(s().summary?.items).toHaveLength(1);
    [session] = await store.listSessions(requireProfile().id);
    expect(session).toMatchObject({ completed: false, sentChars: 5 });
  });

  it("pausing stops audio and active time; resuming replays a cut-off item without counting it", async () => {
    await drill.start("groups");
    vi.advanceTimersByTime(2000);
    drill.pause("groups", "hidden");
    expect(s().phase).toBe("paused");
    vi.advanceTimersByTime(60_000); // hidden: not counted
    await drill.resume("groups");
    expect(s().phase).toBe("playing");
    expect(s().repeats).toBe(0);
    expect(plays).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    await answer("groups");
    drill.pause("groups", "left");
    await drill.resume("groups");
    expect(s().phase).toBe("feedback");
    await drill.stop("groups");
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.activeMs).toBe(3000);
  });

  it("keeps the answer and retries with the same trial when saving fails", async () => {
    await drill.start("groups");
    finishPlaying();
    s().set({ typed: "ABCDE" });
    const spy = vi.spyOn(store, "recordTrial").mockRejectedValueOnce(new Error("disk full"));
    await drill.submit("groups");
    expect(s().phase).toBe("answering");
    expect(s().error).toMatch(/disk full/);
    expect(s().typed).toBe("ABCDE");
    await drill.submit("groups");
    expect(s().phase).toBe("feedback");
    expect(spy.mock.calls[0]?.[0].trial.id).toBe(spy.mock.calls[1]?.[0].trial.id);
  });

  it("closes an unfinished session when the profile is reset", async () => {
    await drill.start("words");
    await answer("words");
    drill.resetDrills();
    expect(s("words").phase).toBe("idle");
    await vi.waitFor(async () => {
      const [session] = await store.listSessions(requireProfile().id);
      expect(session?.endedAt).not.toBeNull();
    });
  });
});

describe("modes", () => {
  it("Random Groups refuses fewer than two characters", async () => {
    useSettings.getState().set("groups.source", "custom");
    useSettings.getState().set("groups.custom", "K");
    await drill.start("groups");
    expect(s().phase).toBe("idle");
    expect(s().notice).toMatch(/at least two/);
    expect(await store.listSessions(requireProfile().id)).toHaveLength(0);
  });

  it("Random Groups on the learned Koch characters", async () => {
    useSettings.getState().set("groups.source", "koch");
    await drill.start("groups");
    expect(s().item?.text).toMatch(/^[KM]{5}$/);
  });

  it("Practice these characters overrides the set until cleared", async () => {
    practiseChars(["H", "5"]);
    expect(useNavStore.getState().screen).toBe("groups");
    await drill.start("groups");
    expect(s().item?.text).toMatch(/^[H5]{5}$/);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.settingsSnapshot).toMatchObject({ chars: ["H", "5"], source: "practise" });
    await drill.stop("groups");
    drill.setOverride(null);
    expect(s().override).toBeNull();
  });

  it("a practice can force adaptive weighting over a saved Uniform", async () => {
    useSettings.getState().set("groups.weighting", "uniform");
    const weightings = async () =>
      (await store.listSessions(requireProfile().id))
        .map((x) => (x.settingsSnapshot as { weighting?: string }).weighting)
        .sort();
    practiseChars(["H", "5"], "adaptive");
    await drill.start("groups");
    expect(await weightings()).toEqual(["adaptive"]);
    await drill.stop("groups");
    // A practice without one follows the saved setting.
    practiseChars(["H", "5"]);
    await drill.start("groups");
    expect(await weightings()).toEqual(["adaptive", "uniform"]);
    await drill.stop("groups");
    expect(useSettings.getState().values["groups.weighting"]).toBe("uniform");
  });

  it("Words shows meanings and can keep to learned characters", async () => {
    useSettings.getState().set("words.list", "qcodes");
    await drill.start("words");
    await answer("words");
    expect(s("words").feedback?.item.meaning).toBeTruthy();
    await drill.stop("words");

    useSettings.getState().set("words.learnedOnly", true);
    drill.dismissResults("words");
    await drill.start("words");
    expect(s("words").phase).toBe("idle");
    expect(s("words").notice).toMatch(/No words in Q-codes/);

    await store.setKochLevel(requireProfile().id, "lcwo", 40, "manual", Date.now());
    await drill.start("words");
    expect(wordList("qcodes").items.map((w) => w.word)).toContain(s("words").item?.text);
  });

  it("Callsigns follow the format and US-only settings", async () => {
    useSettings.getState().set("callsigns.formats", ["1x3"]);
    useSettings.getState().set("callsigns.usOnly", true);
    await drill.start("callsigns");
    expect(s("callsigns").item?.text).toMatch(/^[WKN]\d[A-Z]{3}$/);
  });

  it("Custom plays every chunk in order and reports dropped characters", async () => {
    useSettings.getState().set("custom.text", "cq cq de w1abc\nname is bob ☺\n");
    useSettings.getState().set("custom.split", "line");
    await drill.start("custom");
    expect(s("custom").total).toBe(2);
    expect(s("custom").item?.text).toBe("CQ CQ DE W1ABC");
    expect(s("custom").notice).toMatch(/☺/);
    await answer("custom");
    await drill.next("custom");
    expect(s("custom").item?.text).toBe("NAME IS BOB");
  });

  it("a snippet loads into Custom, but not over a running session or past the limit", async () => {
    expect(practiseInCustom("tu 73", "Sign-off")).toBe("loaded");
    expect(useSettings.getState().values["custom.text"]).toBe("tu 73");
    expect(s("custom").notice).toMatch(/Sign-off/);
    expect(useNavStore.getState().screen).toBe("custom");
    expect(practiseInCustom("x".repeat(20_001), "Long")).toBe("tooLong");
    expect(useSettings.getState().values["custom.text"]).toBe("tu 73");
    await drill.start("custom");
    expect(practiseInCustom("other", "Other")).toBe("busy");
    expect(useSettings.getState().values["custom.text"]).toBe("tu 73");
  });

  it("Practice these characters says so when a Groups session is running", async () => {
    await drill.start("groups");
    expect(practiseChars(["H", "5"])).toBe(false);
    expect(s().override).toBeNull();
    expect(s().notice).toMatch(/Finish or stop/);
  });
});

describe("races and recovery (code review, phase 5)", () => {
  it("a second Next while audio starts doesn't skip an item", async () => {
    await drill.start("groups");
    await answer("groups");
    const first = drill.next("groups");
    const second = drill.next("groups");
    await Promise.all([first, second]);
    expect(s().index).toBe(1);
    expect(s().phase).toBe("playing");
  });

  it("a second Resume doesn't replay twice or lose the item", async () => {
    await drill.start("groups");
    drill.pause("groups", "hidden");
    await Promise.all([drill.resume("groups"), drill.resume("groups")]);
    expect(s().phase).toBe("playing");
    expect(plays).toHaveLength(2);
  });

  it("pausing while an answer saves pauses once the save lands", async () => {
    await drill.start("groups");
    finishPlaying();
    s().set({ typed: s().item?.text ?? "" });
    const saving = drill.submit("groups");
    drill.pause("groups", "hidden");
    await saving;
    expect(s().phase).toBe("paused");
    expect(s().feedback?.score.accuracy).toBe(1);
    vi.advanceTimersByTime(60_000);
    await drill.resume("groups");
    expect(s().phase).toBe("feedback");
    await drill.stop("groups");
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.activeMs).toBe(0);
  });

  it("a reset while closing doesn't mark a finished session incomplete", async () => {
    useSettings.getState().set("groups.items", 5);
    await drill.start("groups");
    for (let i = 0; i < 4; i++) {
      await answer("groups");
      await drill.next("groups");
    }
    await answer("groups");
    const closing = drill.next("groups");
    drill.resetDrills();
    await closing;
    await new Promise((r) => setTimeout(r, 0));
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.completed).toBe(true);
  });

  it("Esc on the last item's feedback still completes the session", async () => {
    await drill.start("groups");
    for (let i = 0; i < 4; i++) {
      await answer("groups");
      await drill.next("groups");
    }
    await answer("groups");
    await drill.stop("groups");
    expect(s().summary?.completed).toBe(true);
    const [session] = await store.listSessions(requireProfile().id);
    expect(session?.completed).toBe(true);
  });

  it("a start that fails after the session opened closes it", async () => {
    vi.spyOn(audioEngine, "setFrequency").mockImplementationOnce(() => {
      throw new Error("late failure");
    });
    await drill.start("groups");
    expect(s().phase).toBe("idle");
    expect(s().error).toMatch(/late failure/);
    await vi.waitFor(async () => {
      const [session] = await store.listSessions(requireProfile().id);
      expect(session).toMatchObject({ completed: false });
      expect(session?.endedAt).not.toBeNull();
    });
  });

  it("a retry after a save that committed but reported failure counts as saved", async () => {
    await drill.start("groups");
    finishPlaying();
    s().set({ typed: "X" });
    const real = store.recordTrial.bind(store);
    vi.spyOn(store, "recordTrial").mockImplementationOnce(async (rec) => {
      await real(rec);
      throw new Error("lost reply");
    });
    await drill.submit("groups");
    expect(s().phase).toBe("feedback");
    const [session] = await store.listSessions(requireProfile().id);
    expect(await store.listTrials(session?.id ?? "")).toHaveLength(1);
  });

  it("closing failure: retry, or show the results anyway", async () => {
    await drill.start("groups");
    await answer("groups");
    const spy = vi.spyOn(store, "endSession").mockRejectedValueOnce(new Error("locked"));
    await drill.stop("groups");
    expect(s().phase).toBe("unsaved");
    expect(s().error).toMatch(/locked/);
    spy.mockRejectedValueOnce(new Error("locked again"));
    await drill.retryFinish("groups");
    expect(s().phase).toBe("unsaved");
    drill.resultsWithoutClosing("groups");
    expect(s().phase).toBe("results");
    expect(s().notice).toMatch(/marked incomplete/);
  });

  it("a replay uses the session's speed, not the current setting", async () => {
    await drill.start("groups");
    await answer("groups");
    const sent = lastPlay().elements;
    useSettings.getState().set("timing.speeds", { charWpm: 40, effWpm: 40 });
    await drill.replayItem("groups", 0);
    expect(lastPlay().elements).toEqual(sent);
  });
});
