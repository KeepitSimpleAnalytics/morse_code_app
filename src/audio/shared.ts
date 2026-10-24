import { audioEngine } from "./engine";
import { browserTimers, KeyingScheduler } from "./scheduler";

/**
 * The one keying scheduler on the shared AudioContext (SPEC §6). Every feature
 * that plays Morse uses it, so two features can never key the tone at once:
 * starting playback in one replaces whatever the other queued.
 */

let scheduler: KeyingScheduler | null = null;

/** Starts (or resumes) audio and returns the shared scheduler. Call from a user gesture. */
export async function getScheduler(): Promise<KeyingScheduler> {
  const graph = await audioEngine.start();
  scheduler ??= new KeyingScheduler({
    clock: graph.ctx,
    param: graph.keyGain,
    timers: browserTimers,
    outputLatencySec: () => audioEngine.outputLatencySec(),
  });
  return scheduler;
}

/** The scheduler if audio has started, without starting it. */
export function currentScheduler(): KeyingScheduler | null {
  return scheduler;
}
