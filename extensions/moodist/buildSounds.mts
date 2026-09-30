// SPDX-License-Identifier: MIT
// A Node script: `.mts` keeps it out of the browser tsconfig (extensions/**/*.ts).
/**
 * Cuts, loops and encodes the recorded Moodist sounds from their originals.
 * Run: npx tsx extensions/moodist/buildSounds.mts <folder with the Freesound downloads>
 *
 * Needs ffmpeg with libopus on PATH. The originals are not in the repository —
 * download them from the URLs in soundInventory.ts; each file is found by its
 * Freesound id, the prefix Freesound gives every download (`167034__…wav`).
 *
 * Per sound, as soundInventory.ts describes it:
 *   1. read `cut.length + CROSSFADE_SECONDS` from `cut.start`, as 48 kHz stereo
 *   2. close the loop: the extra seconds fade out over the first seconds, which
 *      fade in (equal power), so the end runs on into the start
 *   3. bring it to TARGET_LUFS, never above PEAK_CEILING_DBTP; a sound with
 *      `limitDb` may have its loudest transients limited by up to that much
 *      to get there (a fire's few loud pops, not its bed)
 *   4. wrap it in LOOP_PAD_SECONDS of itself on each side (see loopWindow)
 *   5. encode Opus in WebM — WebView2, WKWebView and WebKitGTK all play it
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROSSFADE_SECONDS,
  LOOP_PAD_SECONDS,
  categoryDefs,
  type FreesoundSource,
} from "./soundInventory";

const RATE = 48_000;
const CHANNELS = 2;
/** Same target as noise.ts, so a recording and a noise sit level. */
const TARGET_LUFS = -23;
const PEAK_CEILING_DBTP = -1;
const BITRATE = "96k";

const here = dirname(fileURLToPath(import.meta.url));

function run(args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", ...args]);
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout: Buffer.concat(out), stderr: err })
        : reject(new Error(`ffmpeg ${args.join(" ")} exited ${code}\n${err.slice(-2000)}`)),
    );
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const RAW_IN = ["-f", "f32le", "-ar", String(RATE), "-ac", String(CHANNELS), "-i", "-"];

async function decode(file: string, start: number, seconds: number): Promise<Float32Array> {
  const { stdout } = await run([
    "-v", "error",
    "-ss", String(start),
    "-t", String(seconds),
    "-i", file,
    "-ac", String(CHANNELS),
    "-ar", String(RATE),
    "-f", "f32le",
    "-",
  ]);
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

/** Integrated loudness and true peak, per EBU R128 as ffmpeg measures it. */
async function measure(samples: Float32Array): Promise<{ lufs: number; truePeak: number }> {
  const { stderr } = await run(["-nostats", ...RAW_IN, "-af", "ebur128=peak=true", "-f", "null", "-"], Buffer.from(samples.buffer));
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(truePeak)) throw new Error("could not read ebur128 summary");
  return { lufs, truePeak };
}

function closeLoop(segment: Float32Array, length: number, fade: number): Float32Array {
  const loop = segment.slice(0, length * CHANNELS);
  for (let frame = 0; frame < fade; frame += 1) {
    const t = ((frame + 0.5) / fade) * (Math.PI / 2);
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const i = frame * CHANNELS + channel;
      loop[i] = segment[i]! * Math.sin(t) + segment[length * CHANNELS + i]! * Math.cos(t);
    }
  }
  return loop;
}

/** Sample-peak ceiling for the limiter; below the true-peak ceiling, for the encoder's overshoot. */
const LIMIT_CEILING = 10 ** (-2 / 20);
const LIMIT_LOOKAHEAD_SECONDS = 0.002;
const LIMIT_RELEASE_SECONDS = 0.08;

/**
 * Brick-wall peak limiter with lookahead, in place, run around the loop.
 *
 * The gain for each frame is the lowest any frame in the next few ms needs,
 * averaged over the same window so the dip ramps in before the peak instead of
 * clicking on it, and released slowly afterwards. The loop is treated as a
 * circle: a pop just before the seam is prepared for across it, and the
 * release state at the start is the one the end leaves behind.
 * Returns the deepest reduction applied, in dB.
 */
function limitPeaks(loop: Float32Array): number {
  const frames = loop.length / CHANNELS;
  const look = Math.max(1, Math.round(LIMIT_LOOKAHEAD_SECONDS * RATE));
  const release = Math.exp(-1 / (LIMIT_RELEASE_SECONDS * RATE));
  const at = (frame: number) => ((frame % frames) + frames) % frames;

  const need = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      peak = Math.max(peak, Math.abs(loop[frame * CHANNELS + channel]!));
    }
    need[frame] = peak > LIMIT_CEILING ? LIMIT_CEILING / peak : 1;
  }
  if (need.every((value) => value === 1)) return 0;

  const lowest = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let min = 1;
    for (let k = 0; k <= look; k += 1) min = Math.min(min, need[at(frame + k)]!);
    lowest[frame] = min;
  }
  const ramp = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let k = 0; k <= look; k += 1) sum += lowest[at(frame - k)]!;
    ramp[frame] = sum / (look + 1);
  }

  const gain = new Float32Array(frames);
  let current = 1;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      const wanted = ramp[frame]!;
      current = wanted < current ? wanted : current * release + wanted * (1 - release);
      gain[frame] = current;
    }
  }

  let deepest = 1;
  for (let frame = 0; frame < frames; frame += 1) {
    deepest = Math.min(deepest, gain[frame]!);
    for (let channel = 0; channel < CHANNELS; channel += 1) loop[frame * CHANNELS + channel]! *= gain[frame]!;
  }
  return -20 * Math.log10(deepest);
}

function pad(loop: Float32Array, frames: number): Float32Array {
  const width = frames * CHANNELS;
  const out = new Float32Array(loop.length + 2 * width);
  out.set(loop.subarray(loop.length - width), 0);
  out.set(loop, width);
  out.set(loop.subarray(0, width), width + loop.length);
  return out;
}

function findOriginal(folder: string, source: FreesoundSource): string {
  const match = readdirSync(folder).find((name) => name.startsWith(`${source.id}__`));
  if (!match) throw new Error(`no download for freesound ${source.id} (${source.url}) in ${folder}`);
  return join(folder, match);
}

async function build(folder: string): Promise<void> {
  for (const category of categoryDefs) {
    for (const sound of category.sounds) {
      if (sound.source.kind !== "freesound") continue;
      const { cut } = sound.source;
      const length = Math.round(cut.length * RATE);
      const fade = Math.round(CROSSFADE_SECONDS * RATE);

      const segment = await decode(findOriginal(folder, sound.source), cut.start, cut.length + CROSSFADE_SECONDS);
      if (segment.length < (length + fade) * CHANNELS) {
        throw new Error(`${sound.id}: original ends before ${cut.start + cut.length + CROSSFADE_SECONDS}s`);
      }

      const loop = closeLoop(segment, length, fade);
      const before = await measure(loop);
      const gainDb = Math.min(
        TARGET_LUFS - before.lufs,
        PEAK_CEILING_DBTP - before.truePeak + (sound.source.limitDb ?? 0),
      );
      const gain = 10 ** (gainDb / 20);
      for (let i = 0; i < loop.length; i += 1) loop[i]! *= gain;
      const limitedDb = limitPeaks(loop);
      const after = await measure(loop);
      const padded = pad(loop, Math.round(LOOP_PAD_SECONDS * RATE));

      const target = join(here, "sounds", sound.file);
      mkdirSync(dirname(target), { recursive: true });
      await run([
        "-v", "error", "-y",
        ...RAW_IN,
        "-c:a", "libopus", "-b:a", BITRATE, "-vbr", "on", "-application", "audio",
        "-map_metadata", "-1",
        "-f", "webm",
        target,
      ], Buffer.from(padded.buffer));

      const kb = Math.round(statSync(target).size / 1024);
      process.stdout.write(
        `${sound.file.padEnd(28)} ${String(cut.length).padStart(5)}s  ` +
          `${before.lufs.toFixed(1)} → ${after.lufs.toFixed(1)} LUFS, peak ${after.truePeak.toFixed(1)} dBTP` +
          `${limitedDb > 0.05 ? `, limited ≤${limitedDb.toFixed(1)} dB` : ""}  ${kb} KB\n`,
      );
    }
  }
}

const folder = process.argv[2];
if (!folder) {
  console.error("usage: npx tsx extensions/moodist/buildSounds.mts <folder with the Freesound downloads>");
  process.exit(1);
}
await build(folder);
