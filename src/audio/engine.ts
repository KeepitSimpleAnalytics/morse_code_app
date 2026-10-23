import type { GainParam } from "./keying";

/**
 * The app's one AudioContext (SPEC §6, CLAUDE.md). Created lazily on the first user
 * gesture, resumed whenever needed, never closed while the app runs.
 *
 * Graph: OscillatorNode (sine, always running) → keyGain (keyed) → masterGain (volume)
 * → destination. The receiver filter, noise and QRM branches join in phase 9.
 */

export interface AudioGraph {
  readonly ctx: AudioContext;
  /** The keying gain. Only the scheduler writes to it. */
  readonly keyGain: GainParam;
}

export interface LatencyReport {
  readonly baseMs: number;
  readonly outputMs: number;
  readonly totalMs: number;
}

/** Above this, SPEC §6/§13 asks for a warning (and an issue on target OSes). */
export const LATENCY_WARN_MS = 40;

const PARAM_SMOOTHING_SEC = 0.01;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private keyGain: GainNode | null = null;
  private master: GainNode | null = null;
  private frequency = 600;
  private volume = 0.7;
  private created = 0;

  constructor(
    private readonly createContext: () => AudioContext = () =>
      new AudioContext({ latencyHint: "interactive" }),
  ) {}

  /** Number of AudioContexts ever created. Stays at 1 for the life of the app. */
  get contextsCreated(): number {
    return this.created;
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Creates the graph on first call and resumes a suspended context. Call from a user gesture. */
  async start(): Promise<AudioGraph> {
    if (!this.ctx) {
      const ctx = this.createContext();
      this.created++;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = this.frequency;
      const keyGain = ctx.createGain();
      keyGain.gain.value = 0;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      osc.connect(keyGain).connect(master).connect(ctx.destination);
      osc.start();
      this.ctx = ctx;
      this.osc = osc;
      this.keyGain = keyGain;
      this.master = master;
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    return { ctx: this.ctx, keyGain: (this.keyGain as GainNode).gain };
  }

  setFrequency(hz: number): void {
    if (!Number.isFinite(hz) || hz <= 0)
      throw new RangeError(`frequency must be positive, got ${hz}`);
    this.frequency = hz;
    if (this.ctx && this.osc) {
      this.osc.frequency.setTargetAtTime(hz, this.ctx.currentTime, PARAM_SMOOTHING_SEC);
    }
  }

  setVolume(volume: number): void {
    if (!(volume >= 0 && volume <= 1))
      throw new RangeError(`volume must be within 0–1, got ${volume}`);
    this.volume = volume;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, PARAM_SMOOTHING_SEC);
    }
  }

  /** ctx.baseLatency + ctx.outputLatency (SPEC §6), or null before the first gesture. */
  latency(): LatencyReport | null {
    if (!this.ctx) return null;
    const baseMs = (this.ctx.baseLatency || 0) * 1000;
    const outputMs = (this.ctx.outputLatency || 0) * 1000;
    return { baseMs, outputMs, totalMs: baseMs + outputMs };
  }

  /** Output latency in seconds, used to align highlighting with what is heard. */
  outputLatencySec(): number {
    return this.ctx?.outputLatency ?? 0;
  }
}

/** The app-wide engine. */
export const audioEngine = new AudioEngine();
