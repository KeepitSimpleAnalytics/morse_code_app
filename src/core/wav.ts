import { elementGainAt } from "./envelope";
import { timelineEnd, type TimelineElement } from "./timeline";

/**
 * WAV encoder (SPEC §5.9): mono, 16-bit PCM, 44.1 kHz.
 *
 * `synthesize` renders a timeline directly, with the same oscillator and envelope as
 * live audio. The app prefers rendering through OfflineAudioContext (src/audio); this
 * is the path for environments without it, and a test proves the two agree.
 */

export const WAV_SAMPLE_RATE = 44100;

export interface SynthOptions {
  readonly frequency: number;
  /** Master volume, 0–1. */
  readonly volume: number;
  /** Already clamped with effectiveRiseMs. */
  readonly riseMs: number;
  readonly sampleRate?: number;
  /** Silence after the last element, ms. */
  readonly tailMs?: number;
}

export function renderLengthSamples(
  elements: readonly TimelineElement[],
  tailMs: number,
  sampleRate: number,
): number {
  return Math.ceil(((timelineEnd(elements) + tailMs) / 1000) * sampleRate);
}

export function synthesize(
  elements: readonly TimelineElement[],
  { frequency, volume, riseMs, sampleRate = WAV_SAMPLE_RATE, tailMs = 100 }: SynthOptions,
): Float32Array {
  if (!(volume >= 0 && volume <= 1))
    throw new RangeError(`volume must be within 0–1, got ${volume}`);
  const out = new Float32Array(renderLengthSamples(elements, tailMs, sampleRate));
  const omega = (2 * Math.PI * frequency) / sampleRate;
  for (const el of elements) {
    if (!el.on) continue;
    const first = Math.max(0, Math.floor((el.start / 1000) * sampleRate));
    const last = Math.min(out.length, Math.ceil(((el.start + el.dur) / 1000) * sampleRate));
    for (let k = first; k < last; k++) {
      const tMs = (k / sampleRate) * 1000;
      // The oscillator runs continuously from t = 0, as it does live.
      out[k] = volume * elementGainAt(el, riseMs, tMs) * Math.sin(omega * k);
    }
  }
  return out;
}

/** Encodes float samples (−1…1) as a 16-bit mono PCM WAV file. */
export function encodeWav16(
  samples: Float32Array,
  sampleRate: number = WAV_SAMPLE_RATE,
): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return new Uint8Array(buf);
}

/** Suggested export filename: morse-<first-words>.wav (SPEC §7.8). */
export function wavFilename(text: string, maxWords = 3): string {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 0)
    .slice(0, maxWords);
  return words.length > 0 ? `morse-${words.join("-")}.wav` : "morse.wav";
}
