/**
 * Single body-level tip so hover labels paint above palette/widgets/overflow.
 */
import { nextTick, reactive, type Directive } from "vue";

export type TipPlacement = "above" | "below";

const SHOW_DELAY_MS = 80;
const GAP_PX = 6;

export const floatingTip = reactive({
  text: "",
  open: false,
  visible: false,
  style: {
    top: "0px",
    left: "0px",
  } as Record<string, string>,
});

let activeEl: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let placement: TipPlacement = "above";

function clearShowTimer() {
  if (showTimer !== undefined) {
    clearTimeout(showTimer);
    showTimer = undefined;
  }
}

/** Position the open tip relative to `el` (viewport-fixed). */
function positionTip(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const tipEl = document.querySelector(".kavibay-floating-tip") as HTMLElement | null;
  const tw = tipEl?.offsetWidth ?? 0;
  const th = tipEl?.offsetHeight ?? 0;
  let left = r.left + r.width / 2 - tw / 2;
  let top =
    placement === "below" ? r.bottom + GAP_PX : r.top - th - GAP_PX;
  left = Math.min(window.innerWidth - tw - 4, Math.max(4, left));
  top = Math.min(window.innerHeight - th - 4, Math.max(4, top));
  floatingTip.style = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

/** Show a tip for `el` after a short delay (matches prior CSS tip feel). */
export function showFloatingTip(
  el: HTMLElement,
  text: string,
  tipPlacement: TipPlacement = "above",
) {
  if (!text) {
    hideFloatingTip(el);
    return;
  }
  placement = tipPlacement;
  // Already showing on this anchor (e.g. Hide → Remove): refresh in place.
  if (activeEl === el && floatingTip.open) {
    floatingTip.text = text;
    void nextTick(() => {
      if (activeEl === el) positionTip(el);
    });
    floatingTip.visible = true;
    return;
  }
  activeEl = el;
  clearShowTimer();
  floatingTip.text = text;
  floatingTip.open = true;
  floatingTip.visible = false;
  showTimer = setTimeout(() => {
    showTimer = undefined;
    if (activeEl !== el) return;
    void nextTick(() => {
      if (activeEl !== el) return;
      positionTip(el);
      requestAnimationFrame(() => {
        if (activeEl === el) floatingTip.visible = true;
      });
    });
  }, SHOW_DELAY_MS);
}

/** Hide tip when leaving `el` (ignored if another anchor took over). */
export function hideFloatingTip(el?: HTMLElement) {
  if (el && activeEl && el !== activeEl) return;
  clearShowTimer();
  activeEl = null;
  floatingTip.visible = false;
  floatingTip.open = false;
  floatingTip.text = "";
}

type TipEl = HTMLElement & {
  __kavibayTip?: {
    enter: () => void;
    leave: () => void;
    /** Latest binding text — enter must not close over a stale `binding.value`. */
    text: string;
    placement: TipPlacement;
  };
};

/**
 * `v-tip="'Pin'"` or `v-tip:below="label"`.
 * Renders via the shared body-level tip host (never clipped by card overflow).
 */
export const vTip: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    const tipEl = el as TipEl;
    const tipPlacement: TipPlacement =
      binding.arg === "below" ? "below" : "above";
    const enter = () => {
      const state = tipEl.__kavibayTip;
      if (!state) return;
      if (state.text) showFloatingTip(el, state.text, state.placement);
    };
    const leave = () => hideFloatingTip(el);
    tipEl.__kavibayTip = {
      enter,
      leave,
      placement: tipPlacement,
      text: typeof binding.value === "string" ? binding.value : "",
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focus", enter);
    el.addEventListener("blur", leave);
  },
  updated(el, binding) {
    const tipEl = el as TipEl;
    const state = tipEl.__kavibayTip;
    if (!state) return;
    state.text = typeof binding.value === "string" ? binding.value : "";
    state.placement = binding.arg === "below" ? "below" : "above";
    // Refresh in place while hovering; next enter uses `state.text` otherwise.
    if (activeEl !== el) return;
    if (state.text) showFloatingTip(el, state.text, state.placement);
    else hideFloatingTip(el);
  },
  unmounted(el) {
    const tipEl = el as TipEl;
    const handlers = tipEl.__kavibayTip;
    if (handlers) {
      el.removeEventListener("pointerenter", handlers.enter);
      el.removeEventListener("pointerleave", handlers.leave);
      el.removeEventListener("focus", handlers.enter);
      el.removeEventListener("blur", handlers.leave);
      delete tipEl.__kavibayTip;
    }
    hideFloatingTip(el);
  },
};
