/**
 * The generated noise is what the recordings are levelled against.
 * Run: npx tsx extensions/moodist/noise.assert.ts
 *
 * No `node:assert`: `extensions/**` is typechecked against the browser tsconfig.
 */
import { NOISE_RATE, NOISE_SECONDS, dualMonoLoudness, noiseLoop, type NoiseColor } from "./noise";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const colors: NoiseColor[] = ["white", "pink", "brown"];

for (const color of colors) {
  const loop = noiseLoop(color);
  assert(loop.length === NOISE_RATE * NOISE_SECONDS, `${color}: ${loop.length} samples`);

  // Same seed, same loop: the widget sounds the same on every machine.
  const again = noiseLoop(color);
  assert(loop.every((value, i) => value === again[i]), `${color}: not deterministic`);

  // Level: at the shared target, and nowhere near clipping.
  const lufs = dualMonoLoudness(loop);
  assert(Math.abs(lufs + 23) < 0.05, `${color}: ${lufs.toFixed(2)} LUFS, want -23`);
  let peak = 0;
  for (const value of loop) peak = Math.max(peak, Math.abs(value));
  assert(peak < 0.5, `${color}: peak ${peak}`);

  // The seam is no bigger a step than the signal takes anywhere else.
  let largest = 0;
  for (let i = 1; i < loop.length; i += 1) largest = Math.max(largest, Math.abs(loop[i]! - loop[i - 1]!));
  const seam = Math.abs(loop[0]! - loop[loop.length - 1]!);
  assert(seam <= largest, `${color}: seam step ${seam} above the largest step ${largest}`);
}

// Heard loudness differs from RMS: equal LUFS must leave white noise with the
// smallest RMS of the three, or the K-weighting is not doing its job.
const rms = (loop: Float32Array) => Math.sqrt(loop.reduce((sum, v) => sum + v * v, 0) / loop.length);
const [white, pink, brown] = colors.map((color) => rms(noiseLoop(color)));
assert(white! < pink! && pink! < brown!, `rms white ${white} pink ${pink} brown ${brown}`);

console.log("noise.assert.ts: ok");
