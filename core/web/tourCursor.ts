/**
 * The tour's mouse pointer: an arrow drawn over the app that travels to what
 * the tour is about to use, and pulses where it clicks. Without it a click
 * happens out of nowhere, and the visitor misses what was pressed.
 *
 * It lives in the app's document, so the page's camera zooms it with
 * everything else. It never takes input (`pointer-events: none`); the clicks
 * themselves are webTour.ts's.
 */

const ARROW =
  '<svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true"><path d="M2 2 L2 21 L7.2 16.4 L10.6 24 L14 22.5 L10.7 15 L18 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let element: HTMLElement | null = null;
let ring: HTMLElement | null = null;

function mount(): HTMLElement {
  if (element) return element;
  const style = document.createElement("style");
  style.textContent = `
    .tour-cursor {
      position: fixed; left: 0; top: 0; z-index: 2147483647;
      pointer-events: none; opacity: 0;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
      transition-property: transform, opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
    .tour-cursor svg { display: block; }
    .tour-cursor__ring {
      position: absolute; left: -14px; top: -14px; width: 32px; height: 32px;
      border-radius: 50%; border: 2px solid rgba(120, 169, 255, 0.9);
      opacity: 0; transform: scale(0.4);
    }
    .tour-cursor__ring--pulse { animation: tour-cursor-pulse 0.45s ease-out; }
    @keyframes tour-cursor-pulse {
      from { opacity: 1; transform: scale(0.4); }
      to { opacity: 0; transform: scale(1.4); }
    }`;
  document.head.appendChild(style);
  element = document.createElement("div");
  element.className = "tour-cursor";
  element.innerHTML = ARROW;
  ring = document.createElement("span");
  ring.className = "tour-cursor__ring";
  element.prepend(ring);
  document.body.appendChild(element);
  // Starts at the screen's centre, not in its corner.
  element.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
  return element;
}

/** Glide to (x, y) over `ms`; the caller waits it out in the tour's pace. */
export function moveCursor(x: number, y: number, ms: number): void {
  const cursor = mount();
  cursor.style.opacity = "1";
  cursor.style.transitionDuration = `${Math.max(0, ms)}ms, 200ms`;
  cursor.style.transform = `translate(${x}px, ${y}px)`;
}

/** A press: the ring pulses under the tip. */
export function pressCursor(): void {
  if (!ring) return;
  ring.classList.remove("tour-cursor__ring--pulse");
  void ring.offsetWidth;
  ring.classList.add("tour-cursor__ring--pulse");
}

export function hideCursor(): void {
  if (element) element.style.opacity = "0";
}
