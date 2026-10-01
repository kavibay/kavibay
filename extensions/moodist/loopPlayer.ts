// SPDX-License-Identifier: MIT
/**
 * Gapless looping for Moodist, on the Web Audio API.
 *
 * `<audio loop>` restarts a file by seeking back, which leaves a short gap at
 * every seam — on rain you hear it as a hiccup. An AudioBufferSourceNode loops
 * sample-accurately between two points of a decoded buffer, and those points
 * sit inside real audio (soundInventory.loopWindow), so whatever padding the
 * encoder added never reaches the speakers.
 *
 * One AudioContext per widget instance. A sound's buffer lives only while that
 * sound is in the mix: a minute of 48 kHz stereo is about 23 MB; a generated
 * noise loop (noise.ts), mono and ten seconds, about 2 MB.
 */

import { NOISE_RATE, noiseLoop, type NoiseColor } from "./noise";

export interface LoopTrack {
  /** A bundled recording to fetch and decode… */
  src?: string;
  /** …or noise to compute on the spot. */
  noise?: NoiseColor;
  loop: { start: number; end: number };
}

interface Voice {
  track: LoopTrack;
  gain: GainNode;
  buffer?: AudioBuffer;
  source?: AudioBufferSourceNode;
}

/** Volume changes glide over this long instead of stepping (and clicking). */
const RAMP_SECONDS = 0.05;

export interface LoopPlayer {
  /** Add the sound if needed and set its level (0–1). */
  set(id: string, track: LoopTrack, volume: number): void;
  /** Stop the sound and free its buffer. */
  remove(id: string): void;
  play(): void;
  pause(): void;
  dispose(): void;
}

export function createLoopPlayer(): LoopPlayer {
  let context: AudioContext | undefined;
  let playing = false;
  const voices = new Map<string, Voice>();

  function audio(): AudioContext {
    context ??= new AudioContext();
    return context;
  }

  function start(voice: Voice): void {
    if (!playing || !voice.buffer || voice.source) return;
    const ctx = audio();
    const source = ctx.createBufferSource();
    source.buffer = voice.buffer;
    source.loop = true;
    source.loopStart = voice.track.loop.start;
    source.loopEnd = Math.min(voice.track.loop.end, voice.buffer.duration);
    source.connect(voice.gain);
    source.start(0, source.loopStart);
    voice.source = source;
  }

  function generate(color: NoiseColor): AudioBuffer {
    const samples = noiseLoop(color);
    const buffer = audio().createBuffer(1, samples.length, NOISE_RATE);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  function load(id: string, voice: Voice): void {
    const { src, noise } = voice.track;
    const pending: Promise<AudioBuffer> = noise
      ? Promise.resolve().then(() => generate(noise))
      : fetch(src ?? "")
          .then((response) => response.arrayBuffer())
          .then((bytes) => audio().decodeAudioData(bytes));
    void pending
      .then((buffer) => {
        if (voices.get(id) !== voice) return;
        voice.buffer = buffer;
        start(voice);
      })
      .catch((error: unknown) => {
        console.warn(`[moodist] could not load "${id}":`, error);
        if (voices.get(id) === voice) remove(id);
      });
  }

  function set(id: string, track: LoopTrack, volume: number): void {
    const ctx = audio();
    let voice = voices.get(id);
    if (!voice) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      voice = { track, gain };
      voices.set(id, voice);
      load(id, voice);
    }
    voice.gain.gain.setTargetAtTime(volume, ctx.currentTime, RAMP_SECONDS / 3);
  }

  function remove(id: string): void {
    const voice = voices.get(id);
    if (!voice) return;
    voices.delete(id);
    voice.source?.stop();
    voice.source?.disconnect();
    voice.gain.disconnect();
  }

  function play(): void {
    playing = true;
    void audio().resume();
    for (const voice of voices.values()) start(voice);
  }

  function pause(): void {
    playing = false;
    void context?.suspend();
  }

  function dispose(): void {
    for (const id of [...voices.keys()]) remove(id);
    void context?.close();
    context = undefined;
  }

  return { set, remove, play, pause, dispose };
}
