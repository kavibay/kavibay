/**
 * Moodist sound catalog with Vite-bundled asset URLs.
 * Uses import.meta.glob(?url) — dynamic `new URL(\`./sounds/${x}\`)` breaks in Tauri.
 */

import type { NoiseColor } from "./noise";
import { categoryDefs, loopWindow, type MoodistSoundDef } from "./soundInventory";

/** One playable loop. */
export interface MoodistSound {
  id: string;
  label: string;
  icon: string;
  /** Bundled recording to fetch; absent for generated noise. */
  src?: string;
  /** Generated noise to compute instead of fetching (noise.ts). */
  noise?: NoiseColor;
  /** Loop points inside the decoded file, in seconds (see soundInventory.loopWindow). */
  loop: { start: number; end: number };
}

/** Category grouping sounds for the browse UI. */
export interface MoodistCategory {
  id: string;
  title: string;
  icon: string;
  sounds: MoodistSound[];
}

/** Eager URL map for every vendored loop under ./sounds/. */
const soundAssets = import.meta.glob("./sounds/**/*.webm", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve a vendored sound file to a Vite/Tauri-served URL. */
function soundUrl(relativePath: string): string {
  const key = `./sounds/${relativePath}`;
  const url = soundAssets[key];
  if (!url) {
    console.error(`[moodist] Missing sound asset: ${key}`);
    return "";
  }
  return url;
}

/**
 * Whether this engine decodes the file's format.
 *
 * The recordings are Opus in WebM. WebView2 and WebKitGTK play it; WKWebView
 * only reliably from Safari 17.4, and the app still runs on macOS 13. A sound
 * the engine cannot decode is left out rather than listed and silent.
 */
function playable(sound: MoodistSoundDef): boolean {
  if (!sound.file) return true;
  if (typeof Audio === "undefined") return true;
  return new Audio().canPlayType('audio/webm; codecs="opus"') !== "";
}

/** Catalog in inventory order (see soundInventory.ts); categories left empty are dropped. */
export const categories: MoodistCategory[] = categoryDefs
  .map((cat) => ({
    id: cat.id,
    title: cat.title,
    icon: cat.icon,
    sounds: cat.sounds.filter(playable).map((s) => ({
      id: s.id,
      label: s.label,
      icon: s.icon,
      ...(s.source.kind === "generated" ? { noise: s.source.color } : { src: soundUrl(s.file ?? "") }),
      loop: loopWindow(s),
    })),
  }))
  .filter((cat) => cat.sounds.length > 0);

/** All sound ids across every category. */
export function allSoundIds(): ReadonlySet<string> {
  return new Set(categories.flatMap((c) => c.sounds.map((s) => s.id)));
}

/** All category ids in catalog order. */
export function allCategoryIds(): ReadonlySet<string> {
  return new Set(categories.map((c) => c.id));
}

/** Default category id (first catalog entry). */
export function defaultCategoryId(): string {
  return categories[0]!.id;
}

/** Find a category by id. */
export function findCategory(id: string): MoodistCategory | undefined {
  return categories.find((c) => c.id === id);
}

/** Sounds listed under a category (empty if unknown). */
export function soundsForCategory(id: string): MoodistSound[] {
  return findCategory(id)?.sounds ?? [];
}
