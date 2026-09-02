/**
 * State and text helpers for the selection quick-action popup.
 *
 * Pure, so the parts that are easy to get subtly wrong — wrapping the keyboard
 * selection, shortening a selection for the preview line — can be tested
 * without a window, a hotkey, or a model.
 */

/** What the popup is doing right now. */
export type QuickActionPhase =
  | { kind: "menu" }
  | { kind: "running"; actionId: string }
  | { kind: "streaming"; actionId: string; text: string }
  | { kind: "result"; actionId: string; text: string }
  | { kind: "error"; message: string };

export const MENU_PHASE: QuickActionPhase = { kind: "menu" };

/**
 * Move the keyboard selection by `delta`, wrapping around.
 *
 * Wrapping rather than clamping: the list is four rows in a popup the user
 * opened with a hotkey, so pressing Down once more to get back to the top is
 * the shorter path, and there is no scroll region for a clamp to hint at.
 */
export function moveSelection(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** One line of the selection, for the popup's "this is what changes" header. */
export function previewText(text: string, maxChars = 64): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  // Cut on a word boundary when one is near the limit; a hard cut mid-word
  // reads like the selection itself was broken.
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > maxChars - 12 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * Turn whatever was thrown into something the popup can show.
 *
 * Tauri command rejections arrive as plain strings, extension handlers throw
 * `Error`, and a rejected fetch can be anything at all.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

/** True while a run is in flight — the menu stops accepting picks. */
export function isBusy(phase: QuickActionPhase): boolean {
  return phase.kind === "running" || phase.kind === "streaming";
}

/** The action id currently running, if any. */
export function runningActionId(phase: QuickActionPhase): string | undefined {
  return phase.kind === "running" || phase.kind === "streaming" ? phase.actionId : undefined;
}

/** Growing or finished answer currently shown in the popup. */
export function outputText(phase: QuickActionPhase): string {
  return phase.kind === "streaming" || phase.kind === "result" ? phase.text : "";
}

/** Append one model token to the in-flight answer. */
export function appendStreamChunk(
  phase: QuickActionPhase,
  actionId: string,
  chunk: string,
): QuickActionPhase {
  if (!chunk) return phase;
  if (phase.kind === "running" && phase.actionId === actionId) {
    return { kind: "streaming", actionId, text: chunk };
  }
  if (phase.kind === "streaming" && phase.actionId === actionId) {
    return { kind: "streaming", actionId, text: phase.text + chunk };
  }
  return phase;
}

/** Mark the in-flight answer as finished so copy/back behave as a result. */
export function finishStream(
  phase: QuickActionPhase,
  actionId: string,
  text: string,
): QuickActionPhase {
  if (
    (phase.kind === "running" || phase.kind === "streaming") &&
    phase.actionId === actionId
  ) {
    return { kind: "result", actionId, text };
  }
  return phase;
}
