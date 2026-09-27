/**
 * Overlay scrollbars — native bar is hidden; a body-level thumb paints on top
 * of the scrollable’s content (same visual idea as the palette results list).
 *
 * Opt out: `data-native-scroll` on the scrollable.
 * `.palette-list` keeps its own in-shell overlay and is skipped.
 */

type Bound = {
  el: HTMLElement;
  rail: HTMLElement;
  thumb: HTMLElement;
  onScroll: () => void;
  onEnter: () => void;
  onLeave: () => void;
  ro: ResizeObserver;
};

const bound = new Map<HTMLElement, Bound>();

let mo: MutationObserver | undefined;
let rootRo: ResizeObserver | undefined;
let scanQueued = false;

/** Palette owns a custom rail; never double-bind those lists. */
function shouldSkip(el: HTMLElement): boolean {
  if (el.hasAttribute("data-native-scroll")) return true;
  if (el.classList.contains("palette-list")) return true;
  if (el.closest(".palette-list-shell")) return true;
  return false;
}

/** True when the element scrolls vertically with overflow. */
function isVScrollable(el: HTMLElement): boolean {
  if (shouldSkip(el)) return false;
  const style = getComputedStyle(el);
  const oy = style.overflowY;
  if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
  return el.scrollHeight > el.clientHeight + 1;
}

/** Position / size the fixed rail over the scrollable’s right edge. */
function syncRail(state: Bound) {
  const { el, rail, thumb } = state;
  if (!el.isConnected) {
    unbind(el);
    return;
  }

  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 16) {
    rail.classList.remove("kavibay-overlay-scroll-rail--visible");
    return;
  }

  const sh = el.scrollHeight;
  const ch = el.clientHeight;
  if (sh <= ch + 1) {
    rail.classList.remove("kavibay-overlay-scroll-rail--visible");
    return;
  }

  const trackPad = 4;
  // The body-level rail uses viewport pixels; clientHeight stays unscaled
  // inside a widget's CSS zoom. Only the scroll fraction uses local units.
  const track = Math.max(0, r.height - trackPad * 2);
  const thumbH = Math.min(track, Math.max(24, (ch / sh) * track));
  const maxScroll = sh - ch;
  const maxY = Math.max(0, track - thumbH);
  const progress = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
  const thumbY = trackPad + progress * maxY;

  rail.style.top = `${Math.round(r.top)}px`;
  rail.style.left = `${Math.round(r.right - 10)}px`;
  rail.style.height = `${Math.round(r.height)}px`;
  thumb.style.height = `${Math.round(thumbH)}px`;
  thumb.style.transform = `translateY(${Math.round(thumbY)}px)`;
}

/** Bind one scrollable; idempotent. */
function bind(el: HTMLElement) {
  const existing = bound.get(el);
  if (existing) {
    syncRail(existing);
    return;
  }

  const rail = document.createElement("div");
  rail.className = "kavibay-overlay-scroll-rail";
  rail.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "kavibay-overlay-scroll-thumb";
  rail.appendChild(thumb);
  document.body.appendChild(rail);

  const state: Bound = {
    el,
    rail,
    thumb,
    onScroll: () => syncRail(state),
    onEnter: () => {
      syncRail(state);
      if (el.scrollHeight > el.clientHeight + 1) {
        rail.classList.add("kavibay-overlay-scroll-rail--visible");
      }
    },
    onLeave: () => {
      rail.classList.remove("kavibay-overlay-scroll-rail--visible");
    },
    ro: new ResizeObserver(() => syncRail(state)),
  };
  bound.set(el, state);

  el.addEventListener("scroll", state.onScroll, { passive: true });
  el.addEventListener("pointerenter", state.onEnter);
  el.addEventListener("pointerleave", state.onLeave);
  state.ro.observe(el);
  syncRail(state);
}

/** Drop binding when the node leaves the document or stops scrolling. */
function unbind(el: HTMLElement) {
  const state = bound.get(el);
  if (!state) return;
  el.removeEventListener("scroll", state.onScroll);
  el.removeEventListener("pointerenter", state.onEnter);
  el.removeEventListener("pointerleave", state.onLeave);
  state.ro.disconnect();
  state.rail.remove();
  bound.delete(el);
}

/** Walk the tree and bind / refresh scrollables. */
function scan() {
  const live = new Set<HTMLElement>();
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    if (!isVScrollable(el)) continue;
    live.add(el);
    bind(el);
  }
  for (const el of [...bound.keys()]) {
    if (!live.has(el) || !el.isConnected) unbind(el);
  }
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
}

/** Reposition rails after layout / window moves (palette drag, etc.). */
function syncAll() {
  for (const state of bound.values()) syncRail(state);
}

/** Start global overlay scrollbars (call once from main). */
export function installOverlayScrollbars() {
  if (typeof document === "undefined") return;
  scan();

  mo?.disconnect();
  mo = new MutationObserver(() => queueScan());
  mo.observe(document.body, { childList: true, subtree: true });

  rootRo?.disconnect();
  rootRo = new ResizeObserver(() => syncAll());
  rootRo.observe(document.documentElement);

  window.addEventListener("resize", syncAll);
  // Capture scroll from nested scrollers + window transforms (desk drag).
  window.addEventListener("scroll", syncAll, true);
}
