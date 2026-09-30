// SPDX-License-Identifier: MIT
/**
 * White, pink and brown noise, made when a noise is first played.
 *
 * Noise is cheaper to compute than to ship: ten seconds take a few milliseconds
 * here and would take close to a megabyte as a file, with no codec that treats
 * noise kindly. Seeded, so every run makes the same loop.
 *
 * Loudness is matched the way it is heard, not by RMS — white noise at the RMS
 * of brown sounds several LU louder. Each loop is brought to TARGET_LUFS
 * (ITU-R BS.1770 K-weighting), the target buildSounds.mts uses for the
 * recordings. The loop is mono and plays on both speakers, so it is measured as
 * that dual-mono pair.
 */

export type NoiseColor = "white" | "pink" | "brown";

/** Generated at this rate whatever the device runs at; Web Audio resamples. */
export const NOISE_RATE = 48_000;
export const NOISE_SECONDS = 10;
const FADE = Math.round(NOISE_RATE * 0.5);
const TARGET_LUFS = -23;

/** BS.1770 K-weighting at 48 kHz: high shelf, then the RLB high-pass. */
const K_WEIGHTING = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
] as const;

/** Loudness of a mono signal played on two speakers, in LUFS (no gating: noise is stationary). */
export function dualMonoLoudness(samples: ArrayLike<number>): number {
  let signal: ArrayLike<number> = samples;
  for (const { b, a } of K_WEIGHTING) {
    const out = new Float64Array(signal.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < signal.length; i += 1) {
      const x = signal[i]!;
      const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    signal = out;
  }
  let power = 0;
  for (let i = 0; i < signal.length; i += 1) power += signal[i]! * signal[i]!;
  return -0.691 + 10 * Math.log10((2 * power) / signal.length);
}

/** mulberry32: small, fast, seedable; uniform in [-1, 1). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Paul Kellet's refined pink filter (-3 dB/octave). */
function pink(next: () => number): () => number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  return () => {
    const w = next();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out;
  };
}

/** Leaky integrator (-6 dB/octave); the leak keeps it from drifting off. */
function brown(next: () => number): () => number {
  let last = 0;
  return () => {
    last = (last + 0.02 * next()) / 1.02;
    return last;
  };
}

const SOURCES: Record<NoiseColor, () => () => number> = {
  white: () => random(1),
  pink: () => pink(random(2)),
  brown: () => brown(random(3)),
};

/**
 * One loop of the given noise: NOISE_SECONDS at NOISE_RATE, mono.
 * The seconds past the end fade out over the start, which fades in, so the
 * seam is as continuous as the rest.
 */
export function noiseLoop(color: NoiseColor): Float32Array {
  const next = SOURCES[color]();
  const length = NOISE_RATE * NOISE_SECONDS;
  const raw = new Float64Array(length + FADE);
  for (let i = 0; i < raw.length; i += 1) raw[i] = next();

  const loop = raw.slice(0, length);
  for (let i = 0; i < FADE; i += 1) {
    const t = i / FADE;
    loop[i] = raw[i]! * Math.sqrt(t) + raw[length + i]! * Math.sqrt(1 - t);
  }

  let mean = 0;
  for (let i = 0; i < length; i += 1) mean += loop[i]!;
  mean /= length;
  for (let i = 0; i < length; i += 1) loop[i]! -= mean;

  const gain = 10 ** ((TARGET_LUFS - dualMonoLoudness(loop)) / 20);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.max(-1, Math.min(1, loop[i]! * gain));
  return out;
}
