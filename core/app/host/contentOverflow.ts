// SPDX-License-Identifier: MIT
/**
 * How a sandboxed frame tells the surface above it that its content does not
 * fit.
 *
 * A DOM event rather than a component emit, because the two frames sit at
 * different depths: the runtime frame is a direct child of the wizard's preview
 * chrome, the contract one is behind `ContractPackageWidget` and
 * `CockpitWidget`. Threading a prop through those would add a parameter to two
 * generic components for one caller's benefit — and the event bubbles through
 * any number of layers without them knowing.
 *
 * It also scopes itself correctly: the listener is on the preview's own
 * element, so a widget running on the desk cannot resize the wizard's card by
 * reporting a size.
 */
export const CONTENT_OVERFLOW_EVENT = "kavibay:content-overflow";

/**
 * Announce how much taller the guest's content is than the frame showing it.
 *
 * The difference rather than the content height: the guest can measure what it
 * cannot see the frame for, and the caller above knows how tall its card is.
 * Growing by the gap needs no card padding, title bar or border modelled — and
 * it converges, because once the content fits the gap is zero.
 */
export function reportContentOverflow(
  frame: HTMLElement | null | undefined,
  contentHeight: number,
): void {
  if (!frame || !Number.isFinite(contentHeight)) return;
  // Kept on the frame for the card's fit-to-content gesture (`WidgetCard`),
  // which needs the latest height on demand rather than an event stream.
  frame.dataset.contentHeight = String(contentHeight);
  const overflow = Math.max(0, contentHeight - frame.getBoundingClientRect().height);
  frame.dispatchEvent(
    new CustomEvent(CONTENT_OVERFLOW_EVENT, { detail: overflow, bubbles: true }),
  );
}
