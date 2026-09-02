// SPDX-License-Identifier: MIT
/**
 * "Focus your entry point" — the host asking one widget to put the caret where
 * typing should start (Notes: the editor; Calculator: the input; Todo: the first
 * empty row). The widget decides what that means; the host only asks.
 *
 * Addressed by instance *and* surface. The same instance can be on screen twice
 * — a card on the desk and the palette's inline view — and both copies listen on
 * `window`, so an id alone would make them fight over the caret and the loser's
 * `.focus()` would still have moved it.
 */

/** Event name the host dispatches on `window`. */
export const WIDGET_FOCUS_EVENT = "kavibay:focus-widget";

/** Where a widget copy is mounted. Hosts provide this as `widgetSurface`. */
export type WidgetSurface = "desk" | "inline";

/** Payload of a {@link WIDGET_FOCUS_EVENT} event. */
export interface WidgetFocusRequestDetail {
  instanceId?: string;
  /** Absent means the desk — the surface that existed before inline views. */
  surface?: WidgetSurface;
}

/**
 * True when this focus request is meant for the copy asking.
 *
 * Shared so the seven-odd widgets that implement an entry point cannot drift
 * apart on the matching rule, and so the surface check cannot be forgotten in
 * the one widget where it matters.
 */
export function widgetFocusRequestMatches(
  event: Event,
  instanceId: string,
  surface: WidgetSurface = "desk",
): boolean {
  const detail = (event as CustomEvent<WidgetFocusRequestDetail>).detail;
  if (!detail) return false;
  if (detail.instanceId !== instanceId) return false;
  return (detail.surface ?? "desk") === surface;
}
