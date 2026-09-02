import { onUnmounted } from "vue";
import { viewportEdgeMargin } from "../../app/host/viewportLayout";
import { clampDragOffset, dragFrameElement } from "./dragBounds";

/**
 * Move an element around the page by offsetting it, with the app's edge rule.
 *
 * Shared by `<kavibay-widget>` and `<kavibay-palette-demo>`, because they
 * behave identically on a desk and a second copy of this would drift. Every
 * decision below was measured, and several of them the hard way:
 *
 *  1. **A `translate`, not `position: fixed`.** Fixed positioning resolves
 *     against whichever ancestor happens to establish a containing block, and
 *     a page may introduce one at any time — a transform on a section, a
 *     filter, a backdrop-filter. A grabbed card once jumped to roughly double
 *     its coordinates because of it.
 *
 *  2. **A custom property, not an inline `transform`.** Vue passes a custom
 *     element's non-prop attributes through to the component's root, so an
 *     inline transform on the host also landed on the card inside it and every
 *     drag moved twice as far as the pointer. A custom property travels the
 *     same path harmlessly, because only the host has a rule that reads it.
 *     The `translate` property is used rather than `transform` so a page that
 *     positions the element with its own transform keeps working.
 *
 *  3. **Listeners before pointer capture, and capture may fail.**
 *     `setPointerCapture` throws `NotFoundError` for an id the browser does not
 *     track, and with the call first that exception took the listeners with it:
 *     the element stayed raised and never moved again. Capture is an
 *     improvement — it keeps events coming when the cursor outruns the box —
 *     not a requirement.
 *
 *  4. **Position only if the page has not.** A blanket `position: relative`
 *     overrode a page's own `position: fixed` and dropped the element back into
 *     the document flow mid-drag: a 90 px pull moved it 848 px.
 *
 *  5. **The frame is the desk, not the window.** Clamping to the viewport is
 *     the app's rule and it is right there — the app *is* the window. In a
 *     document it let a visitor drag the Wizard out of the wallpaper and park
 *     it over the article two sections up. `dragBounds.ts` explains the frame
 *     and the one case that needs care: a card taller than its desk.
 */
export interface DragOffsetOptions {
  /** The custom element being moved. Null outside a custom element. */
  host: HTMLElement | null;
  /**
   * The box to keep inside the viewport, when it is not the host's own.
   *
   * A widget's host wraps its card exactly; the palette's host is wider than
   * the panel it draws. Measuring the wrong box makes the clamp stop the
   * element in the wrong place.
   */
  box?: () => HTMLElement | null | undefined;
  /** Called when a drag starts, for stacking. */
  onGrab?: () => void;
}

export function useDragOffset(options: DragOffsetOptions) {
  /** Accumulated offset in CSS pixels; reset only by a reload. */
  const offset = { x: 0, y: 0 };

  /** Set while dragging when the element had no position of its own. */
  let restorePosition: string | null = null;

  let drag: {
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
    /** Box rect at offset (0, 0) — where the page would put it untouched. */
    baseLeft: number;
    baseTop: number;
    width: number;
    height: number;
  } | null = null;

  /**
   * The box the drag is confined to, measured now.
   *
   * Measured per move rather than per grab: the page scrolls under a drag, and
   * a frame remembered from `pointerdown` would drift away from the element it
   * is supposed to hold.
   */
  function frame() {
    const bounds = dragFrameElement(options.host);
    if (bounds) {
      const rect = bounds.getBoundingClientRect();
      // No inset: this frame is the desk, and a card may sit against its edge.
      // The viewport rule below exists to keep a card off the window border,
      // which is a different thing.
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, margin: 0 };
    }
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      margin: viewportEdgeMargin({ width: window.innerWidth, height: window.innerHeight }),
    };
  }

  function onPointerMove(event: PointerEvent) {
    const host = options.host;
    if (!drag || !host) return;

    const box = frame();
    const wantX = drag.startX + (event.clientX - drag.pointerX);
    const wantY = drag.startY + (event.clientY - drag.pointerY);

    offset.x = clampDragOffset(wantX, {
      start: box.left,
      end: box.right,
      margin: box.margin,
      base: drag.baseLeft,
      size: drag.width,
    });
    offset.y = clampDragOffset(wantY, {
      start: box.top,
      end: box.bottom,
      margin: box.margin,
      base: drag.baseTop,
      size: drag.height,
    });

    host.style.setProperty("--kavibay-embed-dx", `${offset.x}px`);
    host.style.setProperty("--kavibay-embed-dy", `${offset.y}px`);
  }

  function onPointerUp() {
    drag = null;
    const host = options.host;
    if (host) {
      if (restorePosition !== null) host.style.position = restorePosition;
      restorePosition = null;
      host.removeAttribute("data-dragging");
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function onMovePointerDown(event: PointerEvent) {
    const host = options.host;
    if (event.button !== 0 || !host) return;

    const rect = (options.box?.() ?? host).getBoundingClientRect();
    drag = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: offset.x,
      startY: offset.y,
      baseLeft: rect.left - offset.x,
      baseTop: rect.top - offset.y,
      width: rect.width,
      height: rect.height,
    };

    options.onGrab?.();

    restorePosition = getComputedStyle(host).position === "static" ? "" : null;
    if (restorePosition !== null) host.style.position = "relative";
    host.setAttribute("data-dragging", "");

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Non-fatal; the window listeners carry the gesture.
    }

    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Move the element by a delta nobody dragged.
   *
   * Resizing from a left or top edge is the case: the card grows, and the edge
   * the pointer is not holding has to stay where it is, which means the whole
   * element shifts. That shift has to land in *this* accumulator — a separate
   * offset would be overwritten by the next drag, and the card would jump back
   * the moment somebody picked it up.
   *
   * NOT clamped to the frame, unlike a drag — and that difference is the point.
   *
   * A drag is somebody moving a card around a desk, so the desk is the limit.
   * Pulling an edge outward is somebody changing the card itself, and the size
   * change happens in `WidgetCard`, which knows nothing about the desk. Clamp
   * only the move and the two halves disagree: measured on a card already
   * flush against the desk's left edge, the width grew by 80px while the
   * position refused to follow, so dragging the *left* edge made the card
   * wider on the right — the very bug this function exists to fix.
   *
   * So a resize may push a card past the frame. The next drag clamps it back,
   * and `clampDragOffset` can pan a card that ended up larger than its frame.
   */
  function nudge(deltaX: number, deltaY: number): void {
    const host = options.host;
    if (!host || (deltaX === 0 && deltaY === 0)) return;

    offset.x += deltaX;
    offset.y += deltaY;

    host.style.setProperty("--kavibay-embed-dx", `${offset.x}px`);
    host.style.setProperty("--kavibay-embed-dy", `${offset.y}px`);
  }

  onUnmounted(onPointerUp);

  return { onMovePointerDown, nudge };
}
