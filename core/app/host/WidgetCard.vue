<script setup lang="ts">
import { installContentZoom } from "./contentZoom";
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  useSlots,
  watch,
} from "vue";
import { scheduleRegionSync, setClickThroughPaused } from "../system/clickThrough";
import ResizeEdges from "./ResizeEdges.vue";
import PinIcon from "./PinIcon.vue";
import { isCardHeaderHit, useCardChromePosition } from "./useCardChromePosition";
import {
  clampContentScale,
  DEFAULT_CONTENT_SCALE,
  RESIZE_EDGES_HORIZONTAL,
  RESIZE_EDGES_NO_TOP,
} from "./resizeLogic";
import {
  HIDE_PRESS_ARM_MS,
  HIDE_PRESS_HINT_MS,
  hidePressTipLabel,
  resolveHidePressRelease,
  type HidePressPhase,
} from "./hidePressLogic";
import { onboardingState } from "../onboarding/onboardingSession";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches } from "@sdk";
import { IconBase, SparklesIcon, SquareArrowDownRightIcon } from "@sdk/icons";
import {
  SHORTCUT_HINT_TARGET_KEY,
  shortcutModifierLabel,
} from "./shortcutHints";

const props = withDefaults(
  defineProps<{
    title: string;
    hideTitle: boolean;
    instanceId: string;
    hasSettings: boolean;
    /** When true, offer the extension's README in the widget menu. */
    hasAbout?: boolean;
    /** The owner can present this live card in the shared preview dialog. */
    canShare?: boolean;
    /**
     * When true, offer "Edit in Wizard".
     *
     * Only for a package the Wizard built. Reopening anything else there would
     * hand the model a package it has no conversation for, and the card would
     * promise an edit it cannot make.
     */
    canEditInWizard?: boolean;
    /** No card padding; body fills the chrome (e.g. Image widget). */
    flush?: boolean;
    /** Drop the default min-width so narrow docks are not padded out. */
    compact?: boolean;
    /** When false, hide the Duplicate menu item. */
    allowDuplicate?: boolean;
    /** Search-result flash: colorful border that fades out. */
    highlighted?: boolean;
    /** Palette row is selected: persistent accent ring, no restack. */
    previewed?: boolean;
    /** When true, the Pin menu item shows as on. */
    pinned?: boolean;
    /** When true, show host edge-resize handles. */
    resizable?: boolean;
    /** Host-persisted width (CSS px). */
    width?: number;
    /** Host-persisted height (CSS px). */
    height?: number;
    /** Body content zoom from Ctrl+resize (1 = default). */
    contentScale?: number;
    /** Keep resize square (Snake). */
    lockSquare?: boolean;
    /** Playground: content bleeds to the card border (title stays inset). */
    playground?: boolean;
    /** Host owns width only; height hugs content (App Launcher). */
    hugHeight?: boolean;
    /** Whole-card move drag except chrome / resize / menus. */
    fullDrag?: boolean;
    /**
     * Draw this card on an opaque ground instead of the shared glass.
     *
     * Declared by the widget (`ui.opaque`), not chosen per instance: it is a
     * property of what the widget *is*. A workspace — dense text in columns, a
     * file editor, a live preview of a different widget — cannot be read
     * against a wallpaper and the cards behind it, and a preview in particular
     * has to be judged against a plain ground rather than against the desk
     * showing through whatever it is drawing.
     */
    opaque?: boolean;
    /**
     * The widget's own look as CSS variables: `cardVars` on the card (corner
     * radius, which the chrome derives from too), `surfaceVars` on the glass
     * layer only, so the menu and settings inside keep the shared colours.
     */
    cardVars?: Record<string, string>;
    surfaceVars?: Record<string, string>;
    /** When true, Delete asks first: remove from this desk vs delete everywhere. */
    multiDeskRemove?: boolean;
    /** Expose drag/resize/pin targets for the guided tour (non-gallery). */
    coachTargets?: boolean;
  }>(),
  {
    allowDuplicate: true,
    highlighted: false,
    previewed: false,
    pinned: false,
    resizable: true,
    lockSquare: false,
    playground: false,
    hugHeight: false,
    fullDrag: false,
    opaque: false,
    coachTargets: false,
  },
);

const emit = defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  duplicate: [];
  about: [];
  share: [];
  /** Reopen this widget's own package in the Widget Wizard. */
  "edit-in-wizard": [];
  hide: [];
  /** Leave the desk and open in the palette panel instead. */
  "move-to-panel": [];
  remove: [mode: "desk" | "everywhere"];
  "toggle-pin": [];
  "move-pointerdown": [event: PointerEvent];
  resize: [
    payload: {
      width: number;
      height: number;
      deltaOffset: { x: number; y: number };
      contentScale?: number;
      edge?: string;
    },
  ];
  "resize-end": [];
  "update:contentScale": [scale: number];
}>();

const slots = useSlots();
const shortcutHintTarget = inject(SHORTCUT_HINT_TARGET_KEY);
const shortcutModifier = shortcutModifierLabel();
const pinShortcutTip = `Pin\n${shortcutModifier}+P`;
const hideShortcutTip = `Hide\n${shortcutModifier}+W`;

/** Local flash class so re-highlighting restarts the CSS animation. */
const flashing = ref(false);
const menuOpen = ref(false);
const settingsOpen = ref(false);
/** Two-step delete when the instance is placed on multiple desks. */
const removeChoiceOpen = ref(false);
/**
 * When set, pin the menu to this point inside the card (right-click).
 * Null keeps the default top-right chrome anchor (⋯ button).
 */
const menuAnchor = ref<{ x: number; y: number } | null>(null);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const settingsEl = ref<HTMLElement | null>(null);
const titleInputEl = ref<HTMLInputElement | null>(null);
const renaming = ref(false);
const draftTitle = ref("");
/** Pointer sits in the card's header band (see `onCardPointerMove`). */
const headerHovered = ref(false);
const chromeFocused = ref(false);
/** Chrome Hide long-press: idle → pressing → armed (eye-off → × morph). */
const hidePressPhase = ref<HidePressPhase>("idle");
/** False while the pointer is dragged off the control (show eye-off again). */
const hidePressOver = ref(true);
/** Press outlived the hint delay: the tip points at the long press. */
const hidePressHinting = ref(false);
let hideArmTimer: ReturnType<typeof setTimeout> | undefined;
let hideHintTimer: ReturnType<typeof setTimeout> | undefined;
const hideBtnEl = ref<HTMLButtonElement | null>(null);

/** Keep pin/hide chrome visible while the tour points at those controls. */
const forceCoachChrome = computed(() => {
  if (props.coachTargets !== true) return false;
  const s = onboardingState.value;
  return (
    s?.status === "active" && (s.step === 7 || s.step === 8 || s.step === 10)
  );
});

/**
 * Hover is tracked by position, not by a hit target: the buttons sit above the
 * band as siblings, so a zone element would fire `pointerleave` the moment the
 * pointer reached one and flicker the chrome away under the cursor.
 */
function onCardPointerMove(event: PointerEvent) {
  const rect = rootEl.value?.getBoundingClientRect();
  if (!rect) return;
  headerHovered.value = isCardHeaderHit(event.clientY, rect.top);
}

/** Top drag strip + pin/⋯ while over the header, overlay open, or × long-press active. */
const chromeVisible = computed(
  () =>
    headerHovered.value ||
    chromeFocused.value ||
    menuOpen.value ||
    settingsOpen.value ||
    renaming.value ||
    hidePressPhase.value !== "idle" ||
    shortcutHinting.value ||
    forceCoachChrome.value,
);

/** Ctrl-hold is scoped to this card, including its compact action menu. */
const shortcutHinting = computed(
  () =>
    shortcutHintTarget?.value?.kind === "widget" &&
    shortcutHintTarget.value.instanceId === props.instanceId,
);

/** Ctrl-hold hints belong to this card only, never every visible widget. */
const shortcutHintVisible = computed(
  () =>
    shortcutHinting.value &&
    !chromeCompact.value,
);

/**
 * Mount chrome for coach-target cards even before hover so the tour can
 * resolve pin/hide targets; opacity stays off until chromeVisible.
 */
const chromeMounted = computed(
  () => props.coachTargets === true || chromeVisible.value,
);

/**
 * Below this width, pin + hide move into the ⋯ menu so the corner chrome
 * does not crowd narrow cards (three 28px buttons + gaps ≈ 90px).
 */
const COMPACT_CHROME_MAX_WIDTH = 150;

/** Measured card width when the host has not locked `width` yet. */
const measuredWidth = ref<number | null>(null);
let widthObserver: ResizeObserver | undefined;

/** True when pin/hide should leave the corner and live in the menu. */
const chromeCompact = computed(() => {
  const w =
    typeof props.width === "number" && Number.isFinite(props.width)
      ? props.width
      : measuredWidth.value;
  return typeof w === "number" && Number.isFinite(w) && w < COMPACT_CHROME_MAX_WIDTH;
});
const chromePositionStyle = useCardChromePosition(rootEl, chromeVisible);

/** True when the host has locked an explicit size (content should fill). */
const hostSized = computed(() => {
  const hasW =
    typeof props.width === "number" && Number.isFinite(props.width);
  if (props.hugHeight) return hasW;
  return (
    hasW &&
    typeof props.height === "number" &&
    Number.isFinite(props.height)
  );
});

/** Resolved body zoom (missing → 1). */
const resolvedContentScale = computed(() =>
  clampContentScale(
    typeof props.contentScale === "number" ? props.contentScale : DEFAULT_CONTENT_SCALE,
  ),
);

/** Which resize handles to show (docks: sides only; else no top). */
const resizeEdges = computed(() =>
  props.hugHeight ? RESIZE_EDGES_HORIZONTAL : RESIZE_EDGES_NO_TOP,
);

/** Inline size when host-owned dimensions are set. */
const sizedStyle = computed(() => {
  if (!hostSized.value) return undefined;
  if (props.hugHeight) {
    return {
      width: `${props.width}px`,
      height: "fit-content",
      minWidth: "0",
      boxSizing: "border-box" as const,
    };
  }
  return {
    width: `${props.width}px`,
    height: `${props.height}px`,
    minWidth: "0",
    boxSizing: "border-box" as const,
  };
});

/**
 * CSS variable for body zoom — title/chrome stay outside the scaled body.
 * Ctrl+wheel and Ctrl+resize both drive this (including flush cards).
 */
const bodyStyle = computed(() => ({
  "--widget-content-scale": String(resolvedContentScale.value),
}));

provide("widgetInstanceId", props.instanceId);
// Which copy of the instance this is, so a widget can answer focus requests
// aimed at the desk and ignore the palette's inline view (and vice versa).
provide("widgetSurface", "desk");
provide("widgetHostSized", hostSized);
// Widgets with fixed-size controls (such as an editor toolbar) can opt out of
// the body zoom without the host needing per-widget behavior.
provide("widgetContentScale", resolvedContentScale);
provide(
  "widgetHostSize",
  computed(() => {
    if (!hostSized.value) return null;
    return {
      width: props.width as number,
      height: props.hugHeight
        ? undefined
        : (props.height as number | undefined),
    };
  }),
);
provide("widgetContentScale", resolvedContentScale);
provide("closeWidgetSettings", () => {
  settingsOpen.value = false;
});
provide("closeWidgetMenu", () => {
  menuOpen.value = false;
});

/** Refcount so multiple open overlays keep click-through paused. */
let overlayPauseDepth = 0;
let overlayPausedHere = false;

/** Pause OS click-through while a menu/settings overlay needs outside clicks. */
function setOverlayClickThrough(paused: boolean) {
  if (paused === overlayPausedHere) return;
  overlayPausedHere = paused;
  if (paused) {
    overlayPauseDepth += 1;
    if (overlayPauseDepth === 1) setClickThroughPaused(true);
  } else {
    overlayPauseDepth = Math.max(0, overlayPauseDepth - 1);
    if (overlayPauseDepth === 0) setClickThroughPaused(false);
  }
}

/** Forward live resize to the host (updates size + center offset + optional scale). */
function onResize(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
  contentScale?: number;
}) {
  emit("resize", payload);
}

/** After resize ends, refresh interactive hit regions. */
function onResizeEnd() {
  emit("resize-end");
  void nextTick().then(() => scheduleRegionSync());
}

let stopContentZoom: (() => void) | undefined;

/**
 * Open the widget menu; closes settings when opening.
 * Pass client coordinates to place it at the cursor (context menu).
 */
function openMenu(at?: { clientX: number; clientY: number }) {
  if (at && rootEl.value) {
    const rect = rootEl.value.getBoundingClientRect();
    menuAnchor.value = {
      x: at.clientX - rect.left,
      y: at.clientY - rect.top,
    };
  } else {
    menuAnchor.value = null;
  }
  menuOpen.value = true;
  settingsOpen.value = false;
}

/** Toggle the ⋯ context menu (always at the default chrome position). */
function toggleMenu() {
  if (menuOpen.value) {
    menuOpen.value = false;
    menuAnchor.value = null;
    removeChoiceOpen.value = false;
    return;
  }
  openMenu();
}

/** Right-click on the header opens the menu at the cursor (no browser menu). */
function onHeaderContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  openMenu({ clientX: event.clientX, clientY: event.clientY });
}

/**
 * Right-click in the body opens the same menu. A widget with a menu of its own
 * (the launcher's icons) prevents the default first, and its menu wins. Inside
 * the open menu or settings nothing opens, so settings do not close under you.
 */
function onCardContextMenu(event: MouseEvent) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const target = event.target as Node;
  if (menuEl.value?.contains(target) || settingsEl.value?.contains(target)) return;
  openMenu({ clientX: event.clientX, clientY: event.clientY });
}

/** Inline position when the menu was opened via right-click. */
const menuPositionStyle = computed(() => {
  const at = menuAnchor.value;
  if (!at) return undefined;
  return {
    top: `${at.y}px`,
    left: `${at.x}px`,
    right: "auto",
  };
});

/** Forward pointerdown so the host can start a drag from the top strip only. */
function onMovePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  emit("move-pointerdown", event);
}

/**
 * Cover-style widgets: start move from anywhere on the card except
 * resize handles, pin/menu chrome, and open popovers.
 * The card root itself is `data-interactive` for click-through — ignore that.
 */
function onCardPointerDown(event: PointerEvent) {
  if (!props.fullDrag) return;
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const interactive = target.closest("[data-interactive]");
  if (interactive && interactive !== rootEl.value) return;
  onMovePointerDown(event);
}

/** Close menu and open the settings popover when available. */
function openSettings() {
  menuOpen.value = false;
  if (props.hasSettings) settingsOpen.value = true;
}

/** Open the host-owned About dialog for this extension. */
function onAbout() {
  menuOpen.value = false;
  removeChoiceOpen.value = false;
  emit("about");
}

/** Close the menu before moving the live widget into its share presentation. */
function onShare() {
  menuOpen.value = false;
  removeChoiceOpen.value = false;
  triggerEl.value?.focus();
  emit("share");
}

/** Hand this widget's package back to the Wizard; close the menu first. */
function onEditInWizard() {
  menuOpen.value = false;
  removeChoiceOpen.value = false;
  emit("edit-in-wizard");
}

/** Emit duplicate and close the menu. */
function onDuplicate() {
  menuOpen.value = false;
  emit("duplicate");
}

/** Hand this widget over to the palette panel; close overlays first. */
function onMoveToPanel() {
  menuOpen.value = false;
  settingsOpen.value = false;
  emit("move-to-panel");
}

/** Soft-hide this widget (chrome × or menu); close overlays first. */
function onHide() {
  menuOpen.value = false;
  settingsOpen.value = false;
  emit("hide");
}

/** Clear the × long-press timer and return to idle (× icon). */
function resetHidePress() {
  if (hideArmTimer !== undefined) {
    clearTimeout(hideArmTimer);
    hideArmTimer = undefined;
  }
  if (hideHintTimer !== undefined) {
    clearTimeout(hideHintTimer);
    hideHintTimer = undefined;
  }
  hidePressPhase.value = "idle";
  hidePressOver.value = true;
  hidePressHinting.value = false;
  hideBtnEl.value = null;
}

/** True when the event position is still over the hide/delete control. */
function isPointerOverHideControl(event: PointerEvent): boolean {
  const btn = hideBtnEl.value;
  if (!btn) return false;
  const el = document.elementFromPoint(event.clientX, event.clientY);
  return el === btn || Boolean(el && btn.contains(el));
}

/** Track drag-off so × morph / ring only show while the pointer stays on the control. */
function onHidePointerMove(event: PointerEvent) {
  if (hidePressPhase.value === "idle") return;
  hidePressOver.value = isPointerOverHideControl(event);
}

/**
 * Start Hide long-press: arm after the hold delay (morph to ×). Capture so
 * drag-off still delivers pointerup to this control.
 */
function onHidePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget as HTMLButtonElement;
  hideBtnEl.value = btn;
  btn.setPointerCapture(event.pointerId);
  hidePressOver.value = true;
  hidePressHinting.value = false;
  hidePressPhase.value = "pressing";
  if (hideArmTimer !== undefined) clearTimeout(hideArmTimer);
  hideArmTimer = setTimeout(() => {
    if (hidePressPhase.value === "pressing") {
      hidePressPhase.value = "armed";
    }
  }, HIDE_PRESS_ARM_MS);
  // Tip-only nudge well before the arm delay, so the gesture is discoverable
  // without a click-and-release ever seeing it.
  if (hideHintTimer !== undefined) clearTimeout(hideHintTimer);
  hideHintTimer = setTimeout(() => {
    if (hidePressPhase.value === "pressing") {
      hidePressHinting.value = true;
    }
  }, HIDE_PRESS_HINT_MS);
}

/** End × press: short → hide, armed on control → delete, otherwise cancel. */
function onHidePointerUp(event: PointerEvent) {
  if (hidePressPhase.value === "idle") return;
  const phase = hidePressPhase.value;
  const onControl = isPointerOverHideControl(event);
  const btn = hideBtnEl.value;
  if (btn?.hasPointerCapture(event.pointerId)) {
    btn.releasePointerCapture(event.pointerId);
  }
  resetHidePress();
  const action = resolveHidePressRelease(phase, onControl);
  if (action === "hide") onHide();
  else if (action === "remove") onRemove();
}

/** Abort × long-press without hide/delete. */
function onHidePointerCancel() {
  resetHidePress();
}

/** Toggle pin from the compact menu; keep the menu open so pressed state stays visible. */
function onTogglePin() {
  emit("toggle-pin");
}

/** Ask for inline confirmation before deleting; shared widgets then offer the scope. */
function onRemove() {
  // Keep the menu open so the confirmation stays anchored to the action.
  menuOpen.value = true;
  removeChoiceOpen.value = true;
}

/** Leave the menu open when a one-widget deletion is cancelled. */
function cancelRemove() {
  removeChoiceOpen.value = false;
}

/** Remove placement from the active desk only (catalog kept when shared). */
function onRemoveThisDesk() {
  menuOpen.value = false;
  removeChoiceOpen.value = false;
  emit("remove", "desk");
}

/** Delete from every desk and dispose the widget's content. */
function onRemoveAllDesks() {
  menuOpen.value = false;
  removeChoiceOpen.value = false;
  emit("remove", "everywhere");
}

/** Restore a hidden title and close the menu. */
function onShowTitle() {
  menuOpen.value = false;
  emit("update:hideTitle", false);
}

/** Start inline title edit on double-click. */
async function startRename() {
  if (renaming.value) return;
  menuOpen.value = false;
  settingsOpen.value = false;
  draftTitle.value = props.title;
  renaming.value = true;
  await nextTick();
  titleInputEl.value?.focus();
  titleInputEl.value?.select();
}

/** Persist trimmed title (empty clears custom title) and exit edit mode. */
function commitRename() {
  if (!renaming.value) return;
  const trimmed = draftTitle.value.trim();
  renaming.value = false;
  emit("rename", trimmed.length > 0 ? trimmed : undefined);
}

/** Tab may move to Hide title without ending the edit before its button activates. */
function onTitleEditorFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node &&
      (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
  commitRename();
}

function hideTitleFromEditor() {
  commitRename();
  emit("update:hideTitle", true);
  rootEl.value?.focus({ preventScroll: true });
}

/** Abort rename without emitting. */
function cancelRename() {
  renaming.value = false;
}

/** Handle Enter / Escape while the title input is focused. */
function onTitleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    commitRename();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelRename();
  }
}

/** Close menu/settings when pointer lands outside the open overlay (not the whole card). */
function onDocPointerDown(e: PointerEvent) {
  const target = e.target as Node;
  if (
    menuOpen.value &&
    !menuEl.value?.contains(target) &&
    !triggerEl.value?.contains(target)
  ) {
    menuOpen.value = false;
  }
  if (settingsOpen.value && !settingsEl.value?.contains(target)) {
    settingsOpen.value = false;
  }
}

/** Escape closes overlays / cancels × long-press and stops further handlers. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (renaming.value) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (hidePressPhase.value !== "idle") {
    resetHidePress();
    return;
  }
  menuOpen.value = false;
  settingsOpen.value = false;
}

/** Only pay capture-phase cost while an overlay actually needs outside dismiss. */
let docListening = false;

/** Attach/detach document listeners when menu, settings, or × long-press need them. */
function syncDocListeners() {
  const need =
    menuOpen.value || settingsOpen.value || hidePressPhase.value !== "idle";
  if (need === docListening) return;
  if (need) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKeydown, true);
  }
  docListening = need;
}

/** Pause click-through while an overlay needs outside-click dismissal. */
watch([menuOpen, settingsOpen, renaming, hidePressPhase], () => {
  if (!menuOpen.value) {
    removeChoiceOpen.value = false;
    menuAnchor.value = null;
  }
  setOverlayClickThrough(menuOpen.value || settingsOpen.value);
  syncDocListeners();
});

/** Re-report interactive rects after outside chrome mounts or unmounts. */
watch(chromeVisible, async () => {
  await nextTick();
  scheduleRegionSync();
});

/** Compact mode swaps pin/hide between chrome and menu — refresh hit regions. */
watch(chromeCompact, async () => {
  await nextTick();
  scheduleRegionSync();
});

/**
 * Widgets may opt into `kavibay:focus-widget` to focus their entry point.
 * This is the host fallback so every opened widget still receives DOM focus.
 */
function onKavibayFocusWidget(event: Event) {
  // "desk": a request aimed at the palette's inline copy of this same instance
  // must not pull focus onto the card sitting behind it.
  if (!widgetFocusRequestMatches(event, props.instanceId, "desk")) return;
  void nextTick().then(() => {
    const root = rootEl.value;
    // Child widgets register first and get first refusal for a focused control.
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
  });
}

/** Register drag overhang, Ctrl+wheel zoom, and width observer for compact chrome. */
onMounted(() => {
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  void nextTick().then(() => {
    scheduleRegionSync();
    if (rootEl.value) {
      stopContentZoom = installContentZoom(
        rootEl.value,
        () => resolvedContentScale.value,
        (scale) => emit("update:contentScale", scale),
      );
    }
    if (rootEl.value && typeof ResizeObserver !== "undefined") {
      widthObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        measuredWidth.value = entry.contentRect.width;
      });
      widthObserver.observe(rootEl.value);
      measuredWidth.value = rootEl.value.getBoundingClientRect().width;
    }
  });
});

onUnmounted(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  stopContentZoom?.();
  widthObserver?.disconnect();
  widthObserver = undefined;
  resetHidePress();
  setOverlayClickThrough(false);
  if (docListening) {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onKeydown, true);
    docListening = false;
  }
});

/** Restart the border flash whenever the host requests a highlight. */
watch(
  () => props.highlighted,
  async (on) => {
    if (!on) {
      flashing.value = false;
      return;
    }
    flashing.value = false;
    await nextTick();
    flashing.value = true;
  },
);
</script>

<template>
  <div
    ref="rootEl"
    class="widget-card"
    tabindex="-1"
    :class="{
      'widget-card--menu-open': menuOpen || settingsOpen || renaming || hidePressPhase !== 'idle',
      'widget-card--flush': flush,
      'widget-card--compact': compact,
      'widget-card--flash': flashing,
      'widget-card--preview': previewed,
      'widget-card--sized': hostSized,
      'widget-card--playground': playground,
      'widget-card--hug-height': hugHeight,
      'widget-card--full-drag': fullDrag,
      'widget-card--opaque': opaque,
    }"
    :style="[sizedStyle, cardVars, chromePositionStyle]"
    @pointerenter="onCardPointerMove"
    @pointermove="onCardPointerMove"
    @pointerleave="headerHovered = false"
    @pointerdown="onCardPointerDown"
    @contextmenu="onCardContextMenu"
  >
    <!-- Glass layer only — keeps backdrop-filter from clipping outside chrome. -->
    <div class="widget-card-surface" :style="surfaceVars" aria-hidden="true" />
    <ResizeEdges
      v-if="resizable"
      :width="width"
      :height="height"
      :content-scale="resolvedContentScale"
      :measure-el="rootEl"
      :lock-square="lockSquare"
      :edges="resizeEdges"
      :coach-targets="coachTargets"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <!--
      Always mounted (not hover-gated): click-through only enables [data-interactive]
      rects, so the 12px overhang must exist before hover or it is never hittable.
      Visually invisible — grab cursor only.
    -->
    <div
      class="widget-card-drag"
      data-interactive
      :data-onboarding-target="coachTargets ? 'widget-drag' : undefined"
      role="button"
      aria-label="Move widget"
      @pointerdown.stop="onMovePointerDown"
      @contextmenu="onHeaderContextMenu"
    />
    <div
      v-if="chromeMounted"
      class="widget-card-chrome"
      :class="{
        'card-chrome-reveal': chromeVisible,
        'widget-card-chrome--dormant': !chromeVisible,
        'widget-card-chrome--coach': forceCoachChrome,
      }"
      :data-interactive="chromeVisible ? '' : undefined"
      @pointerdown.stop
      @focusin="chromeFocused = true"
      @focusout="chromeFocused = false"
      @contextmenu="onHeaderContextMenu"
    >
      <button
        v-if="!chromeCompact || coachTargets"
        type="button"
        class="widget-card-chrome-btn"
        :class="{ 'widget-card-chrome-btn--pin-on': pinned }"
        :data-onboarding-target="coachTargets ? 'widget-pin' : undefined"
        v-tip="shortcutHinting ? pinShortcutTip : 'Pin'"
        aria-label="Toggle pin"
        :aria-pressed="pinned"
        @click.stop="emit('toggle-pin')"
      >
        <PinIcon :active="pinned" />
        <span v-if="shortcutHintVisible" class="widget-card-shortcut-hint" aria-hidden="true">
          <span>Pin</span>
          <span>{{ shortcutModifier }}+P</span>
        </span>
      </button>
      <button
        ref="triggerEl"
        type="button"
        class="widget-card-chrome-btn"
        v-tip="'Widget menu'"
        aria-label="Widget menu"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click.stop="toggleMenu"
      >
        ⋯
      </button>
      <button
        v-if="!chromeCompact || coachTargets"
        type="button"
        class="widget-card-chrome-btn"
        :class="{
          'widget-card-chrome-btn--pressing':
            hidePressPhase === 'pressing' && hidePressOver,
          'widget-card-chrome-btn--armed-remove':
            hidePressPhase === 'armed' && hidePressOver,
          'widget-card-chrome-btn--coach-hide':
            forceCoachChrome &&
            (onboardingState?.step === 8 || onboardingState?.step === 10),
        }"
        :style="{ '--hide-press-arm-ms': `${HIDE_PRESS_ARM_MS}ms` }"
        :data-onboarding-target="coachTargets ? 'widget-hide' : undefined"
        v-tip="
          shortcutHinting
            ? hideShortcutTip
            : hidePressTipLabel(hidePressPhase, hidePressOver, hidePressHinting)
        "
        :aria-label="
          hidePressPhase === 'armed' && hidePressOver ? 'Delete widget' : 'Hide widget'
        "
        @pointerdown.stop="onHidePointerDown"
        @pointermove.stop="onHidePointerMove"
        @pointerup.stop="onHidePointerUp"
        @pointercancel.stop="onHidePointerCancel"
      >
        <!-- 1px border arc: stroke draws clockwise from top over the arm delay. -->
        <svg
          v-if="
            (hidePressPhase === 'pressing' || hidePressPhase === 'armed') && hidePressOver
          "
          class="widget-card-chrome-press-ring"
          viewBox="0 0 28 28"
          aria-hidden="true"
        >
          <rect
            class="widget-card-chrome-press-ring-path"
            x="0.5"
            y="0.5"
            width="27"
            height="27"
            rx="7.5"
            ry="7.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            pathLength="100"
            stroke-linecap="round"
          />
        </svg>
        <!-- Armed long-press → Remove (×); else Hide: open eye → eye-off on hover. -->
        <svg
          v-if="hidePressPhase === 'armed' && hidePressOver"
          class="widget-card-chrome-action-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            d="M18 6L6 18M6 6l12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else
          class="widget-card-chrome-action-icon widget-card-chrome-action-icon--eye"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <g class="widget-card-chrome-eye-open">
            <path
              d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
          </g>
          <g class="widget-card-chrome-eye-off">
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <line
              x1="1"
              y1="1"
              x2="23"
              y2="23"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </g>
        </svg>
        <span v-if="shortcutHintVisible" class="widget-card-shortcut-hint" aria-hidden="true">
          <span>Hide</span>
          <span>{{ shortcutModifier }}+W</span>
        </span>
      </button>
    </div>

    <div
      v-if="menuOpen"
      ref="menuEl"
      class="widget-context-menu"
      :style="menuPositionStyle"
      data-interactive
      role="menu"
      @pointerdown.stop
    >
      <!-- Host actions are labeled rows so their effects are clear at a glance. -->
      <div class="widget-menu-toolbar widget-menu-toolbar--actions" role="group" aria-label="Widget actions">
        <button
          v-if="chromeCompact"
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          :class="{ 'widget-menu-tool--active': pinned }"
          v-tip="shortcutHinting ? pinShortcutTip : 'Pin'"
          aria-label="Toggle pin"
          :aria-pressed="pinned"
          @click="onTogglePin"
        >
          <PinIcon class="widget-menu-tool-icon" :active="pinned" />
          {{ pinned ? "Unpin" : "Pin" }}
        </button>
        <button
          v-if="allowDuplicate"
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="Duplicate"
          @click="onDuplicate"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
            <path
              d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
          </svg>
          Duplicate
        </button>
        <!-- Counterpart to the palette panel's ↗ pop-out: same widget, other surface. -->
        <button
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          v-tip="'Move this widget into the palette panel'"
          aria-label="Move to main panel"
          data-icon-motion
          @click="onMoveToPanel"
        >
          <SquareArrowDownRightIcon class="widget-menu-tool-icon" :size="16" animated />
          Move to main panel
        </button>
        <button
          v-if="hideTitle"
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="Show title"
          @click="onShowTitle"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7V4h16v3M9 20h6M12 4v16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Show title
        </button>
        <button
          v-if="!removeChoiceOpen"
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled widget-menu-tool--danger"
          aria-label="Delete widget"
          @click="onRemove"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Delete widget
        </button>
        <div
          v-else-if="!multiDeskRemove"
          class="widget-menu-delete-confirm"
          role="group"
          aria-label="Confirm delete widget"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Confirm</span>
          <button type="button" aria-label="Cancel delete" @click="cancelRemove">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M18 6L6 18M6 6l12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            class="widget-menu-delete-confirm-action"
            aria-label="Confirm delete widget"
            @click="onRemoveAllDesks"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <button
          v-if="chromeCompact"
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="Hide widget"
          @click="onHide"
        >
          <svg
            class="widget-menu-tool-icon widget-menu-tool-icon--eye"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <g class="widget-card-chrome-eye-open">
              <path
                d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
            </g>
            <g class="widget-card-chrome-eye-off">
              <path
                d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <line
                x1="1"
                y1="1"
                x2="23"
                y2="23"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </g>
          </svg>
          Hide widget
        </button>
      </div>
      <!-- Settings on its own row when the widget has a settings panel. -->
      <div
        v-if="hasSettings && slots.settings"
        class="widget-menu-toolbar widget-menu-toolbar--settings"
        role="group"
        aria-label="Widget settings"
      >
        <button
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="Settings"
          @click="openSettings"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
          Settings
        </button>
      </div>
      <div
        v-if="canShare"
        class="widget-menu-toolbar widget-menu-toolbar--settings"
        role="group"
        aria-label="Widget sharing"
      >
        <button
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          @click="onShare"
        >
          <IconBase class="widget-menu-tool-icon" :size="16">
            <path d="M12 16V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </IconBase>
          Share
        </button>
      </div>
      <div
        v-if="canEditInWizard"
        class="widget-menu-toolbar widget-menu-toolbar--settings"
        role="group"
        aria-label="Widget authoring"
      >
        <button
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="Edit in Wizard"
          @click="onEditInWizard"
        >
          <SparklesIcon class="widget-menu-tool-icon" :size="16" />
          Edit in Wizard
        </button>
      </div>
      <div
        v-if="hasAbout"
        class="widget-menu-toolbar widget-menu-toolbar--settings"
        role="group"
        aria-label="Widget information"
      >
        <button
          type="button"
          role="menuitem"
          class="widget-menu-tool widget-menu-tool--labeled"
          aria-label="About"
          @click="onAbout"
        >
          <svg class="widget-menu-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M12 11v6M12 7h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          About
        </button>
      </div>
      <!-- Placed on several desks: take it off this one vs delete it for good. -->
      <template v-if="removeChoiceOpen && multiDeskRemove">
        <div class="widget-menu-sep" role="separator" />
        <p class="widget-menu-heading">On multiple desks</p>
        <button type="button" role="menuitem" class="widget-menu-item" @click="onRemoveThisDesk">
          Remove from this desk
        </button>
        <button
          type="button"
          role="menuitem"
          class="widget-menu-item widget-menu-item--danger"
          @click="onRemoveAllDesks"
        >
          <span class="widget-menu-item-stack">
            <span>Delete everywhere</span>
            <span class="widget-menu-item-note">Also deletes its content</span>
          </span>
        </button>
      </template>
      <template v-if="slots.menu">
        <div class="widget-menu-sep" role="separator" />
        <div class="widget-menu-extras">
          <slot name="menu" />
        </div>
      </template>
    </div>

    <div
      v-if="hasSettings && settingsOpen"
      ref="settingsEl"
      class="widget-settings-popover"
      data-interactive
      @pointerdown.stop
    >
      <slot name="settings" />
    </div>

    <div
      v-if="renaming"
      class="widget-card-title-editor"
      @pointerdown.stop
      @focusout="onTitleEditorFocusOut"
      @keydown.esc.stop.prevent="cancelRename"
    >
      <input
        ref="titleInputEl"
        v-model="draftTitle"
        class="widget-card-title-input"
        type="text"
        aria-label="Widget title"
        @keydown="onTitleKeydown"
      />
      <button
        type="button"
        class="widget-card-title-hide"
        @pointerdown.prevent
        @click.stop="hideTitleFromEditor"
      >Hide title</button>
    </div>
    <p
      v-else-if="!hideTitle"
      class="widget-card-title"
      @pointerdown.stop
      @dblclick.stop="startRename"
      @contextmenu="onHeaderContextMenu"
    >
      {{ title }}
    </p>
    <div class="widget-card-body" :style="bodyStyle">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.widget-card {
  position: relative;
  isolation: isolate;
  min-width: 80px;
  padding: 14px 16px;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  color: rgba(var(--fg-rgb), 0.92);
}

/* Visual glass on an inner layer so abspos chrome can overhang without clipping. */
.widget-card-surface {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
  corner-shape: inherit;
  background:
    var(--surface-sheen, linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0))),
    rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72));
  border: 1px solid var(--surface-border, var(--border));
  box-shadow: var(--surface-box-shadow), var(--surface-inner-highlight, 0 0 transparent);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
}

/*
  Opaque widgets: the same surface, with the glass taken out of it.

  Done by overriding `--surface-alpha` on the card rather than by giving this
  case its own background, so the sheen, the border, the inner highlight, the
  shadow and both colour modes stay the one definition above. The backdrop
  filter goes with it: blurring what is behind a ground nothing can see through
  costs a compositor layer to produce no pixels.
*/
.widget-card--opaque {
  --surface-alpha: 1;
  --surface-backdrop-filter: none;
}

/* Privacy covers etc.: drag from anywhere; edge handles still resize. */
.widget-card--full-drag {
  cursor: grab;
}

.widget-card--full-drag:active {
  cursor: grabbing;
}

/* 24px strip (12px outside + 12px inside) — invisible hit target, grab cursor only. */
.widget-card-drag {
  position: absolute;
  top: -12px;
  left: 0;
  right: 0;
  z-index: 3;
  height: 24px;
  border-radius: var(--surface-radius, 16px) var(--surface-radius, 16px) 0 0;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  cursor: grab;
  touch-action: none;
}

.widget-card-drag:active {
  cursor: grabbing;
}

/* Outside, aligned to the right edge. Bottom padding bridges hover/click-through. */
.widget-card-chrome {
  position: absolute;
  top: var(--card-chrome-top, -40px);
  right: 0;
  z-index: 3;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 10px;
  border-radius: 10px;
}

.widget-card-chrome::before {
  content: "";
  position: absolute;
  inset: 0 0 8px;
  z-index: -1;
  border-radius: inherit;
  background: rgba(var(--surface-bg-rgb), 0.85);
}

/* In DOM for coach targeting, but not interactive/visible until hover or tour. */
.widget-card-chrome--dormant {
  opacity: 0;
  pointer-events: none;
}

/* Tour steps that teach pin/hide — keep chrome readable without hover. */
.widget-card-chrome--coach {
  opacity: 1;
  pointer-events: auto;
}

.widget-card-chrome--coach .widget-card-chrome-btn {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.1);
}

.widget-card-chrome-btn--coach-hide {
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.16);
  outline: 1px dashed rgba(var(--fg-rgb), 0.45);
  outline-offset: 1px;
}

.widget-card-chrome-btn {
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Keyboard chord hint shown above the active card's pin/hide controls. */
.widget-card-shortcut-hint {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  bottom: calc(100% + 6px);
  left: 50%;
  z-index: 5;
  padding: 4px 7px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 6px;
  background: rgba(var(--surface-bg-rgb), 0.96);
  box-shadow: 0 6px 16px rgba(var(--shadow-rgb), 0.32);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
}

/* Let the shared hover/focus tooltip own the same label while the pointer is
   already on the control; the always-visible hint covers the non-hover case. */
.widget-card-chrome-btn:hover .widget-card-shortcut-hint,
.widget-card-chrome-btn:focus-visible .widget-card-shortcut-hint {
  display: none;
}

.widget-card-chrome-btn:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.92);
}

.widget-card-chrome-btn--pin-on {
  color: rgba(var(--fg-rgb), 0.85);
}

/* Hold progress: 1px red border arc draws from the top over the arm delay. */
.widget-card-chrome-btn--pressing,
.widget-card-chrome-btn--armed-remove {
  position: relative;
}

.widget-card-chrome-press-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  color: #e07a5f;
  z-index: 0;
  /* Rotate so stroke-dash progress begins at 12 o'clock. */
  transform: rotate(-90deg);
}

.widget-card-chrome-press-ring-path {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
}

.widget-card-chrome-btn--pressing .widget-card-chrome-press-ring-path {
  animation: widget-hide-press-ring var(--hide-press-arm-ms, 750ms) linear forwards;
}

.widget-card-chrome-btn--armed-remove .widget-card-chrome-press-ring-path {
  stroke-dashoffset: 0;
}

.widget-card-chrome-action-icon {
  position: relative;
  z-index: 1;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

/* Hide affordance: slightly smaller than × / other chrome icons. */
.widget-card-chrome-action-icon--eye {
  width: 12px;
  height: 12px;
}

.widget-card-chrome-eye-off {
  opacity: 0;
}

.widget-card-chrome-btn:hover .widget-card-chrome-eye-open,
.widget-card-chrome-btn:focus-visible .widget-card-chrome-eye-open,
.widget-menu-tool:hover .widget-card-chrome-eye-open,
.widget-menu-tool:focus-visible .widget-card-chrome-eye-open {
  opacity: 0;
}

.widget-card-chrome-btn:hover .widget-card-chrome-eye-off,
.widget-card-chrome-btn:focus-visible .widget-card-chrome-eye-off,
.widget-menu-tool:hover .widget-card-chrome-eye-off,
.widget-menu-tool:focus-visible .widget-card-chrome-eye-off {
  opacity: 1;
}

.widget-menu-tool-icon--eye {
  width: 13px;
  height: 13px;
}

/* Armed: red × only — no red background fill. */
.widget-card-chrome-btn--armed-remove {
  color: #e07a5f;
  background: transparent;
  animation: widget-hide-arm-pulse 0.22s ease-out;
}

.widget-card-chrome-btn--armed-remove:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: #e07a5f;
}

@keyframes widget-hide-press-ring {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes widget-hide-arm-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}

/* Search-result ping: soft accent ring that fades out (on the glass layer). */
.widget-card--flash .widget-card-surface {
  animation: widget-search-flash 0.9s ease-out forwards;
}

/* Palette ↑/↓ selection: same ring as the flash, held while the row is active. */
.widget-card--preview:not(.widget-card--flash) .widget-card-surface {
  border-color: rgba(120, 180, 255, 0.55);
  outline: 1px solid rgba(120, 180, 255, 0.35);
  outline-offset: 2px;
  box-shadow:
    0 0 0 1px rgba(120, 180, 255, 0.2),
    0 0 16px 2px rgba(120, 180, 255, 0.18),
    var(--surface-box-shadow),
    var(--surface-inner-highlight, 0 0 transparent);
}

@keyframes widget-search-flash {
  0%,
  30% {
    border-color: rgba(120, 180, 255, 0.55);
    outline: 1px solid rgba(120, 180, 255, 0.35);
    outline-offset: 2px;
    box-shadow:
      0 0 0 1px rgba(120, 180, 255, 0.2),
      0 0 16px 2px rgba(120, 180, 255, 0.22),
      0 8px 24px rgba(var(--shadow-rgb), calc(0.35 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  }
  100% {
    border-color: rgba(var(--fg-rgb), 0.1);
    outline: 1px solid transparent;
    outline-offset: 2px;
    box-shadow: var(--surface-box-shadow);
  }
}

.widget-card--compact {
  min-width: 0;
  padding: 10px;
  width: fit-content;
  max-width: 100%;
}

/*
 * Playground: even chrome pad; title stays in normal flow so the playfield
 * sits below the widget header. Body fills the rest with no L/R gutters.
 * Keep overflow visible on the card — ResizeEdges handles sit slightly outside.
 */
.widget-card.widget-card--playground,
.widget-card.widget-card--playground.widget-card--compact {
  padding: 8px;
  min-width: 0;
}

.widget-card--playground.widget-card--sized {
  display: flex;
  flex-direction: column;
}

.widget-card--playground.widget-card--sized .widget-card-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  border-radius: calc(var(--surface-radius, 16px) - 8px);
  corner-shape: var(--surface-corner-shape, round);
}

/* Pin the widget root so the LCD fills the body under the title. */
.widget-card--playground.widget-card--sized .widget-card-body > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}

.widget-card-title {
  position: relative;
  z-index: 1;
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
  cursor: text;
}

.widget-card-title-editor {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  margin: 0 0 8px;
  padding: 4px;
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
}

.widget-card-title-editor:focus-within {
  border-color: rgba(var(--fg-rgb), 0.35);
}

.widget-card-title-input {
  flex: 1 1 80px;
  min-width: 0;
  max-width: 100%;
  width: 0;
  padding: 6px 8px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.85);
  outline: none;
  cursor: text;
  user-select: text;
}

.widget-card-title-hide {
  flex: 0 1 auto;
  max-width: 100%;
  margin-left: auto;
  padding: 5px 7px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 5px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.65);
  font-family: inherit;
  font-size: 10px;
  line-height: 1.2;
  cursor: pointer;
}

.widget-card-title-hide:hover {
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.95);
}

.widget-card-title-hide:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.65);
  outline-offset: 2px;
}

.widget-card-body {
  position: relative;
  z-index: 1;
  font-size: 14px;
  /* Ctrl+resize zoom; also exposed as --widget-content-scale for widgets. */
  zoom: var(--widget-content-scale, 1);
}

/* Host-owned size: column layout so the body fills remaining height.
 * Do not clip the card — ResizeEdges hit targets sit a few px outside. */
.widget-card--sized {
  display: flex;
  flex-direction: column;
}

.widget-card--sized .widget-card-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Let the extension root fill the body so content can grow with the card. */
.widget-card--sized .widget-card-body > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

/* Dock cards: do not stretch the body below the icon row. */
.widget-card--hug-height.widget-card--sized .widget-card-body,
.widget-card--hug-height.widget-card--sized .widget-card-body > * {
  flex: 0 0 auto;
}

.widget-card--flush {
  min-width: 0;
  padding: 0;
}

.widget-card--flush .widget-card-title,
.widget-card--flush .widget-card-title-editor {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  margin: 0;
  box-sizing: border-box;
}

.widget-card--flush .widget-card-title {
  padding: 10px 12px;
  /* Keep the title gradient from squaring off the image's top-left corner. */
  border-top-left-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
}

.widget-card--flush .widget-card-title-editor {
  top: 8px;
  left: 8px;
  right: 8px;
  width: auto;
}

.widget-card--flush .widget-card-body {
  position: relative;
  line-height: 0;
  overflow: hidden;
  border-radius: inherit;
  /* Match card geometry — radius alone leaves a dark frame when corner-shape is squircle. */
  corner-shape: inherit;
}

/* Edge-to-edge fill when the host owns the card size (Image, Redacted, …). */
.widget-card--flush.widget-card--sized .widget-card-body > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}

.widget-context-menu {
  position: absolute;
  top: calc(var(--card-chrome-top, -40px) + 44px);
  right: 0;
  z-index: 10;
  min-width: 0;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: visible;
}

/* Host actions are rows; Settings and About use the same labeled treatment. */
.widget-menu-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.widget-menu-toolbar--actions {
  align-items: stretch;
  flex-direction: column;
  min-width: 148px;
}

.widget-menu-toolbar--actions .widget-menu-tool--labeled {
  width: 100%;
  justify-content: flex-start;
}

.widget-menu-toolbar--settings {
  justify-content: stretch;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.1);
}

.widget-menu-toolbar--settings .widget-menu-tool--labeled {
  flex: 1 1 auto;
  width: 100%;
  justify-content: flex-start;
}

.widget-menu-tool {
  position: relative;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.75);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/*
 * One line each. The menu is sized against the room left in the card, so in a
 * narrow card a label would wrap, and a button centers its wrapped lines.
 */
.widget-menu-tool--labeled {
  width: auto;
  height: 30px;
  padding: 0 8px;
  gap: 8px;
  white-space: nowrap;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.9);
}

/* The destructive row swaps in place, keeping confirmation close to its action. */
.widget-menu-delete-confirm {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) 22px 22px;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 4px 0 8px;
  border-radius: 8px;
  background: rgba(224, 122, 95, 0.14);
  box-shadow: inset 0 0 0 1px rgba(224, 122, 95, 0.1);
  color: #e07a5f;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.widget-menu-delete-confirm span {
  min-width: 0;
}

.widget-menu-delete-confirm button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.85);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.widget-menu-delete-confirm button svg {
  width: 13px;
  height: 13px;
}

.widget-menu-delete-confirm button:hover,
.widget-menu-delete-confirm button:focus-visible {
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--fg-rgb), 0.14);
}

.widget-menu-delete-confirm .widget-menu-delete-confirm-action {
  border-color: transparent;
  background: #e07a5f;
  color: #251c1b;
  font-weight: 700;
}

.widget-menu-delete-confirm .widget-menu-delete-confirm-action:hover,
.widget-menu-delete-confirm .widget-menu-delete-confirm-action:focus-visible {
  background: #ee9279;
}

.widget-menu-tool:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.95);
}

.widget-menu-tool--active {
  color: rgba(var(--fg-rgb), 0.95);
}

.widget-menu-tool--danger {
  color: #e07a5f;
}

.widget-menu-tool--danger:hover {
  background: rgba(224, 122, 95, 0.14);
  color: #e07a5f;
}

.widget-menu-tool-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

/* Extension #menu slot: labeled rows under the toolbar. */
.widget-menu-extras {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 148px;
}

.widget-menu-sep {
  height: 1px;
  margin: 4px 4px;
  background: rgba(var(--fg-rgb), 0.1);
}

.widget-menu-heading {
  margin: 2px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.widget-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.widget-menu-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.widget-menu-item--danger {
  color: #e07a5f;
}

/* Two-line menu item: label plus the consequence spelled out underneath. */
.widget-menu-item-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.widget-menu-item-note {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.widget-menu-item--danger:hover {
  background: rgba(224, 122, 95, 0.14);
}

.widget-settings-popover {
  position: absolute;
  top: calc(var(--card-chrome-top, -40px) + 44px);
  right: 0;
  z-index: 10;
  min-width: 220px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
}
</style>
