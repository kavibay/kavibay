/**
 * Pure Moodist sound inventory (no Vite asset URLs).
 * catalog.ts attaches bundled `src` URLs; assert scripts import this in Node.
 */

/** One catalog sound before URL resolution. */
export interface MoodistSoundDef {
  id: string;
  label: string;
  icon: string;
  /** Path under ./sounds/, e.g. `nature/river.mp3`. */
  file: string;
}

/** Category before URL resolution. */
export interface MoodistCategoryDef {
  id: string;
  title: string;
  icon: string;
  sounds: MoodistSoundDef[];
}

/** Curated v1 inventory — order is nature, rain, noise. */
export const categoryDefs: MoodistCategoryDef[] = [
  {
    id: "nature",
    title: "Nature",
    icon: "tree",
    sounds: [
      { id: "river", label: "River", icon: "water", file: "nature/river.mp3" },
      { id: "waves", label: "Waves", icon: "waves", file: "nature/waves.mp3" },
      { id: "campfire", label: "Campfire", icon: "fire", file: "nature/campfire.mp3" },
      { id: "wind", label: "Wind", icon: "wind", file: "nature/wind.mp3" },
      { id: "howling-wind", label: "Howling Wind", icon: "wind", file: "nature/howling-wind.mp3" },
      { id: "wind-in-trees", label: "Wind in Trees", icon: "leaf", file: "nature/wind-in-trees.mp3" },
      { id: "waterfall", label: "Waterfall", icon: "waterfall", file: "nature/waterfall.mp3" },
      { id: "walk-in-snow", label: "Walk in Snow", icon: "snow", file: "nature/walk-in-snow.mp3" },
      { id: "walk-on-leaves", label: "Walk on Leaves", icon: "leaf", file: "nature/walk-on-leaves.mp3" },
      { id: "walk-on-gravel", label: "Walk on Gravel", icon: "gravel", file: "nature/walk-on-gravel.mp3" },
      { id: "droplets", label: "Droplets", icon: "droplet", file: "nature/droplets.mp3" },
      { id: "jungle", label: "Jungle", icon: "tree", file: "nature/jungle.mp3" },
    ],
  },
  {
    id: "rain",
    title: "Rain",
    icon: "rain",
    sounds: [
      { id: "light-rain", label: "Light Rain", icon: "rain", file: "rain/light-rain.mp3" },
      { id: "heavy-rain", label: "Heavy Rain", icon: "heavy-rain", file: "rain/heavy-rain.mp3" },
      { id: "thunder", label: "Thunder", icon: "thunder", file: "rain/thunder.mp3" },
      { id: "rain-on-window", label: "Rain on Window", icon: "window", file: "rain/rain-on-window.mp3" },
      { id: "rain-on-car-roof", label: "Rain on Car Roof", icon: "car", file: "rain/rain-on-car-roof.mp3" },
      { id: "rain-on-umbrella", label: "Rain on Umbrella", icon: "umbrella", file: "rain/rain-on-umbrella.mp3" },
      { id: "rain-on-tent", label: "Rain on Tent", icon: "tent", file: "rain/rain-on-tent.mp3" },
      { id: "rain-on-leaves", label: "Rain on Leaves", icon: "leaf", file: "rain/rain-on-leaves.mp3" },
    ],
  },
  {
    id: "noise",
    title: "Noise",
    icon: "noise",
    sounds: [
      { id: "white-noise", label: "White Noise", icon: "soundwave", file: "noise/white-noise.wav" },
      { id: "pink-noise", label: "Pink Noise", icon: "soundwave", file: "noise/pink-noise.wav" },
      { id: "brown-noise", label: "Brown Noise", icon: "soundwave", file: "noise/brown-noise.wav" },
    ],
  },
];
