import { audioEngine } from "../../audio/engine";
import type { KeyingScheduler } from "../../audio/scheduler";
import { currentScheduler, getScheduler } from "../../audio/shared";
import { audioSpanMs, ITEM_LEAD_IN_MS, totalScores } from "../../core/drill";
import { effectiveRiseMs } from "../../core/envelope";
import { weakestChars } from "../../core/lesson";
import { mulberry32, seedFromString } from "../../core/rng";
import { charsPerMinute, scoreRevealed, scoreTrial } from "../../core/scoring";
import { buildTimeline, type TimelineElement } from "../../core/timeline";
import { computeTiming, type Timing } from "../../core/timing";
import { tokenize, type Token } from "../../core/tokenize";
import { addNotice, errorText, requireProfile, requireStore } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { SettingsValues } from "../../state/settings-schema";
import { buildTrialRecord } from "../../storage/records";
import { saveTrial } from "../copy/save";
import * as player from "../player/controller";
import { planDrill, SetupError } from "./modes";
import {
  DRILL_MODES,
  drillStores,
  initialDrillState,
  type DrillItem,
  type DrillMode,
  type DrillSummary,
  type ItemResult,
} from "./store";

/**
 * Drives the per-item copy modes (SPEC §7, "Common pattern"): play an item, the
 * user types and submits (or Reveals), the item is scored and written as one
 * trial straight away (§9.4), then the next item. Repeat replays the item and is
 * counted. Each mode has its own state and session, and only one plays at a time.
 *
 * As in Koch, every action that awaits takes a ticket from its mode's epoch, and
 * anything that cancels moves the epoch on, so a stale action gives up after
 * its await.
 */

const store = (mode: DrillMode) => drillStores[mode];
const state = (mode: DrillMode) => drillStores[mode].getState();
const settings = (): SettingsValues => useSettings.getState().values;

const epochs: Record<DrillMode, number> = { groups: 0, words: 0, callsigns: 0, custom: 0 };
const ticket = (mode: DrillMode): number => ++epochs[mode];
const stale = (mode: DrillMode, t: number): boolean => t !== epochs[mode];

function fail(mode: DrillMode, action: string, err: unknown): void {
  state(mode).set({ error: `${action} failed: ${errorText(err)}` });
}

/** Takes the shared scheduler from the Text Player (ending its live mode), then starts audio. */
async function takeAudio(): Promise<KeyingScheduler> {
  await player.releaseAudio();
  return await getScheduler();
}

function silence(): void {
  currentScheduler()?.stop();
}

/* Session ----------------------------------------------------------------- */

interface Running {
  sessionId: string;
  profileId: string;
  items: readonly DrillItem[];
  /** The timing and tone the session started with (settings may change). */
  timing: Timing;
  toneHz: number;
  charWpm: number;
  index: number;
  /** The current item's trial id, so a retried save never writes twice. */
  trialId: string;
  results: ItemResult[];
  activeMs: number;
  /** Date.now() when active time last resumed, or null while paused. */
  activeSince: number | null;
  /** What to go back to on resume. */
  pausedFrom: "playing" | "answering" | "feedback" | null;
  /** A pause asked for while an answer was saving; applied when the save lands. */
  pauseAfterSave: "hidden" | "left" | null;
  /** finish() has sent the session's close, so a reset mustn't close it again. */
  closing: boolean;
  /** Whether the session ran to the end, for retrying a failed close. */
  completed: boolean;
}

const runs = new Map<DrillMode, Running>();

function closeActive(r: Running): void {
  if (r.activeSince === null) return;
  r.activeMs += Date.now() - r.activeSince;
  r.activeSince = null;
}

function itemTimeline(timing: Timing, text: string): TimelineElement[] {
  return buildTimeline(tokenize(text).tokens, timing, { leadIn: ITEM_LEAD_IN_MS });
}

/** Starts a session of the mode's items and plays the first. */
export async function start(mode: DrillMode): Promise<void> {
  const phase = state(mode).phase;
  if (phase !== "idle" && phase !== "results") return;
  stopReplay(mode);
  const t = ticket(mode);
  state(mode).set({
    ...initialDrillState,
    override: state(mode).override,
    phase: "starting",
  });

  let sessionId: string | null = null;
  try {
    const db = requireStore();
    const profileId = requireProfile().id;
    const v = settings();
    const id = crypto.randomUUID();
    const seed = seedFromString(id);
    const plan = await planDrill({
      mode,
      v,
      rng: mulberry32(seed),
      store: db,
      profileId,
      override: mode === "groups" ? state(mode).override : null,
    });
    if (stale(mode, t)) return;
    const sched = await takeAudio();
    if (stale(mode, t)) return;
    await db.startSession({
      id,
      profileId,
      mode,
      startedAt: Date.now(),
      seed,
      settingsSnapshot: {
        charWpm: v["timing.speeds"].charWpm,
        effWpm: v["timing.speeds"].effWpm,
        wordSpacing: v["timing.wordSpacing"],
        toneHz: v["audio.toneHz"],
        items: plan.items.length,
        ...plan.snapshot,
      },
    });
    sessionId = id;
    if (stale(mode, t)) {
      await db.endSession(id, { endedAt: Date.now(), activeMs: 0, completed: false });
      return;
    }
    const r: Running = {
      sessionId: id,
      profileId,
      items: plan.items,
      timing: computeTiming({ ...v["timing.speeds"], wordSpacing: v["timing.wordSpacing"] }),
      toneHz: v["audio.toneHz"],
      charWpm: v["timing.speeds"].charWpm,
      index: 0,
      trialId: crypto.randomUUID(),
      results: [],
      activeMs: 0,
      activeSince: Date.now(),
      pausedFrom: null,
      pauseAfterSave: null,
      closing: false,
      completed: false,
    };
    runs.set(mode, r);
    state(mode).set({
      total: plan.items.length,
      index: 0,
      item: plan.items[0] ?? null,
      notice: plan.notice,
    });
    playCurrent(mode, sched, t);
  } catch (err) {
    if (stale(mode, t)) return;
    runs.delete(mode);
    state(mode).set({ phase: "idle" });
    if (err instanceof SetupError) {
      state(mode).set({ notice: err.message });
      return;
    }
    fail(mode, sessionId ? "Starting" : "Starting (nothing was saved)", err);
    if (sessionId) {
      // The session row exists but nothing played: close it as incomplete.
      requireStore()
        .endSession(sessionId, { endedAt: Date.now(), activeMs: 0, completed: false })
        .catch((closeErr: unknown) => {
          fail(mode, "Closing the session that didn't start", closeErr);
        });
    }
  }
}

function playCurrent(mode: DrillMode, sched: KeyingScheduler, t: number): void {
  const r = runs.get(mode);
  const item = r?.items[r.index];
  if (!r || !item) return;
  audioEngine.setFrequency(r.toneHz);
  audioEngine.setVolume(settings()["audio.volume"]);
  const elements = itemTimeline(r.timing, item.text);
  state(mode).set({ phase: "playing", heardToken: null });
  sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
    onToken: (i) => {
      if (!stale(mode, t)) state(mode).set({ heardToken: i });
    },
    onDone: () => {
      if (stale(mode, t) || runs.get(mode) !== r) return;
      state(mode).set({ phase: "answering", heardToken: null });
    },
  });
}

async function playAgain(mode: DrillMode, countRepeat: boolean): Promise<void> {
  const r = runs.get(mode);
  if (!r) return;
  const t = ticket(mode);
  // "playing" straight away, so nothing can act on the old phase while audio starts.
  state(mode).set({
    phase: "playing",
    heardToken: null,
    ...(countRepeat ? { repeats: state(mode).repeats + 1 } : {}),
  });
  try {
    const sched = await takeAudio();
    if (stale(mode, t) || runs.get(mode) !== r) return;
    playCurrent(mode, sched, t);
  } catch (err) {
    if (stale(mode, t)) return;
    state(mode).set({ phase: "answering" });
    fail(mode, "Playing", err);
  }
}

/** Repeat (Ctrl+Space): plays the current item again. Every repeat is counted. */
export function repeat(mode: DrillMode): Promise<void> {
  const phase = state(mode).phase;
  if (phase !== "playing" && phase !== "answering") return Promise.resolve();
  return playAgain(mode, true);
}

/** Submit (Enter): scores what was typed. */
export function submit(mode: DrillMode): Promise<void> {
  return score(mode, false);
}

/** Reveal (Ctrl+Shift+Enter): shows the answer; every character counts as missed. */
export function reveal(mode: DrillMode): Promise<void> {
  return score(mode, true);
}

async function score(mode: DrillMode, revealed: boolean): Promise<void> {
  const r = runs.get(mode);
  const phase = state(mode).phase;
  const item = r?.items[r.index];
  if (!r || !item || (phase !== "playing" && phase !== "answering")) return;
  const t = ticket(mode);
  if (phase === "playing") silence();
  const { typed, repeats } = state(mode);
  state(mode).set({ phase: "saving", heardToken: null, error: null });
  const record = buildTrialRecord({
    id: r.trialId,
    profileId: r.profileId,
    sessionId: r.sessionId,
    mode,
    idx: r.index,
    prompt: item.text,
    response: typed,
    revealed,
    repeats,
    responseMs: null,
    charWpm: r.charWpm,
    at: Date.now(),
  });
  try {
    await saveTrial(record);
  } catch (err) {
    if (stale(mode, t)) return;
    // The answer is kept, so submitting again retries with the same trial id.
    if (applyPauseAfterSave(mode, r, "answering")) return;
    state(mode).set({ phase: "answering" });
    fail(mode, "Saving the answer", err);
    return;
  }
  const result: ItemResult = {
    item,
    response: typed,
    revealed,
    repeats,
    score: revealed ? scoreRevealed(item.text) : scoreTrial(item.text, typed),
    audioMs: audioSpanMs(itemTimeline(r.timing, item.text)),
  };
  r.results.push(result);
  if (stale(mode, t) || runs.get(mode) !== r) return;
  state(mode).set({ feedback: result });
  if (applyPauseAfterSave(mode, r, "feedback")) return;
  state(mode).set({ phase: "feedback" });
}

/** Applies a pause that was asked for while saving. Returns true if it paused. */
function applyPauseAfterSave(mode: DrillMode, r: Running, from: "answering" | "feedback"): boolean {
  const by = r.pauseAfterSave;
  if (by === null) return false;
  r.pauseAfterSave = null;
  r.pausedFrom = from;
  state(mode).set({ phase: "paused", pausedBy: by });
  return true;
}

/** Next (Enter or Ctrl+Enter after an answer): the next item, or the results after the last. */
export async function next(mode: DrillMode): Promise<void> {
  const r = runs.get(mode);
  if (!r || state(mode).phase !== "feedback") return;
  stopReplay(mode);
  if (r.index + 1 >= r.items.length) {
    await finish(mode, true);
    return;
  }
  r.index++;
  r.trialId = crypto.randomUUID();
  state(mode).set({
    index: r.index,
    item: r.items[r.index] ?? null,
    typed: "",
    repeats: 0,
    feedback: null,
  });
  await playAgain(mode, false);
}

/**
 * Stop (Esc): ends the session early. Answered items stay saved and are shown
 * in the results; with none, it goes back to the start.
 */
export async function stop(mode: DrillMode): Promise<void> {
  const phase = state(mode).phase;
  if (phase === "starting") {
    ticket(mode);
    silence();
    state(mode).set({ phase: "idle" });
    return;
  }
  const r = runs.get(mode);
  if (
    !r ||
    (phase !== "playing" && phase !== "answering" && phase !== "feedback" && phase !== "paused")
  ) {
    return;
  }
  ticket(mode);
  silence();
  stopReplay(mode);
  if (r.results.length > 0) {
    // Esc on the last item's feedback still finishes the whole session.
    await finish(mode, r.results.length === r.items.length);
    return;
  }
  closeActive(r);
  runs.delete(mode);
  state(mode).set({
    ...initialDrillState,
    override: state(mode).override,
    notice: "Stopped before any answers, so nothing was scored.",
  });
  try {
    await requireStore().endSession(r.sessionId, {
      endedAt: Date.now(),
      activeMs: Math.round(r.activeMs),
      completed: false,
    });
  } catch (err) {
    fail(mode, "Closing the session", err);
  }
}

/** Closes the session and shows the results. Also retries a failed close. */
export async function finish(mode: DrillMode, completed: boolean): Promise<void> {
  const r = runs.get(mode);
  if (!r) return;
  const t = ticket(mode);
  closeActive(r);
  r.completed = completed;
  r.closing = true;
  state(mode).set({ phase: "closing", error: null });
  try {
    await requireStore().endSession(r.sessionId, {
      endedAt: Date.now(),
      activeMs: Math.round(r.activeMs),
      completed,
    });
  } catch (err) {
    r.closing = false;
    if (stale(mode, t)) return;
    state(mode).set({ phase: "unsaved" });
    fail(mode, "Closing the session", err);
    return;
  }
  if (stale(mode, t) || runs.get(mode) !== r) return;
  showResults(mode, r);
}

function showResults(mode: DrillMode, r: Running): void {
  runs.delete(mode);
  state(mode).set({
    phase: "results",
    summary: summarize(r.results, r.items.length, r.completed, r.timing, r.toneHz),
    item: null,
    feedback: null,
    heardToken: null,
  });
}

/** "Try again" after closing the session failed. */
export function retryFinish(mode: DrillMode): Promise<void> {
  const r = runs.get(mode);
  if (!r || state(mode).phase !== "unsaved") return Promise.resolve();
  return finish(mode, r.completed);
}

/**
 * "Show results anyway" after closing failed. The answers are saved; the
 * session itself is closed as incomplete the next time the profile opens.
 */
export function resultsWithoutClosing(mode: DrillMode): void {
  const r = runs.get(mode);
  if (!r || state(mode).phase !== "unsaved") return;
  ticket(mode);
  showResults(mode, r);
  state(mode).set({
    error: null,
    notice:
      "Your answers are saved. The session couldn't be closed, so it will be marked incomplete the next time this profile opens.",
  });
}

export function summarize(
  results: readonly ItemResult[],
  planned: number,
  completed: boolean,
  timing: Timing,
  toneHz: number,
): DrillSummary {
  const totals = totalScores(results.map((x) => x.score));
  const audioMs = results.reduce((n, x) => n + x.audioMs, 0);
  return {
    items: results,
    planned,
    completed,
    totals,
    cpm: audioMs > 0 ? charsPerMinute(totals.correct, audioMs) : 0,
    weak: weakestChars(results.flatMap((x) => x.score.chars)),
    timing,
    toneHz,
  };
}

/* Pause ------------------------------------------------------------------- */

/**
 * Hiding the window or leaving the screen pauses: audio stops and active time
 * stops counting. While starting, it cancels the start instead.
 */
export function pause(mode: DrillMode, by: "hidden" | "left"): void {
  const phase = state(mode).phase;
  stopReplay(mode);
  if (phase === "starting") {
    ticket(mode);
    silence();
    state(mode).set({ phase: "idle" });
    return;
  }
  const r = runs.get(mode);
  if (!r) return;
  if (phase === "saving") {
    // Let the save land, then pause (score() applies it).
    closeActive(r);
    r.pauseAfterSave = by;
    return;
  }
  if (phase !== "playing" && phase !== "answering" && phase !== "feedback") return;
  ticket(mode);
  if (phase === "playing") silence();
  closeActive(r);
  r.pausedFrom = phase;
  state(mode).set({ phase: "paused", pausedBy: by, heardToken: null });
}

/** Resumes where it paused. An item cut off while playing plays again (not counted as a repeat). */
export async function resume(mode: DrillMode): Promise<void> {
  const r = runs.get(mode);
  if (!r || state(mode).phase !== "paused") return;
  const from = r.pausedFrom ?? "answering";
  r.pausedFrom = null;
  r.activeSince = Date.now();
  state(mode).set({ pausedBy: null, error: null });
  if (from === "playing") {
    // playAgain() leaves "paused" synchronously, so a second Resume does nothing.
    await playAgain(mode, false);
  } else {
    ticket(mode);
    state(mode).set({ phase: from });
  }
}

/* Replay with text shown -------------------------------------------------- */

/** Replays an answered item with its diff highlighted: the one in feedback, or one in the results. */
export async function replayItem(mode: DrillMode, index: number): Promise<void> {
  const { phase, feedback, summary } = state(mode);
  const result =
    phase === "feedback" ? (index === state(mode).index ? feedback : null) : summary?.items[index];
  // What was sent: the session's own speed and tone, whatever the settings say now.
  const sound = phase === "feedback" ? runs.get(mode) : summary;
  if (!result || !sound || (phase !== "feedback" && phase !== "results")) return;
  const t = ticket(mode);
  state(mode).set({ replay: { index, token: null } });
  try {
    const sched = await takeAudio();
    if (stale(mode, t)) return;
    audioEngine.setFrequency(sound.toneHz);
    audioEngine.setVolume(settings()["audio.volume"]);
    const elements = itemTimeline(sound.timing, result.item.text);
    sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
      onToken: (i) => {
        if (!stale(mode, t)) state(mode).set({ replay: { index, token: i } });
      },
      onDone: () => {
        if (!stale(mode, t)) state(mode).set({ replay: null });
      },
    });
  } catch (err) {
    if (stale(mode, t)) return;
    state(mode).set({ replay: null });
    fail(mode, "Replay", err);
  }
}

export function stopReplay(mode: DrillMode): void {
  if (!state(mode).replay) return;
  ticket(mode);
  silence();
  state(mode).set({ replay: null });
}

/* Lifecycle --------------------------------------------------------------- */

/** Results → back to the setup. */
export function dismissResults(mode: DrillMode): void {
  stopReplay(mode);
  if (state(mode).phase === "results") {
    state(mode).set({ phase: "idle", summary: null });
  }
}

/**
 * Random Groups: "Practice these characters" (null clears it). Refused while a
 * Groups session is under way; returns whether it was applied.
 */
export function setOverride(chars: readonly string[] | null): boolean {
  const mode = "groups";
  const phase = state(mode).phase;
  if (phase !== "idle" && phase !== "results") return false;
  dismissResults(mode);
  state(mode).set({ override: chars, notice: null, error: null });
  return true;
}

/**
 * Drops every running session without scoring more (profile switch). Answered
 * items are already saved; each session is closed as incomplete, and if that
 * write fails, the next launch closes it.
 */
export function resetDrills(): void {
  for (const mode of DRILL_MODES) {
    const r = runs.get(mode);
    const busy = r !== undefined || state(mode).phase === "starting" || state(mode).replay;
    ticket(mode);
    if (busy) silence();
    runs.delete(mode);
    store(mode).setState({ ...initialDrillState });
    if (r && !r.closing) {
      closeActive(r);
      void Promise.resolve()
        .then(() =>
          requireStore().endSession(r.sessionId, {
            endedAt: Date.now(),
            activeMs: Math.round(r.activeMs),
            completed: false,
          }),
        )
        .catch((err: unknown) => {
          addNotice(
            "warning",
            `An unfinished session couldn't be closed (${errorText(err)}). It will be saved as incomplete when that profile next opens.`,
          );
        });
    }
  }
}

/** Tokens of the item being played (for the live code display). */
export function currentItemTokens(mode: DrillMode): readonly Token[] {
  const r = runs.get(mode);
  const item = r?.items[r.index];
  return item ? tokenize(item.text).tokens : [];
}

export function sessionInProgress(mode: DrillMode): boolean {
  return runs.get(mode) !== undefined || state(mode).phase === "starting";
}
