// SPDX-License-Identifier: MIT
/**
 * Pure Moodist sound inventory (no Vite asset URLs).
 * catalog.ts attaches bundled `src` URLs; assert scripts import this in Node.
 *
 * Every sound says where it comes from. Upstream Moodist's recordings are not
 * shipped because their licence was never recorded per file; this file is that
 * record, and `catalog.assert.ts` refuses a sound without one.
 */
import { NOISE_SECONDS, type NoiseColor } from "./noise";

/** A recording from Freesound, released there under CC0. */
export interface FreesoundSource {
  kind: "freesound";
  id: number;
  title: string;
  author: string;
  url: string;
  license: "CC0-1.0";
  /**
   * The stretch of the original the loop is cut from, in seconds.
   * `buildSounds.mts` reads `length + CROSSFADE_SECONDS` from `start`.
   */
  cut: { start: number; length: number };
  /**
   * How far the loudest transients may be limited, in dB, so the rest reaches
   * the target loudness. For sounds whose few peaks sit far above their bed —
   * breaking waves, a fire's pops. Leave out and the peaks cap the gain instead.
   */
  limitDb?: number;
}

/** Noise computed when it is played (noise.ts); no file, this extension's MIT licence. */
export interface GeneratedSource {
  kind: "generated";
  color: NoiseColor;
}

export type MoodistSource = FreesoundSource | GeneratedSource;

/** One catalog sound before URL resolution. */
export interface MoodistSoundDef {
  id: string;
  label: string;
  icon: string;
  /** Recordings only: path under ./sounds/, e.g. `rain/light-rain.webm`. */
  file?: string;
  source: MoodistSource;
}

/** Category before URL resolution. */
export interface MoodistCategoryDef {
  id: string;
  title: string;
  icon: string;
  sounds: MoodistSoundDef[];
}

/**
 * Real audio on each side of an encoded loop, in seconds.
 *
 * A lossy decoder may put its priming samples, or trim them, at the start of
 * the buffer. Loop points that sit inside real audio instead of at the file's
 * edges survive either: both move by the same amount, and what is on each side
 * of them is the same sound.
 */
export const LOOP_PAD_SECONDS = 0.25;

/** Equal-power crossfade that closes each recorded loop, in seconds. */
export const CROSSFADE_SECONDS = 2;

/** Where the loop sits inside the decoded (or generated) buffer, in seconds. */
export function loopWindow(sound: MoodistSoundDef): { start: number; end: number } {
  return sound.source.kind === "freesound"
    ? { start: LOOP_PAD_SECONDS, end: LOOP_PAD_SECONDS + sound.source.cut.length }
    : { start: 0, end: NOISE_SECONDS };
}

const freesound = (
  id: number,
  title: string,
  author: string,
  url: string,
  cut: { start: number; length: number },
  limitDb?: number,
): FreesoundSource => ({ kind: "freesound", id, title, author, url, license: "CC0-1.0", cut, limitDb });

const noise = (color: NoiseColor): GeneratedSource => ({ kind: "generated", color });

/** v0.1 inventory — order is nature, rain, noise. */
export const categoryDefs: MoodistCategoryDef[] = [
  {
    id: "nature",
    title: "Nature",
    icon: "tree",
    sounds: [
      {
        id: "creek",
        label: "Creek",
        icon: "water",
        file: "nature/creek.webm",
        source: freesound(
          231536,
          "Creek 06 (loop)",
          "VKProduktion",
          "https://freesound.org/people/VKProduktion/sounds/231536/",
          { start: 0, length: 33 },
        ),
      },
      {
        id: "waves",
        label: "Waves",
        icon: "waves",
        file: "nature/waves.webm",
        source: freesound(
          339517,
          "Waves at Baltic Sea shore.wav",
          "pulswelle",
          "https://freesound.org/people/pulswelle/sounds/339517/",
          { start: 690, length: 90 },
          2,
        ),
      },
      {
        id: "forest",
        label: "Forest",
        icon: "leaf",
        file: "nature/forest.webm",
        source: freesound(
          385280,
          "sfx_amb_forest_spring_afternoon-01.wav",
          "bajko",
          "https://freesound.org/people/bajko/sounds/385280/",
          { start: 30, length: 90 },
        ),
      },
      {
        id: "night-forest",
        label: "Night Forest",
        icon: "moon",
        file: "nature/night-forest.webm",
        source: freesound(
          328293,
          "Forest at night, crickets, cicadas and insects in the Sian Ka'an Biosphere Reserve",
          "felix.blume",
          "https://freesound.org/people/felix.blume/sounds/328293/",
          { start: 30, length: 90 },
        ),
      },
      {
        id: "campfire",
        label: "Campfire",
        icon: "fire",
        file: "nature/campfire.webm",
        // A remix of Spandau's "campfire.wav" (freesound 40699) and HECKFRICKER's
        // "Campfire 02" (freesound 729396); both CC0 as well.
        source: freesound(
          836535,
          "Hearthfire (Louder)",
          "SilverIllusionist",
          "https://freesound.org/people/SilverIllusionist/sounds/836535/",
          { start: 0, length: 76 },
          4,
        ),
      },
    ],
  },
  {
    id: "rain",
    title: "Rain",
    icon: "rain",
    sounds: [
      {
        id: "light-rain",
        label: "Light Rain",
        icon: "rain",
        file: "rain/light-rain.webm",
        source: freesound(
          167034,
          "Light Rain",
          "soundrecorder7",
          "https://freesound.org/people/soundrecorder7/sounds/167034/",
          { start: 0, length: 24 },
          6,
        ),
      },
      {
        id: "rain-on-car-roof",
        label: "Rain on Car Roof",
        icon: "car",
        file: "rain/rain-on-car-roof.webm",
        source: freesound(
          344460,
          "Hard Rain on Car Roof.wav",
          "eRobb4",
          "https://freesound.org/people/eRobb4/sounds/344460/",
          { start: 0, length: 29.5 },
        ),
      },
      {
        id: "thunderstorm",
        label: "Thunderstorm",
        icon: "thunder",
        file: "rain/thunderstorm.webm",
        source: freesound(
          447510,
          "Rain and thunder in Thailand",
          "felix.blume",
          "https://freesound.org/people/felix.blume/sounds/447510/",
          { start: 630, length: 120 },
        ),
      },
    ],
  },
  {
    id: "noise",
    title: "Noise",
    icon: "noise",
    sounds: [
      { id: "white-noise", label: "White Noise", icon: "soundwave", source: noise("white") },
      { id: "pink-noise", label: "Pink Noise", icon: "soundwave", source: noise("pink") },
      { id: "brown-noise", label: "Brown Noise", icon: "soundwave", source: noise("brown") },
    ],
  },
];
