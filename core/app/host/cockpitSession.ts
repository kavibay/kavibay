import { ref } from "vue";

/**
 * Shared cockpit session flag (double tap on Ctrl opens it).
 * Module-level so overlay-slot UI (onboarding coach) does not rely on provide/inject.
 */
export const kavibayCockpitOpen = ref(false);

/**
 * What asked for a cockpit toggle, as Rust reports it on `palette:hotkey`.
 *
 * Mirrors `CockpitTrigger` in `src-tauri/src/lib.rs`; serde renames the
 * variants to camelCase on the way out. Kept next to the cockpit flag rather
 * than in the onboarding folder because it describes the cockpit, and the tour
 * is only its first consumer.
 */
export type CockpitTrigger = "ctrlDoubleTap" | "cursorHotkey" | "app";
