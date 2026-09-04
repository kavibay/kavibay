// SPDX-License-Identifier: MIT
/**
 * "Stand down while I hold the screen" — a widget telling the host to suspend
 * its own dismiss gestures for the length of a modal interaction.
 *
 * The host has two ways of getting out of the user's way: Escape hides the
 * window, and a click outside the cockpit dismisses it. Both are correct almost
 * always and wrong during a gesture that owns the whole screen — the Color
 * Picker's eyedropper is the case that exists: Escape has to cancel the pick,
 * and a click anywhere is the pick itself, not a dismissal.
 *
 * Settings already gets this treatment through host-owned state. This is the
 * same door, opened to widgets, and it exists because the alternative was the
 * host importing a `ref` out of `extensions/color-picker/` — core reaching into
 * a folder it is not supposed to know exists, for a fact that is not about
 * colour at all. Here both sides depend on the SDK and neither on the other,
 * which is the direction the rest of the system already runs in.
 *
 * A LIST OF HOLDERS, NOT A BOOLEAN, and that is the part worth keeping. Two
 * instances of the same widget can be on screen, and a shared boolean makes the
 * first one to finish speak for the second: end one pick while another is live
 * and the host re-arms Escape underneath it. Releases are matched to their own
 * claim, so a hold ends only when every holder has let go.
 */
import { computed, ref, type ComputedRef } from "vue";

/** One entry per live claim; the reason is carried for debugging. */
const holders = ref<{ id: number; reason: string }[]>([]);
let nextId = 0;

/** True while at least one widget is holding the host's dismiss gestures. */
export const hostDismissHeld: ComputedRef<boolean> = computed(() => holders.value.length > 0);

/** Who is holding, oldest first. Reasons only — for logs and debug panels. */
export const hostDismissHolders: ComputedRef<readonly string[]> = computed(() =>
  holders.value.map((holder) => holder.reason),
);

/**
 * Claim the host's dismiss gestures for a modal interaction.
 *
 * Returns the release. Calling it twice is harmless, which matters because the
 * natural places to release are both a state transition and `onScopeDispose`,
 * and a widget torn down mid-gesture runs both.
 */
export function holdHostDismiss(reason: string): () => void {
  const id = nextId++;
  holders.value = [...holders.value, { id, reason }];
  return () => {
    holders.value = holders.value.filter((holder) => holder.id !== id);
  };
}
