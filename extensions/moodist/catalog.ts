/**
 * Moodist sound catalog with Vite-bundled asset URLs.
 * Uses import.meta.glob(?url) — dynamic `new URL(\`./sounds/${x}\`)` breaks in Tauri.
 */

import { categoryDefs } from "./soundInventory";

/** One playable ambient sound. */
export interface MoodistSound {
  id: string;
  label: string;
  icon: string;
  src: string;
}

/** Category grouping sounds for the browse UI. */
export interface MoodistCategory {
  id: string;
  title: string;
  icon: string;
  sounds: MoodistSound[];
}

/** Eager URL map for every vendored loop under ./sounds/. */
const soundAssets = import.meta.glob("./sounds/**/*.{mp3,wav}", {
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

/** Curated v1 catalog — order is nature, rain, noise. */
export const categories: MoodistCategory[] = categoryDefs.map((cat) => ({
  id: cat.id,
  title: cat.title,
  icon: cat.icon,
  sounds: cat.sounds.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    src: soundUrl(s.file),
  })),
}));

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
