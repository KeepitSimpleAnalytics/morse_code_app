import { audioEngine } from "../../audio/engine";
import { renderSamples } from "../../audio/offline-render";
import type { KeyingScheduler } from "../../audio/scheduler";
import { getScheduler as getSharedScheduler } from "../../audio/shared";
import { effectiveRiseMs } from "../../core/envelope";
import { buildTimeline, type TimelineElement } from "../../core/timeline";
import { computeTiming, type Timing } from "../../core/timing";
import { tokenize, type Token } from "../../core/tokenize";
import { encodeWav16 } from "../../core/wav";
import { usePlayerStore, type SourceRange } from "./store";
import { classifyEdit, tokenIndexAtOffset } from "./text-model";

/**
 * Connects the Text Player UI to the audio engine. One instance for the app.
 */

let scheduler: KeyingScheduler | null = null;

async function getScheduler(): Promise<KeyingScheduler> {
  scheduler = await getSharedScheduler();
  return scheduler;
}

const state = () => usePlayerStore.getState();

function applySound(): void {
  const s = state();
  audioEngine.setFrequency(s.toneHz);
  audioEngine.setVolume(s.volume);
}

function timingNow(): Timing {
  return computeTiming(state().speeds);
}

function fail(action: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  state().set({ error: `${action} failed: ${message}`, status: "idle", active: null });
}

/** Tokens for the current text, plus where playback should begin. */
function playbackPlan(fromToken: number | null): { tokens: Token[]; startIndex: number } | null {
  const { tokens } = tokenize(state().text);
  let startIndex = fromToken ?? tokenIndexAtOffset(tokens, state().startOffset ?? 0) ?? 0;
  while (tokens[startIndex]?.type === "gap") startIndex++;
  if (startIndex >= tokens.length) return null;
  return { tokens, startIndex };
}

let pausedAtToken: number | null = null;
let currentTokens: Token[] = [];

interface StartOptions {
  readonly leadInMs?: number;
  /** Where each loop repetition starts, if not where this playback starts. */
  readonly loopFrom?: number;
}

function startPlayback(fromToken: number | null, opts: StartOptions = {}): Promise<void> {
  return (async () => {
    const plan = playbackPlan(fromToken);
    if (!plan) {
      state().set({ notice: "Nothing to play: the text has no Morse characters.", status: "idle" });
      return;
    }
    const sched = await getScheduler();
    applySound();
    const { tokens, startIndex } = plan;
    const loopFrom = opts.loopFrom ?? startIndex;
    const { leadInMs } = opts;
    currentTokens = tokens;
    playingFrom = startIndex;
    loopOrigin = loopFrom;
    const elements: TimelineElement[] = buildTimeline(
      tokens.slice(startIndex),
      timingNow(),
      leadInMs === undefined ? {} : { leadIn: leadInMs },
    ).map((e) => ({ ...e, tokenIndex: e.tokenIndex + startIndex }));
    const rise = effectiveRiseMs(state().riseMs, elements);
    pausedAtToken = null;
    state().set({ status: "playing", error: null, notice: null });
    sched.play(elements, rise, {
      onToken: (i) => {
        const t = currentTokens[i];
        if (t) state().set({ active: { start: t.sourceStart, end: t.sourceEnd } });
        pausedAtToken = i;
      },
      onDone: () => {
        if (state().loop && state().status === "playing") {
          // Loop with a word gap between repetitions.
          void startPlayback(loopFrom, { leadInMs: timingNow().wordGap });
        } else {
          state().set({ status: "idle", active: null });
        }
      },
    });
  })().catch((err: unknown) => {
    fail("Playback", err);
  });
}

/* ---------------------------------------------------------------------------
 * Live speed change: a speed edit while playing restarts from the current
 * character at the new speed, once the slider settles.
 * ------------------------------------------------------------------------- */

export const SPEED_RESTART_DEBOUNCE_MS = 250;

let playingFrom = 0;
let loopOrigin = 0;
let speedRestart: ReturnType<typeof setTimeout> | null = null;

function cancelSpeedRestart(): void {
  if (speedRestart !== null) clearTimeout(speedRestart);
  speedRestart = null;
}

usePlayerStore.subscribe((s, prev) => {
  if (s.speeds === prev.speeds || s.status !== "playing") return;
  cancelSpeedRestart();
  speedRestart = setTimeout(() => {
    speedRestart = null;
    if (state().status !== "playing") return;
    // Same clean-stop path as Pause/Resume: the current character starts over.
    void startPlayback(pausedAtToken ?? playingFrom, {
      leadInMs: timingNow().charGap,
      loopFrom: loopOrigin,
    });
  }, SPEED_RESTART_DEBOUNCE_MS);
});

export function play(): Promise<void> {
  if (state().status === "paused") return startPlayback(pausedAtToken, { loopFrom: loopOrigin });
  return startPlayback(null);
}

export function pause(): void {
  if (state().status !== "playing" || !scheduler) return;
  cancelSpeedRestart();
  scheduler.stop();
  state().set({ status: "paused" });
}

export function stop(): void {
  cancelSpeedRestart();
  // The scheduler is shared: only silence it if the Player is the one using it.
  if (state().status !== "idle") scheduler?.stop();
  pausedAtToken = null;
  live.reset();
  state().set({ status: "idle", active: null, liveQueued: 0 });
}

/**
 * Hands the shared scheduler to another feature (Koch): stops playback and ends
 * type-to-transmit, so the Player never appends to a scheduler it no longer owns.
 */
export async function releaseAudio(): Promise<void> {
  if (state().liveMode) await setLiveMode(false);
  else stop();
}

export function togglePlayPause(): void {
  if (state().status === "playing") pause();
  else void play();
}

/** Sets the play-from point; stops any playback so the next Play starts there. */
export function setStartOffset(offset: number | null): void {
  if (state().status === "playing" || state().status === "paused") stop();
  state().set({ startOffset: offset });
}

/* ---------------------------------------------------------------------------
 * Type-to-transmit (live mode)
 * ------------------------------------------------------------------------- */

const live = {
  tokens: [] as SourceRange[],
  pendingWordGap: false,
  reset() {
    this.tokens = [];
    this.pendingWordGap = false;
  },
};

function updateQueued(): void {
  state().set({ liveQueued: scheduler?.pendingTokens() ?? 0 });
}

export async function setLiveMode(on: boolean): Promise<void> {
  stop();
  state().set({ liveMode: on, status: on ? "live" : "idle" });
  if (!on) return;
  try {
    const sched = await getScheduler();
    applySound();
    live.reset();
    sched.startLive(state().riseMs, {
      onToken: (id) => {
        const range = live.tokens[id];
        if (range) state().set({ active: range });
        updateQueued();
      },
    });
  } catch (err) {
    fail("Live mode", err);
    state().set({ liveMode: false });
  }
}

/** Live mode: called with the previous and new text on every edit. */
export function onLiveEdit(prev: string, next: string): void {
  if (!state().liveMode || state().status !== "live" || !scheduler) return;
  const edit = classifyEdit(prev, next);
  const timing = timingNow();

  if (edit.kind === "append") {
    if (/^\s/.test(edit.added)) live.pendingWordGap = true;
    const { tokens } = tokenize(edit.added);
    tokens.forEach((t) => {
      if (t.type === "gap") {
        live.pendingWordGap = true;
        return;
      }
      const elements = buildTimeline([t], timing, { leadIn: 0 });
      const rise = effectiveRiseMs(state().riseMs, elements);
      const id =
        live.tokens.push({ start: edit.at + t.sourceStart, end: edit.at + t.sourceEnd }) - 1;
      const gap = live.pendingWordGap ? timing.wordGap : timing.charGap;
      live.pendingWordGap = false;
      scheduler?.append(elements, id, gap, rise);
    });
    if (/\s$/.test(edit.added)) live.pendingWordGap = true;
  } else if (edit.kind === "truncate") {
    // Remove characters that haven't been sent yet, newest first. Sent ones stay sent.
    for (let id = live.tokens.length - 1; id >= 0; id--) {
      const range = live.tokens[id] as SourceRange;
      if (range.start < edit.from) break;
      if (!scheduler.removePending(id)) break;
      live.tokens.length = id;
    }
    live.pendingWordGap = /\s$/.test(next);
  }
  updateQueued();
}

/* ---------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

/** Renders the whole text to WAV bytes with the current Player settings. */
export async function renderWav(): Promise<Uint8Array> {
  const s = state();
  const { tokens } = tokenize(s.text);
  if (!tokens.some((t) => t.type === "char")) throw new Error("the text has no Morse characters");
  const elements = buildTimeline(tokens, computeTiming(s.speeds));
  const samples = await renderSamples(elements, {
    frequency: s.toneHz,
    volume: s.volume,
    riseMs: effectiveRiseMs(s.riseMs, elements),
  });
  return encodeWav16(samples);
}
