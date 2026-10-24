import { audioEngine } from "../../audio/engine";
import { currentScheduler, getScheduler } from "../../audio/shared";
import type { KeyingScheduler } from "../../audio/scheduler";
import { adaptiveWeights, type CharStat } from "../../core/adaptive";
import { effectiveRiseMs } from "../../core/envelope";
import {
  kochChars,
  kochOrder,
  maxKochLevel,
  newestKochChar,
  type KochOrder,
} from "../../core/koch";
import {
  audioMsOfGroups,
  groupOfToken,
  lessonOutcome,
  MIN_PASSING_AUDIO_MS,
  planLesson,
  playedGroups,
  suggestStepBack,
  weakestChars,
  type LessonLength,
  type LessonPlan,
} from "../../core/lesson";
import { seedFromString } from "../../core/rng";
import { charsPerMinute, scoreTrial } from "../../core/scoring";
import { buildTimeline, type TimelineElement } from "../../core/timeline";
import { computeTiming, type Timing } from "../../core/timing";
import { tokenize, type Token } from "../../core/tokenize";
import { addNotice, errorText, requireProfile, requireStore, useApp } from "../../state/app";
import { useSettings } from "../../state/settings";
import type { SettingsValues } from "../../state/settings-schema";
import { buildTrialRecord } from "../../storage/records";
import type { LevelReason, Session } from "../../storage/schemas";
import type { TrialRecord } from "../../storage/store";
import * as player from "../player/controller";
import { initialKochState, useKochStore, type LessonResult, type LevelInfo } from "./store";

/**
 * Drives Koch Lessons (SPEC §7.1): copy-as-you-go lessons scored over the whole
 * text, written as one trial the moment they are scored (§9.4), then the pass,
 * advance and step-back decisions.
 *
 * Every action that awaits takes a ticket from `epoch` first. Anything that
 * cancels (pause, stop, leaving the screen, a profile switch, a newer action)
 * moves `epoch` on, and the awaiting action checks its ticket after each await
 * and gives up if it is stale. So a double click, or leaving the screen while
 * audio is starting, can't leave a second lesson or stray audio running.
 */

const state = () => useKochStore.getState();
const settings = (): SettingsValues => useSettings.getState().values;

/** Lead-in when resuming after a pause, ms. */
const RESUME_LEAD_IN_MS = 1000;
const TICK_MS = 250;

let epoch = 0;
const ticket = (): number => ++epoch;
const stale = (t: number): boolean => t !== epoch;

function fail(action: string, err: unknown): void {
  state().set({ error: `${action} failed: ${errorText(err)}` });
}

function currentOrder(): KochOrder {
  return kochOrder(settings()["learning.kochOrder"]);
}

function trainingTiming(): Timing {
  const v = settings();
  return computeTiming({ ...v["timing.speeds"], wordSpacing: v["timing.wordSpacing"] });
}

function applySound(toneHz: number): void {
  audioEngine.setFrequency(toneHz);
  audioEngine.setVolume(settings()["audio.volume"]);
}

interface Snapshot {
  kochOrder?: unknown;
  kochLevel?: unknown;
  audioMs?: unknown;
}
const snapshotOf = (s: Session) => s.settingsSnapshot as Snapshot;

/**
 * Completed Koch lessons at a level and order that could count towards passing
 * (at least a minute of audio), newest first.
 */
async function lessonsAt(profileId: string, orderId: string, level: number): Promise<Session[]> {
  const sessions = await requireStore().listSessions(profileId);
  return sessions.filter((s) => {
    const snap = snapshotOf(s);
    return (
      s.mode === "koch" &&
      s.completed &&
      s.accuracy !== null &&
      snap.kochOrder === orderId &&
      snap.kochLevel === level &&
      typeof snap.audioMs === "number" &&
      snap.audioMs >= MIN_PASSING_AUDIO_MS
    );
  });
}

/* Level ------------------------------------------------------------------- */

let loadSeq = 0;

/** Loads the current level, character stats and lesson history for the active order. */
export async function loadLevel(): Promise<void> {
  const seq = ++loadSeq;
  try {
    const store = requireStore();
    const profileId = requireProfile().id;
    const order = currentOrder();
    const progress = await store.getKochProgress(profileId);
    const saved = progress.find((p) => p.orderId === order.id)?.level ?? 1;
    const level = Math.min(saved, maxKochLevel(order));
    const statRows = await store.getCharStats(profileId);
    const lessons = await lessonsAt(profileId, order.id, level);
    // A newer load, a profile switch or an order change makes this one stale.
    if (
      seq !== loadSeq ||
      useApp.getState().current?.id !== profileId ||
      currentOrder().id !== order.id
    ) {
      return;
    }
    const info: LevelInfo = {
      orderId: order.id,
      level,
      maxLevel: maxKochLevel(order),
      chars: kochChars(order, level),
      stats: Object.fromEntries(statRows.map((r) => [r.ch, r])),
      lessons: lessons.length,
      bestAccuracy: lessons.length > 0 ? Math.max(...lessons.map((s) => s.accuracy ?? 0)) : null,
    };
    state().set({ info, ...(state().phase === "loading" ? { phase: "idle" } : {}) });
  } catch (err) {
    if (seq === loadSeq) fail("Loading your Koch level", err);
  }
}

async function changeLevel(level: number, reason: LevelReason, order: KochOrder): Promise<void> {
  await requireStore().setKochLevel(requireProfile().id, order.id, level, reason, Date.now());
  await loadLevel();
}

/** The level card's "Jump to level". Progress history is kept. */
export async function jumpToLevel(level: number): Promise<void> {
  try {
    await changeLevel(level, "manual", currentOrder());
    state().set({ phase: "idle", result: null });
  } catch (err) {
    fail("Changing level", err);
  }
}

/* Audio hand-over --------------------------------------------------------- */

/** Takes the shared scheduler from the Text Player (ending its live mode), then starts audio. */
async function takeAudio(): Promise<KeyingScheduler> {
  await player.releaseAudio();
  return await getScheduler();
}

/** Silences anything Koch started, without touching lesson state. */
function silence(): void {
  currentScheduler()?.stop();
}

/* New-character intro ----------------------------------------------------- */

function introChars(order: KochOrder, level: number): string[] {
  return level === 1 ? [...kochChars(order, 1)] : [newestKochChar(order, level)];
}

/** True when this level's new character hasn't been introduced yet. */
export function introDue(): boolean {
  const info = state().info;
  if (!info) return false;
  return (settings()["koch.introSeen"][info.orderId] ?? 0) < info.level;
}

function markIntroSeen(): void {
  const info = state().info;
  if (!info) return;
  const seen = settings()["koch.introSeen"];
  if ((seen[info.orderId] ?? 0) >= info.level) return;
  useSettings.getState().set("koch.introSeen", { ...seen, [info.orderId]: info.level });
}

/** Opens the intro for the current level and plays its first character. */
export function openIntro(): Promise<void> {
  const info = state().info;
  const phase = state().phase;
  if (!info || (phase !== "idle" && phase !== "results")) return Promise.resolve();
  stopReplay();
  state().set({
    phase: "intro",
    intro: { chars: introChars(currentOrder(), info.level), index: 0, playing: false },
    error: null,
  });
  return playIntro(0);
}

/** Plays one intro character three times. Then moves on to the next one, if any. */
export async function playIntro(index: number): Promise<void> {
  const intro = state().intro;
  const ch = intro?.chars[index];
  if (state().phase !== "intro" || !intro || ch === undefined) return;
  const t = ticket();
  state().set({ intro: { ...intro, index, playing: true } });
  try {
    const sched = await takeAudio();
    if (stale(t)) return;
    applySound(settings()["audio.toneHz"]);
    const elements = buildTimeline(tokenize(`${ch} ${ch} ${ch}`).tokens, trainingTiming(), {
      leadIn: 300,
    });
    sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
      onDone: () => {
        const cur = state().intro;
        if (stale(t) || !cur || state().phase !== "intro") return;
        if (index + 1 < cur.chars.length) void playIntro(index + 1);
        else state().set({ intro: { ...cur, playing: false } });
      },
    });
  } catch (err) {
    if (stale(t)) return;
    const cur = state().intro;
    if (cur) state().set({ intro: { ...cur, playing: false } });
    fail("Playing the intro", err);
  }
}

/** Ends the intro (played or skipped); it won't show again for this level. */
export function closeIntro(): void {
  if (state().phase !== "intro") return;
  ticket();
  if (state().intro?.playing) silence();
  markIntroSeen();
  state().set({ phase: "idle", intro: null });
}

/* Lesson ------------------------------------------------------------------ */

interface Running {
  sessionId: string;
  profileId: string;
  plan: LessonPlan;
  /** The order, level, timing and tone the lesson was planned with (settings may change). */
  order: KochOrder;
  level: number;
  timing: Timing;
  toneHz: number;
  charWpm: number;
  /** Highest token heard so far. */
  maxHeard: number | null;
  /** Lesson time (ms from the start of the lead-in) at the start of this segment. */
  segOffsetMs: number;
  /** Date.now() when the current segment started playing, or null while not playing. */
  segStartedAt: number | null;
  activeMs: number;
  /** Total lesson time, lead-in included. */
  totalMs: number;
  /** Saving steps already done, so a retry after a failure never writes twice. */
  trialSaved: boolean;
  sessionClosed: boolean;
}

let run: Running | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function stopTicker(): void {
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
}

function tick(): void {
  const startedAt = run?.segStartedAt;
  if (!run || startedAt == null) return;
  const pos = run.segOffsetMs + (Date.now() - startedAt);
  state().set({ remainingMs: Math.max(0, run.totalMs - pos) });
}

/** Closes the current playing segment, adding its time to active time. */
function closeSegment(): void {
  stopTicker();
  const startedAt = run?.segStartedAt;
  if (!run || startedAt == null) return;
  const played = Date.now() - startedAt;
  run.activeMs += played;
  run.segOffsetMs += played;
  run.segStartedAt = null;
}

function lessonLength(v: SettingsValues): LessonLength {
  return v["koch.lengthKind"] === "minutes"
    ? { kind: "minutes", minutes: v["koch.minutes"] }
    : { kind: "groups", count: v["koch.groups"] };
}

/** Starts a lesson, or the intro first if this level's new character hasn't had one. */
export async function startLesson(): Promise<void> {
  const phase = state().phase;
  if (phase !== "idle" && phase !== "results") return;
  if (introDue()) {
    await openIntro();
    return;
  }
  await beginLesson();
}

/** Starts a lesson now, skipping the intro check (the intro's "Start lesson"). */
export async function beginLesson(): Promise<void> {
  const info = state().info;
  const phase = state().phase;
  if (!info || (phase !== "idle" && phase !== "results" && phase !== "intro")) return;
  if (phase === "intro") markIntroSeen();
  stopReplay();
  const t = ticket();
  if (phase === "intro") silence();
  state().set({
    phase: "starting",
    intro: null,
    typed: "",
    result: null,
    error: null,
    notice: null,
    remainingMs: 0,
  });

  let sessionId: string | null = null;
  try {
    const store = requireStore();
    const profileId = requireProfile().id;
    const v = settings();
    const order = currentOrder();
    const timing = trainingTiming();
    const id = crypto.randomUUID();
    const seed = seedFromString(id);

    let weights: Map<string, number> | undefined;
    if (v["learning.adaptive"]) {
      const recent = await store.listSessions(profileId, 3);
      if (stale(t)) return;
      const stats = new Map<string, CharStat>(
        Object.values(info.stats).map((r) => [r.ch, r] as const),
      );
      weights = adaptiveWeights(info.chars, stats, {
        mode: "copy",
        recentSessionsSince: recent.length >= 3 ? (recent[2]?.startedAt ?? null) : null,
      });
    }
    const plan = planLesson({
      seed,
      order,
      level: info.level,
      length: lessonLength(v),
      groupSize: v["koch.groupSize"],
      timing,
      newestWeight: v["learning.newestWeight"],
      ...(weights ? { weights } : {}),
    });

    const sched = await takeAudio();
    if (stale(t)) return;
    await store.startSession({
      id,
      profileId,
      mode: "koch",
      startedAt: Date.now(),
      seed,
      settingsSnapshot: {
        charWpm: v["timing.speeds"].charWpm,
        effWpm: v["timing.speeds"].effWpm,
        wordSpacing: v["timing.wordSpacing"],
        toneHz: v["audio.toneHz"],
        kochOrder: order.id,
        kochLevel: info.level,
        length: lessonLength(v),
        groupSize: v["koch.groupSize"],
        adaptive: v["learning.adaptive"],
        newestWeight: v["learning.newestWeight"],
        audioMs: plan.audioMs,
      },
    });
    sessionId = id;
    if (stale(t)) {
      // Cancelled while the session was being created: close it as incomplete.
      await store.endSession(id, { endedAt: Date.now(), activeMs: 0, completed: false });
      return;
    }
    const last = plan.elements[plan.elements.length - 1];
    run = {
      sessionId: id,
      profileId,
      plan,
      order,
      level: info.level,
      timing,
      toneHz: v["audio.toneHz"],
      charWpm: v["timing.speeds"].charWpm,
      maxHeard: null,
      segOffsetMs: 0,
      segStartedAt: null,
      activeMs: 0,
      totalMs: last ? last.start + last.dur : 0,
      trialSaved: false,
      sessionClosed: false,
    };
    applySound(run.toneHz);
    state().set({
      phase: "playing",
      pausedBy: null,
      heardToken: null,
      remainingMs: run.totalMs,
    });
    playSegment(sched, plan.elements, 0, t);
  } catch (err) {
    if (stale(t)) return;
    run = null;
    state().set({ phase: "idle" });
    fail(sessionId ? "Starting the lesson" : "Starting the lesson (nothing was saved)", err);
  }
}

function playSegment(
  sched: KeyingScheduler,
  elements: readonly TimelineElement[],
  offsetMs: number,
  t: number,
): void {
  const r = run;
  if (!r) return;
  r.segOffsetMs = offsetMs;
  r.segStartedAt = Date.now();
  stopTicker();
  ticker = setInterval(tick, TICK_MS);
  sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
    onToken: (i) => {
      if (stale(t) || run !== r) return;
      r.maxHeard = Math.max(r.maxHeard ?? i, i);
      state().set({ heardToken: i });
    },
    onDone: () => {
      if (stale(t) || run !== r) return;
      closeSegment();
      state().set({ phase: "finishing", remainingMs: 0, heardToken: null });
    },
  });
}

/**
 * Pauses a lesson. While it is starting, leaving cancels the start instead.
 * Resuming replays the group that was cut off.
 */
export function pauseLesson(by: "user" | "hidden" | "left" = "user"): void {
  const phase = state().phase;
  if (phase === "starting") {
    ticket();
    silence();
    state().set({ phase: "idle" });
    return;
  }
  if ((phase !== "playing" && phase !== "resuming") || !run) return;
  ticket();
  silence();
  closeSegment();
  state().set({ phase: "paused", pausedBy: by, heardToken: null });
}

export async function resumeLesson(): Promise<void> {
  const r = run;
  if (state().phase !== "paused" || !r) return;
  const t = ticket();
  state().set({ phase: "resuming", pausedBy: null, error: null });
  try {
    const sched = await takeAudio();
    if (stale(t) || run !== r) return;
    applySound(r.toneHz);
    const { plan } = r;
    const group = r.maxHeard === null ? 0 : groupOfToken(plan, r.maxHeard);
    const firstToken = group === 0 ? 0 : (plan.groupEndTokens[group - 1] as number) + 2;
    const firstStart = plan.elements.find((e) => e.tokenIndex === firstToken)?.start ?? 0;
    // The lesson's own timing, so the timer and the snapshot stay true.
    const elements = buildTimeline(plan.tokens.slice(firstToken), r.timing, {
      leadIn: RESUME_LEAD_IN_MS,
    }).map((e) => ({ ...e, tokenIndex: e.tokenIndex + firstToken }));
    state().set({ phase: "playing" });
    playSegment(sched, elements, Math.max(0, firstStart - RESUME_LEAD_IN_MS), t);
  } catch (err) {
    if (stale(t)) return;
    state().set({ phase: "paused", pausedBy: "user" });
    fail("Resuming the lesson", err);
  }
}

/** Stops a lesson early. What was played is scored, but the lesson can't pass. */
export async function stopLesson(): Promise<void> {
  const phase = state().phase;
  if (phase === "starting") {
    pauseLesson("user");
    return;
  }
  if ((phase !== "playing" && phase !== "paused" && phase !== "resuming") || !run) return;
  ticket();
  silence();
  closeSegment();
  const r = run;
  const groups = playedGroups(r.plan, r.maxHeard);
  if (groups.length === 0) {
    run = null;
    state().set({
      phase: "idle",
      typed: "",
      heardToken: null,
      notice: "The lesson was stopped before any characters were sent, so nothing was scored.",
    });
    try {
      await requireStore().endSession(r.sessionId, {
        endedAt: Date.now(),
        activeMs: Math.round(r.activeMs),
        completed: false,
      });
    } catch (err) {
      fail("Saving the stopped lesson", err);
    }
    return;
  }
  await scoreLesson(groups.join(" "), audioMsOfGroups(r.plan, groups.length), false);
}

/** Scores a lesson that played to the end. Also retries a lesson whose saving failed. */
export async function finishLesson(): Promise<void> {
  if (state().phase !== "finishing" || !run) return;
  await scoreLesson(run.plan.text, run.plan.audioMs, true);
}

/** Retries saving a stopped lesson after a failure. */
export async function retryStopped(): Promise<void> {
  if (state().phase !== "unsaved" || !run) return;
  const groups = playedGroups(run.plan, run.maxHeard);
  await scoreLesson(groups.join(" "), audioMsOfGroups(run.plan, groups.length), false);
}

async function scoreLesson(prompt: string, audioMs: number, completed: boolean): Promise<void> {
  const r = run;
  if (!r) return;
  const t = ticket();
  const response = state().typed;
  state().set({ phase: "scoring", error: null });
  const store = requireStore();

  // 1. Save: the trial in one transaction (§9.4), then close the session.
  // Each step is remembered, so retrying after a failure never writes twice.
  try {
    const at = Date.now();
    if (!r.trialSaved) {
      const record: TrialRecord = buildTrialRecord({
        id: crypto.randomUUID(),
        profileId: r.profileId,
        sessionId: r.sessionId,
        mode: "koch",
        idx: 0,
        prompt,
        response,
        revealed: false,
        repeats: 0,
        responseMs: null,
        charWpm: r.charWpm,
        at,
      });
      await store.recordTrial(record);
      r.trialSaved = true;
    }
    if (!r.sessionClosed) {
      await store.endSession(r.sessionId, {
        endedAt: at,
        activeMs: Math.round(r.activeMs),
        completed,
      });
      r.sessionClosed = true;
    }
  } catch (err) {
    if (stale(t)) return;
    // The typed text is kept and the button stays, so saving can be tried again.
    state().set({ phase: completed ? "finishing" : "unsaved" });
    fail("Saving the lesson", err);
    return;
  }
  if (stale(t) || run !== r) return;
  run = null;

  // 2. The lesson is saved. Work out the result; a failure here is reported
  // on the results screen and never sends the user back.
  const v = settings();
  const score = scoreTrial(prompt, response);
  const { order } = r;
  const outcome = lessonOutcome({
    accuracy: score.accuracy,
    audioMs,
    completed,
    threshold: v["learning.passThreshold"],
    order,
    level: r.level,
  });
  const result: LessonResult = {
    orderId: order.id,
    level: r.level,
    prompt,
    response,
    score,
    audioMs,
    cpm: audioMs > 0 ? charsPerMinute(score.correct, audioMs) : 0,
    weak: weakestChars(score.chars),
    outcome,
    completed,
    autoAdvanced: false,
    suggestStepBack: false,
    decision: null,
  };
  state().set({ phase: "results", heardToken: null, result });

  try {
    if (outcome.passed && outcome.nextChar !== null && v["learning.advancement"] === "auto") {
      await changeLevel(r.level + 1, "passed", order);
      patchResult({ autoAdvanced: true, decision: "advanced" });
    } else if (!outcome.passed && outcome.notCounted === null) {
      const history = await store.getKochHistory(r.profileId);
      const reached = history.filter((h) => h.orderId === order.id).pop()?.reachedAt ?? 0;
      const recent = (await lessonsAt(r.profileId, order.id, r.level)).filter(
        (s) => s.startedAt >= reached,
      );
      patchResult({
        suggestStepBack: suggestStepBack(
          recent.map((s) => s.accuracy ?? 0),
          v["learning.regressionFloor"],
          r.level,
        ),
      });
      await loadLevel();
    } else {
      await loadLevel();
    }
  } catch (err) {
    fail("The lesson was saved, but updating your level", err);
  }
}

function patchResult(patch: Partial<LessonResult>): void {
  const result = state().result;
  if (result) state().set({ result: { ...result, ...patch } });
}

/** Results → "Add R" after a pass. */
export async function advance(): Promise<void> {
  const result = state().result;
  if (!result?.outcome.passed || result.decision || result.outcome.nextChar === null) return;
  try {
    await changeLevel(result.level + 1, "passed", kochOrder(result.orderId));
    patchResult({ decision: "advanced" });
  } catch (err) {
    fail("Advancing", err);
  }
}

export function stay(): void {
  const result = state().result;
  if (result && !result.decision) patchResult({ decision: "stayed" });
}

/** Results → step back one level after three weak lessons. Never automatic. */
export async function stepBack(): Promise<void> {
  const result = state().result;
  if (!result?.suggestStepBack || result.decision || result.level <= 1) return;
  try {
    await changeLevel(result.level - 1, "regressed", kochOrder(result.orderId));
    patchResult({ decision: "steppedBack" });
  } catch (err) {
    fail("Stepping back", err);
  }
}

/* Replay with text shown -------------------------------------------------- */

export async function replayWithText(): Promise<void> {
  const result = state().result;
  if (!result || state().phase !== "results" || state().replaying) return;
  const t = ticket();
  state().set({ replaying: true, replayToken: null });
  try {
    const sched = await takeAudio();
    if (stale(t)) return;
    applySound(settings()["audio.toneHz"]);
    const elements = buildTimeline(tokenize(result.prompt).tokens, trainingTiming(), {
      leadIn: 300,
    });
    sched.play(elements, effectiveRiseMs(settings()["audio.riseMs"], elements), {
      onToken: (i) => {
        if (!stale(t)) state().set({ replayToken: i });
      },
      onDone: () => {
        if (!stale(t)) state().set({ replaying: false, replayToken: null });
      },
    });
  } catch (err) {
    if (stale(t)) return;
    state().set({ replaying: false, replayToken: null });
    fail("Replay", err);
  }
}

export function stopReplay(): void {
  if (!state().replaying) return;
  ticket();
  silence();
  state().set({ replaying: false, replayToken: null });
}

/* Lifecycle --------------------------------------------------------------- */

/** Back to the start screen from results. */
export function dismissResults(): void {
  stopReplay();
  if (state().phase === "results") state().set({ phase: "idle", result: null });
}

/**
 * Drops any running lesson without scoring it (profile switch). Its session is
 * closed as incomplete; if that write fails, the next launch closes it.
 */
export function resetKoch(): void {
  const r = run;
  const busy =
    r !== null ||
    state().phase === "starting" ||
    state().intro?.playing === true ||
    state().replaying;
  ticket();
  if (busy) silence();
  stopTicker();
  run = null;
  loadSeq++;
  state().set({ ...initialKochState });
  if (r && !r.sessionClosed) {
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
          `The unfinished lesson couldn't be closed (${errorText(err)}). It will be saved as incomplete when that profile next opens.`,
        );
      });
  }
}

/** Tokens of the lesson being played (for the live code display). */
export function currentPromptTokens(): readonly Token[] {
  return run?.plan.tokens ?? [];
}

/** True while a lesson is under way (starting, playing, paused or waiting to be scored). */
export function lessonInProgress(): boolean {
  return run !== null || state().phase === "starting";
}
