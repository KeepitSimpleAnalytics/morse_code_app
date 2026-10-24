import { audioEngine } from "../../audio/engine";
import type { KeyingScheduler } from "../../audio/scheduler";
import { currentScheduler, getScheduler } from "../../audio/shared";
import { parseCustomCharset } from "../../core/charset";
import { effectiveRiseMs } from "../../core/envelope";
import { createPicker, type Picker } from "../../core/generators/adaptive";
import {
  ICR_NEXT_DELAY_MS,
  icrChars,
  icrSummary,
  keyToChar,
  median,
  SINGLE_KEY_CHARS,
  TARGET_SAMPLE,
  targetTimeout,
  type IcrAttempt,
  type IcrRound,
} from "../../core/icr";
import { mulberry32, seedFromString } from "../../core/rng";
import { buildTimeline } from "../../core/timeline";
import { computeTiming, type Timing } from "../../core/timing";
import { tokenize } from "../../core/tokenize";
import { addNotice, errorText, requireProfile, requireStore } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { SettingsValues } from "../../state/settings-schema";
import { buildTrialRecord } from "../../storage/records";
import type { Store, TrialRecord } from "../../storage/store";
import { saveTrial } from "../copy/save";
import { loadWeights } from "../copy/weights";
import { learnedKochChars } from "../drill/modes";
import * as player from "../player/controller";
import { initialIcrState, useIcrStore, type IcrAnswer, type PausedBy } from "./store";

/**
 * Drives Instant Character Recognition (SPEC §7.2). One character plays; the
 * response time runs from the moment its sound ends, as heard (the audio
 * clock mapped through getOutputTimestamp), to the KeyboardEvent's timeStamp.
 * A key pressed while the character is still sounding counts as 0 ms (owner,
 * 2026-10-23); one pressed before it starts sounding is ignored. Each answer is one trial, written as soon as it is scored
 * (§9.4), and its response time feeds ewmaRt (§8.3).
 *
 * The epoch/ticket pattern is the same as Koch's: anything that cancels moves
 * the epoch on, and a stale action gives up after its await.
 */

const state = () => useIcrStore.getState();
const settings = (): SettingsValues => useSettings.getState().values;

/** Silence before each character, ms. Short, so the next one follows quickly. */
const LEAD_IN_MS = 120;
const TICKER_MS = 250;

let epoch = 0;
const ticket = (): number => ++epoch;
const stale = (t: number): boolean => t !== epoch;

function fail(action: string, err: unknown): void {
  state().set({ error: `${action} failed: ${errorText(err)}` });
}

/** A reason a round can't start, worded for the user. */
class SetupError extends Error {}

/* Character set and Target ------------------------------------------------- */

/** The ICR character set for the settings. Prosigns are left out (§7.2). */
export async function icrCharSet(
  store: Store,
  profileId: string,
  v: SettingsValues,
): Promise<{ chars: string[]; excluded: string[] }> {
  switch (v["icr.charset"]) {
    case "koch":
      return icrChars(await learnedKochChars(store, profileId, v));
    case "all":
      return icrChars(SINGLE_KEY_CHARS);
    case "custom":
      return icrChars(parseCustomCharset(v["icr.custom"]).chars);
  }
}

/** Median response time over the profile's most recent correct ICR answers, or null with none. */
export async function recentMedianMs(store: Store, profileId: string): Promise<number | null> {
  const times = (
    await store.queryCharEvents(profileId, {
      mode: "icr",
      outcome: "correct",
      withResponse: true,
      limit: TARGET_SAMPLE,
    })
  ).map((e) => e.responseMs as number);
  return times.length > 0 ? median(times) : null;
}

/** Loads the profile's median (for Target) and slowest characters, for the setup screen. */
export async function loadStats(): Promise<void> {
  const profileId = requireProfile().id;
  try {
    const db = requireStore();
    const medianMs = await recentMedianMs(db, profileId);
    const slowest = (await db.getCharStats(profileId))
      .flatMap((r) => (r.ewmaRt === null ? [] : [{ ch: r.ch, ewmaRt: r.ewmaRt }]))
      .sort((x, y) => y.ewmaRt - x.ewmaRt)
      .slice(0, 5);
    if (requireProfile().id === profileId) state().set({ medianMs, slowest });
  } catch (err) {
    fail("Loading your response times", err);
  }
}

/* Round ------------------------------------------------------------------- */

interface PendingAnswer {
  readonly record: TrialRecord;
  readonly attempt: IcrAttempt;
  /** Its time was estimated from output latency. */
  readonly estimated: boolean;
}

interface Running {
  sessionId: string;
  profileId: string;
  picker: Picker;
  timing: Timing;
  toneHz: number;
  charWpm: number;
  timeoutMs: number;
  targetMedianMs: number | null;
  round: IcrRound;
  tick: boolean;
  attempts: IcrAttempt[];
  /** Saved answers whose time was estimated from output latency. */
  estimated: number;
  /** The character being asked; kept across a pause so it is asked again. */
  current: string | null;
  /** performance.now() times at which the current character starts and stops sounding, as heard. */
  heardStartMs: number | null;
  heardEndMs: number | null;
  currentEstimated: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** A scored answer whose trial couldn't be saved, kept for a retry. */
  unsaved: (PendingAnswer & { error: string }) | null;
  /** The answer being saved, if any; resolves to whether it was saved. */
  saving: Promise<boolean> | null;
  activeMs: number;
  activeSince: number | null;
  /** finish() has sent the session's close, so a reset mustn't close it again. */
  closing: boolean;
  completed: boolean;
}

let run: Running | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function clearTimer(r: Running): void {
  if (r.timer !== null) clearTimeout(r.timer);
  r.timer = null;
}

function silence(): void {
  currentScheduler()?.stop();
}

function activeMsNow(r: Running): number {
  return r.activeMs + (r.activeSince === null ? 0 : Date.now() - r.activeSince);
}

function closeActive(r: Running): void {
  r.activeMs = activeMsNow(r);
  r.activeSince = null;
}

function roundOver(r: Running): boolean {
  return r.round.kind === "count"
    ? r.attempts.length >= r.round.count
    : activeMsNow(r) >= r.round.minutes * 60_000;
}

function startTicker(r: Running): void {
  stopTicker();
  if (r.round.kind !== "minutes") return;
  const total = r.round.minutes * 60_000;
  ticker = setInterval(() => {
    if (run === r) state().set({ remainingMs: Math.max(0, total - activeMsNow(r)) });
  }, TICKER_MS);
}

function stopTicker(): void {
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
}

async function takeAudio(): Promise<KeyingScheduler> {
  await player.releaseAudio();
  return await getScheduler();
}

function closeQuietly(sessionId: string, activeMs: number, what: string): void {
  requireStore()
    .endSession(sessionId, {
      endedAt: Date.now(),
      activeMs: Math.round(activeMs),
      completed: false,
    })
    .catch((err: unknown) => {
      addNotice(
        "warning",
        `${what} couldn't be closed (${errorText(err)}). It will be saved as incomplete when that profile next opens.`,
      );
    });
}

/** Starts a round. */
export async function start(): Promise<void> {
  const phase = state().phase;
  if (phase !== "idle" && phase !== "results") return;
  const t = ticket();
  state().set({
    ...initialIcrState,
    medianMs: state().medianMs,
    slowest: state().slowest,
    phase: "starting",
  });

  let sessionId: string | null = null;
  try {
    const db = requireStore();
    const profileId = requireProfile().id;
    const v = settings();
    const { chars, excluded } = await icrCharSet(db, profileId, v);
    if (stale(t)) return;
    if (chars.length < 2) {
      throw new SetupError(
        excluded.length > 0
          ? `Choose at least two characters. Prosigns (${excluded.join(" ")}) can't be answered with one key, so they're left out.`
          : "Choose at least two characters.",
      );
    }
    const weights = v["learning.adaptive"]
      ? await loadWeights(db, profileId, chars, "icr")
      : undefined;
    const medianMs = v["icr.target"] ? await recentMedianMs(db, profileId) : state().medianMs;
    if (stale(t)) return;
    const targetMedianMs = v["icr.target"] ? medianMs : null;
    const timeoutMs = v["icr.target"]
      ? targetTimeout(medianMs, v["icr.timeoutMs"])
      : v["icr.timeoutMs"];
    const round: IcrRound =
      v["icr.roundKind"] === "count"
        ? { kind: "count", count: v["icr.count"] }
        : { kind: "minutes", minutes: v["icr.minutes"] };

    const id = crypto.randomUUID();
    const seed = seedFromString(id);
    const sched = await takeAudio();
    if (stale(t)) return;
    await db.startSession({
      id,
      profileId,
      mode: "icr",
      startedAt: Date.now(),
      seed,
      settingsSnapshot: {
        charWpm: v["timing.speeds"].charWpm,
        effWpm: v["timing.speeds"].effWpm,
        toneHz: v["audio.toneHz"],
        charset: v["icr.charset"],
        chars,
        timeoutMs: v["icr.timeoutMs"],
        target: v["icr.target"],
        targetMedianMs,
        effectiveTimeoutMs: timeoutMs,
        round,
        adaptive: v["learning.adaptive"],
      },
    });
    sessionId = id;
    if (stale(t)) {
      await db.endSession(id, { endedAt: Date.now(), activeMs: 0, completed: false });
      return;
    }
    const r: Running = {
      sessionId: id,
      profileId,
      picker: createPicker(chars, mulberry32(seed), weights),
      timing: computeTiming({ ...v["timing.speeds"], wordSpacing: v["timing.wordSpacing"] }),
      toneHz: v["audio.toneHz"],
      charWpm: v["timing.speeds"].charWpm,
      timeoutMs,
      targetMedianMs,
      round,
      tick: v["icr.tick"],
      attempts: [],
      estimated: 0,
      current: null,
      heardStartMs: null,
      heardEndMs: null,
      currentEstimated: false,
      timer: null,
      unsaved: null,
      saving: null,
      activeMs: 0,
      activeSince: Date.now(),
      closing: false,
      completed: false,
    };
    run = r;
    state().set({
      timeoutMs,
      targetMedianMs,
      medianMs,
      total: round.kind === "count" ? round.count : null,
      remainingMs: round.kind === "minutes" ? round.minutes * 60_000 : null,
      ...(excluded.length > 0
        ? {
            notice: `Prosigns can't be answered with one key, so these are left out: ${excluded.join(" ")}`,
          }
        : {}),
    });
    startTicker(r);
    present(r, sched, t);
  } catch (err) {
    if (stale(t)) return;
    stopTicker();
    const r = run;
    run = null;
    state().set({ phase: "idle" });
    if (err instanceof SetupError) {
      state().set({ notice: err.message });
      return;
    }
    fail(sessionId ? "Starting the round" : "Starting the round (nothing was saved)", err);
    // The session row exists but the round never ran: close it as incomplete.
    if (sessionId) closeQuietly(sessionId, r?.activeMs ?? 0, "The round that didn't start");
  }
}

/** Plays the current character (drawing a new one if needed) and starts its timeout. */
function present(r: Running, sched: KeyingScheduler, t: number): void {
  r.current ??= r.picker.next();
  audioEngine.setFrequency(r.toneHz);
  audioEngine.setVolume(settings()["audio.volume"]);
  const elements = buildTimeline(tokenize(r.current).tokens, r.timing, { leadIn: LEAD_IN_MS });
  const on = elements.filter((e) => e.on);
  const first = on[0];
  const last = on[on.length - 1];
  if (!first || !last) throw new Error(`nothing to play for ${r.current}`);
  sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {});
  const end = sched.endTime();
  if (end === null) throw new Error(`nothing queued for ${r.current}`);
  const heard = audioEngine.heardAt(end);
  r.heardEndMs = heard.ms;
  r.heardStartMs = heard.ms - (last.start + last.dur - first.start);
  r.currentEstimated = heard.source === "latency";
  state().set({ phase: "listening", answer: null });
  clearTimer(r);
  r.timer = setTimeout(
    () => {
      r.timer = null;
      if (!stale(t) && run === r && state().phase === "listening") {
        void answer(r, null, r.timeoutMs);
      }
    },
    Math.max(0, heard.ms + r.timeoutMs - performance.now()),
  );
}

/**
 * A key press while listening (the screen's key handler). `timeStamp` is the
 * event's, on the performance.now() clock. Returns true if the key was taken:
 * an answer, or a character key pressed before the sound began, which is
 * ignored (a guess, not a recognition).
 */
export function onKey(key: string, timeStamp: number): boolean {
  const r = run;
  if (!r || state().phase !== "listening" || r.heardEndMs === null) return false;
  const ch = keyToChar(key);
  if (ch === null) return false;
  if (r.heardStartMs !== null && timeStamp < r.heardStartMs) return true;
  const elapsed = timeStamp - r.heardEndMs;
  if (elapsed >= r.timeoutMs) {
    // Landed after the deadline (the timer just hadn't fired yet): a timeout.
    void answer(r, null, r.timeoutMs);
    return true;
  }
  const early = elapsed < 0;
  if (early) silence();
  void answer(r, ch, early ? 0 : Math.round(elapsed));
  return true;
}

/**
 * Saves an answer. However the round moves on meanwhile (pause, stop), the
 * outcome lands on the run, so an answer is never dropped without saying so.
 */
function startSave(r: Running, pending: PendingAnswer): Promise<boolean> {
  const saving = saveTrial(pending.record).then(
    () => {
      r.attempts.push(pending.attempt);
      if (pending.estimated) r.estimated++;
      r.current = null;
      if (run === r) state().set({ answered: r.attempts.length });
      return true;
    },
    (err: unknown) => {
      r.unsaved = { ...pending, error: errorText(err) };
      return false;
    },
  );
  r.saving = saving;
  void saving.then(() => {
    if (r.saving === saving) r.saving = null;
  });
  return saving;
}

async function answer(r: Running, typed: string | null, responseMs: number): Promise<void> {
  const ch = r.current;
  if (!ch) return;
  clearTimer(r);
  const t = ticket();
  const attempt: IcrAttempt = { ch, typed, correct: typed === ch, responseMs };
  const shown: IcrAnswer = { ch, typed, correct: attempt.correct, responseMs };
  state().set({ phase: "feedback", answer: shown });

  const record = buildTrialRecord({
    id: crypto.randomUUID(),
    profileId: r.profileId,
    sessionId: r.sessionId,
    mode: "icr",
    idx: r.attempts.length,
    prompt: ch,
    response: typed ?? "",
    revealed: false,
    repeats: 0,
    responseMs,
    charWpm: r.charWpm,
    at: Date.now(),
  });
  // Saved while the feedback shows, so the next character isn't held up.
  const saving = startSave(r, { record, attempt, estimated: r.currentEstimated });
  const shownFor = attempt.correct ? showCorrect(r) : showWrong(r, ch, t);
  const saved = await saving;
  await shownFor;
  if (stale(t) || run !== r) return;
  if (!saved) {
    enterUnsaved(r);
    return;
  }
  await advance(r, t);
}

function enterUnsaved(r: Running): void {
  closeActive(r);
  stopTicker();
  state().set({
    phase: "unsaved",
    error: `Saving the answer failed: ${r.unsaved?.error ?? "unknown error"}`,
  });
}

function showCorrect(r: Running): Promise<void> {
  if (r.tick) {
    try {
      audioEngine.tick();
    } catch (err) {
      fail("The tick sound", err);
    }
  }
  return new Promise((resolve) => setTimeout(resolve, ICR_NEXT_DELAY_MS));
}

/** Wrong or too slow: the character replays once (shown large meanwhile), then a short pause. */
async function showWrong(r: Running, ch: string, t: number): Promise<void> {
  const poll: { id: ReturnType<typeof setInterval> | null } = { id: null };
  try {
    const sched = await takeAudio();
    if (stale(t) || run !== r) return;
    const elements = buildTimeline(tokenize(ch).tokens, r.timing, { leadIn: 250 });
    await new Promise<void>((resolve) => {
      // A cancel (pause, stop) silences the scheduler without onDone, so poll for it.
      poll.id = setInterval(() => {
        if (stale(t) || run !== r) resolve();
      }, 50);
      sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
        onDone: resolve,
      });
    });
  } catch (err) {
    if (!stale(t)) fail("Replaying the character", err);
  } finally {
    if (poll.id !== null) clearInterval(poll.id);
  }
  await new Promise((resolve) => setTimeout(resolve, ICR_NEXT_DELAY_MS));
}

/** The next character, or the end of the round. */
async function advance(r: Running, t: number): Promise<void> {
  if (roundOver(r)) {
    await finish(true);
    return;
  }
  try {
    const sched = await takeAudio();
    if (stale(t) || run !== r) return;
    present(r, sched, t);
  } catch (err) {
    if (stale(t)) return;
    clearTimer(r);
    closeActive(r);
    stopTicker();
    state().set({ phase: "paused", pausedBy: "error" });
    fail("Playing the next character", err);
  }
}

/** Retries an answer whose saving failed, then carries on. */
export async function retrySave(): Promise<void> {
  const r = run;
  const pending = r?.unsaved;
  if (!r || !pending || state().phase !== "unsaved") return;
  const t = ticket();
  r.unsaved = null;
  // "resuming" at once: a second click does nothing, and a pause takes effect.
  state().set({ phase: "resuming", error: null });
  const saved = await startSave(r, pending);
  if (stale(t) || run !== r) return;
  if (!saved) {
    enterUnsaved(r);
    return;
  }
  r.activeSince = Date.now();
  startTicker(r);
  await advance(r, t);
}

/* Pause and stop ---------------------------------------------------------- */

/**
 * Pauses: the window was hidden, the screen left, or a dialog or menu opened.
 * The character being asked isn't scored and is asked again on resume.
 */
export function pause(by: Exclude<PausedBy, "error">): void {
  const phase = state().phase;
  if (phase === "starting") {
    ticket();
    silence();
    state().set({
      phase: "idle",
      ...(by === "hidden"
        ? { notice: "The window was hidden while the round was starting, so it didn't start." }
        : {}),
    });
    return;
  }
  const r = run;
  if (!r || (phase !== "listening" && phase !== "feedback" && phase !== "resuming")) return;
  ticket();
  clearTimer(r);
  silence();
  closeActive(r);
  stopTicker();
  // An unanswered character is asked again. One in feedback is already scored,
  // and its save clears `current` when it lands.
  state().set({ phase: "paused", pausedBy: by, answer: null });
}

export async function resume(): Promise<void> {
  const r = run;
  if (!r || state().phase !== "paused") return;
  const t = ticket();
  state().set({ phase: "resuming", pausedBy: null, error: null });
  // A save started before the pause may still be finishing; its result decides what's next.
  if (r.saving) await r.saving;
  if (stale(t) || run !== r) return;
  if (r.unsaved) {
    enterUnsaved(r);
    return;
  }
  r.activeSince = Date.now();
  startTicker(r);
  await advance(r, t);
}

/** Stop (Esc): ends the round early. Answers so far stay saved and are summarized. */
export async function stop(): Promise<void> {
  const phase = state().phase;
  if (phase === "starting") {
    ticket();
    silence();
    state().set({ phase: "idle" });
    return;
  }
  const r = run;
  if (!r || phase === "closing" || phase === "results" || phase === "idle") return;
  if (phase === "unclosed") {
    resultsWithoutClosing();
    return;
  }
  const t = ticket();
  clearTimer(r);
  silence();
  stopTicker();
  closeActive(r);
  // "closing" at once, so nothing else acts while the last save lands.
  state().set({ phase: "closing", error: null });
  if (r.saving) await r.saving;
  if (stale(t) || run !== r) return;
  const lost = r.unsaved
    ? `One answer (${r.unsaved.attempt.ch}) couldn't be saved, so it isn't counted.`
    : null;
  r.unsaved = null;
  if (r.attempts.length > 0) {
    await finish(false);
    if (lost) state().set({ notice: lost });
    return;
  }
  run = null;
  state().set({
    ...initialIcrState,
    medianMs: state().medianMs,
    slowest: state().slowest,
    notice: [lost, "Stopped before any answers were saved, so nothing was scored."]
      .filter(Boolean)
      .join(" "),
  });
  try {
    await requireStore().endSession(r.sessionId, {
      endedAt: Date.now(),
      activeMs: Math.round(r.activeMs),
      completed: false,
    });
  } catch (err) {
    fail("Closing the round", err);
  }
}

/** Closes the session and shows the summary. Also retries a failed close. */
export async function finish(completed: boolean): Promise<void> {
  const r = run;
  if (!r) return;
  const t = ticket();
  clearTimer(r);
  closeActive(r);
  stopTicker();
  r.completed = completed;
  r.closing = true;
  state().set({ phase: "closing", error: null });
  try {
    await requireStore().endSession(r.sessionId, {
      endedAt: Date.now(),
      activeMs: Math.round(r.activeMs),
      completed,
    });
  } catch (err) {
    r.closing = false;
    if (stale(t)) return;
    state().set({ phase: "unclosed" });
    fail("Closing the round", err);
    return;
  }
  if (stale(t) || run !== r) return;
  showResults(r);
}

function showResults(r: Running): void {
  run = null;
  state().set({
    phase: "results",
    answer: null,
    result: {
      summary: icrSummary(r.attempts),
      completed: r.completed,
      timeoutMs: r.timeoutMs,
      targetMedianMs: r.targetMedianMs,
      estimated: r.estimated,
    },
  });
  void loadStats();
}

export function retryFinish(): Promise<void> {
  if (state().phase !== "unclosed" || !run) return Promise.resolve();
  return finish(run.completed);
}

/**
 * "Show results anyway" after closing failed. The answers are saved; the
 * session is closed as incomplete the next time the profile opens.
 */
export function resultsWithoutClosing(): void {
  const r = run;
  if (!r || state().phase !== "unclosed") return;
  ticket();
  showResults(r);
  state().set({
    error: null,
    notice:
      "Your answers are saved. The round couldn't be closed, so it will be marked incomplete the next time this profile opens.",
  });
}

export function dismissResults(): void {
  if (state().phase === "results") state().set({ phase: "idle", result: null });
}

/**
 * Drops a running round without scoring more (profile switch). Its session is
 * closed as incomplete, unless finish() has already closed it.
 */
export function resetIcr(): void {
  const r = run;
  const busy = r !== null || state().phase === "starting";
  ticket();
  if (busy) silence();
  stopTicker();
  if (r) {
    clearTimer(r);
    closeActive(r);
  }
  run = null;
  useIcrStore.setState({ ...initialIcrState });
  if (r && !r.closing) closeQuietly(r.sessionId, r.activeMs, "The unfinished ICR round");
}

export function roundInProgress(): boolean {
  return run !== null || state().phase === "starting";
}

/** The character being asked, or null. Never shown before it is answered; tests use it. */
export function currentChar(): string | null {
  return run?.current ?? null;
}
