import { renderLengthSamples, synthesize, WAV_SAMPLE_RATE } from "../core/wav";
import type { TimelineElement } from "../core/timeline";
import { scheduleKeyDown } from "./keying";

export interface RenderOptions {
  readonly frequency: number;
  readonly volume: number;
  /** Already clamped with effectiveRiseMs. */
  readonly riseMs: number;
  readonly tailMs?: number;
  readonly sampleRate?: number;
}

type OfflineCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/**
 * Renders a timeline through an OfflineAudioContext with the same graph and keying
 * code as live playback (SPEC §5.9).
 */
export async function renderOffline(
  elements: readonly TimelineElement[],
  { frequency, volume, riseMs, tailMs = 100, sampleRate = WAV_SAMPLE_RATE }: RenderOptions,
  Ctor: OfflineCtor,
): Promise<Float32Array> {
  const length = renderLengthSamples(elements, tailMs, sampleRate);
  const ctx = new Ctor(1, length, sampleRate);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const keyGain = ctx.createGain();
  keyGain.gain.value = 0;
  const master = ctx.createGain();
  master.gain.value = volume;
  osc.connect(keyGain).connect(master).connect(ctx.destination);
  for (const el of elements) {
    if (el.on)
      scheduleKeyDown(keyGain.gain, el.start / 1000, (el.start + el.dur) / 1000, riseMs / 1000);
  }
  osc.start(0);
  const buffer = await ctx.startRendering();
  return buffer.getChannelData(0).slice();
}

/**
 * Renders a timeline to samples: through OfflineAudioContext when the platform has
 * one (always, in WebView2 and WKWebView), otherwise by direct synthesis.
 */
export async function renderSamples(
  elements: readonly TimelineElement[],
  opts: RenderOptions,
): Promise<Float32Array> {
  const Ctor = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext;
  if (Ctor) return renderOffline(elements, opts, Ctor);
  return synthesize(elements, opts);
}
