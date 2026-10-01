<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  useHost,
  watch,
} from "vue";
import type { WidgetInstance } from "@sdk/contract/sdk";
import { WIDGET_FOCUS_EVENT, type WidgetSurface } from "@sdk";
import { useWidgetRuntime } from "../../app/extension-host/useWidgetRuntime";
import BrokenWidget from "../../app/extension-host/ui/BrokenWidget.vue";
import WidgetSkeleton from "../../app/extension-host/ui/WidgetSkeleton.vue";
import WidgetError from "../../app/extension-host/ui/WidgetError.vue";
import WidgetCard from "../../app/host/WidgetCard.vue";
import { initialSizeForExtension } from "../../app/extensions/initialSize";
import { embedWidget } from "./catalog";
import { embedDefinitionId, embedHost } from "./embedHost";
import { nextStackOrder } from "./stacking";
import { useDragOffset } from "./useDragOffset";
import { demoScript } from "./demoScripts";
import { demoInProgress } from "../demo/demoRun";

import { isPaletteOpenEvent, opensWidget, PALETTE_OPEN_EVENT } from "../palette/paletteOpen";

/**
 * One shipping widget, in a browser, in the app's own card.
 *
 * Every part of what the visitor sees is the app's: `WidgetCard.vue` draws the
 * chrome, `useWidgetRuntime` builds the `WidgetContext` and resolves the gate,
 * and the widget's own `view.ts` component renders the model. This file is
 * wiring — it owns no markup a widget could be judged by.
 *
 * WHY NOT `WidgetGate.vue`, WHICH DOES EXACTLY THIS IN THE APP:
 *
 * It imports `widgetViews.ts`, which is built from `bundledExtensions.ts` —
 * the eager glob that pulls all 32 extensions and about a megabyte of tiptap
 * into whatever imports it. `scripts/embedImportGuard.assert.mjs` refuses that
 * reach. So the phase branches below are the gate's, transcribed, minus the
 * two this page cannot reach: `provider` and `unconfigured` never occur,
 * because a widget needing either fails `catalog.ts`'s admission rule.
 *
 * WHAT THE HOST DOES NOT DO HERE:
 *
 * A desk owns persistence, focus, desks and undo. This element owns none of
 * that. What it does own is the two gestures the card offers handles for —
 * resize and move — because a visible handle that does nothing reads as a bug,
 * and a card that cannot be picked up does not show what a desk feels like.
 * Pin, rename and remove stay the desk's and are switched off through the
 * card's own props rather than by giving it a fake host.
 *
 * Dragging is in-memory: reload and the page is arranged as authored. A
 * marketing page remembering where a visitor left a card is a promise this
 * package should not make.
 */
/**
 * The host element's attributes stay on the host.
 *
 * Vue passes a component's non-prop attributes to its root element, and for a
 * custom element that root is the shipping `WidgetCard`. Measured: a page rule
 * of `.desk-clock { position: fixed; … }` reached the card as well and
 * positioned it a second time, so a 90 px drag moved it 480 px. Any class or
 * style a consumer puts on `<kavibay-widget>` is for the element, never for
 * the card inside it.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Widget name as `catalog.ts` files it — the manifest's own spelling. */
  definition: string;
  /**
   * Optional overrides for a page that wants a specific size, in CSS pixels.
   *
   * Typed loosely because a custom element hands every attribute over as a
   * string, and Vue does not cast them here the way it does for a component
   * used inside an app — the same reason `<kavibay-palette-demo>` declares its
   * flags as strings. Declared as `number` alone, `width="940"` arrived as
   * `"940"`, `WidgetCard.hostSized` asks `typeof === "number"`, and the card
   * quietly fell back to hugging its content: the Wizard rendered at 865x334
   * instead of 940x520, with no warning anywhere.
   */
  width?: number | string;
  height?: number | string;
  /**
   * Start closed, and open when this palette row runs.
   *
   * Absent means the card starts open — but it still answers the palette row
   * that shares its `definition` name, which is what makes "close it, then
   * bring it back" work without the page wiring anything.
   */
  opensOn?: string;
  /**
   * Play this widget's demo script once it has mounted, if it has one.
   *
   * A string because custom-element attributes are strings; anything but
   * `"false"` counts as on, the same convention `<kavibay-palette-demo>` uses
   * for `autotype`.
   */
  autoplay?: string;
  /**
   * Show a **generated** package instead of a catalog widget.
   *
   * The value is a draft id — the name the Wizard wrote a package under in
   * this tab. The card, the chrome, the stacking and the drag are the same;
   * only the body differs, because generated code runs in a sandboxed frame
   * rather than as a component. `definition` still names the palette row that
   * opens it and the title the card carries.
   */
  draft?: string;
  /**
   * Title for a card that has no catalog entry.
   *
   * A generated package's name lives in its own manifest, which this element
   * does not parse — it renders files in a frame. The page names the card, the
   * way it already names which row opens it.
   */
  cardTitle?: string;
  /**
   * Hide the chrome title. A string because custom-element attributes are
   * strings; anything but `"false"` counts as on.
   *
   * The inbox demo is a list with provider marks — repeating the card's name
   * above the rows is the same word twice, so the landing page turns this on.
   */
  hideTitle?: string;
}>();

const entry = computed(() => embedWidget(props.definition));

/** A draft card borrows nothing from the catalog; it has files, not a view. */
const isDraft = computed(() => Boolean(props.draft));

/**
 * Host chrome the Widget Wizard asks for by name.
 *
 * `WizardPreviewStage.vue` injects this key and renders whatever it finds; the
 * app provides `WidgetWizardPreviewHost.vue` from `CockpitWidget.vue`. That
 * file imports `cockpit.ts` and is refused here, so the package brings its own
 * — see `EmbedWizardPreview.vue` for what it does and does not do.
 *
 * Provided unconditionally rather than only for the Wizard: a `provide` costs
 * nothing for a widget that never injects it, and a condition on a widget name
 * would be host code that knows about one extension.
 *
 * Async, though, because it is not free to *bundle*: the preview inlines the
 * whole runtime SDK, and importing it here put 8 KB gzip into the entry that
 * every page pays and only the Wizard page uses. `defineAsyncComponent` gives
 * the injection a component to hand over while keeping the code in a chunk
 * that is fetched when a preview is first rendered.
 */
provide(
  "kavibay:widget-wizard-preview",
  defineAsyncComponent(() => import("./EmbedWizardPreview.vue")),
);

/** The same frame the Wizard's preview uses, for a card that holds a draft. */
const DraftFrame = defineAsyncComponent(() => import("./DraftFrame.vue"));

/** The custom element itself. Null when the component is used as a plain SFC. */
const host = useHost();

/**
 * A stable instance id per element, so `ctx.data` scopes the way it does on a
 * desk. Two `<kavibay-widget definition="todo">` on one page are two todo
 * lists, exactly as two cards on a desk would be.
 */
const instanceId = `embed-${props.definition}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Configuration stays empty: every widget in the catalog has defaults for
 * everything it declares, and a settings dialog is desk furniture. An empty
 * object is also what a freshly added card starts with.
 */
const instance = reactive({
  id: instanceId,
  definitionId: entry.value
    ? embedDefinitionId(entry.value.extensionName, entry.value.name)
    : `kavibay.unknown/${props.definition}`,
  configuration: {},
  position: { x: 0, y: 0 },
  size: entry.value?.ui.defaultSize ??
    entry.value?.definition.defaultSize ?? { w: 2, h: 2 },
  mode: "expanded",
}) as WidgetInstance<Record<string, unknown>>;

const runtime = useWidgetRuntime(embedHost(), instance);

/**
 * Card size in CSS pixels; the card writes back through `resize`.
 *
 * The manifest's `ui.defaultSize` is already in pixels, and turning it into
 * card props is a rule the app owns — `initialSizeForExtension`, including the
 * detail that a `hugHeight` widget is given a width and no height. Reusing it
 * is why a card here opens at the size it opens at on a desk.
 */
const initial = initialSizeForExtension({
  defaultSize: entry.value?.ui.defaultSize ?? (isDraft.value ? { w: 260, h: 210 } : undefined),
  hugHeight: entry.value?.ui.hugHeight,
});

/**
 * A draft has no catalog entry, so its title comes from the palette row that
 * opens it — the same name the visitor typed to find it.
 */
const cardTitle = computed(() => entry.value?.title ?? props.cardTitle ?? props.definition);
/** An attribute's number, or undefined when the page did not give one. */
const asPixels = (value: number | string | undefined): number | undefined => {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

const width = ref(asPixels(props.width) ?? initial.width);
const height = ref(asPixels(props.height) ?? initial.height);
const contentScale = ref(1);
const hideTitle = ref(
  (props.hideTitle !== undefined && props.hideTitle !== "false")
    || Boolean(entry.value?.ui.defaultHideTitle),
);

/**
 * Reveal and flash, driven by the demo palette.
 *
 * `highlighted` is `WidgetCard`'s own search-result flash, and 900 ms is the
 * app's own duration (`WidgetHost.onHighlightWidget`). Reusing the card's prop
 * rather than animating a border here is the difference between showing the
 * product and imitating it.
 */
const visible = ref(!props.opensOn);

/**
 * The row that opens this card. A page may point it somewhere else, but the
 * default is the widget's own name — the same string the palette row carries.
 */
const openRow = computed(() => props.opensOn ?? props.definition);
const highlighted = ref(false);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

function onPaletteOpen(event: Event) {
  if (!isPaletteOpenEvent(event)) return;
  if (!opensWidget(event.detail, openRow.value)) return;

  visible.value = true;
  raise();
  highlighted.value = true;
  if (highlightTimer !== null) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlighted.value = false;
    highlightTimer = null;
  }, 900);
  handOverFocus();
}

/**
 * "The card is yours — put the caret where typing starts."
 *
 * `WidgetHost.onFocusWidget` does exactly this after revealing a widget from
 * the palette, and widgets rely on it: Notes focuses its editor, Calculator its
 * input, and the Widget Wizard redeems the "New Widget" request that folds its
 * chrome away. Leaving it out made a palette-opened card here subtly different
 * from the same card on a desk, in whatever way each widget cares about.
 *
 * WHY IT WAITS FOR THE MODEL AND NOT FOR A CLOCK:
 *
 * The widget listens on `window` from its own `onMounted`, and it does not
 * mount until its `setup` has resolved — the Wizard's hydrates a conversation
 * store first. An event sent before that lands nowhere. The app guesses at this
 * with two ticks and one 60ms retry because its widgets are already mounted; we
 * have the actual signal, so we use it: `runtime.model` turns non-null the
 * moment `setup` resolves, one tick before the view exists.
 *
 * The 60ms retry stays anyway, for a view that mounts something of its own
 * asynchronously. A second request is harmless — the Wizard's is consumed once
 * and every later one just focuses the composer, which is what the event means.
 */
function handOverFocus() {
  const send = () => {
    /**
     * Focus, but do not move the page.
     *
     * Widgets answer this event by focusing a control — the Wizard's composer,
     * Notes' editor — and the browser scrolls the document to reveal whatever
     * gets focus. On a desk that costs nothing: the overlay does not scroll. In
     * a page it jumped 778px, measured, and carried the palette out of view one
     * step before the tour typed into it again.
     *
     * The listeners run synchronously inside `dispatchEvent`, so restoring the
     * offset on the next line happens before anything is painted — the caret
     * lands where the widget wants it and the visitor keeps their place.
     */
    const { scrollX, scrollY } = window;
    window.dispatchEvent(
      new CustomEvent(WIDGET_FOCUS_EVENT, {
        detail: { instanceId: instance.id, surface: "desk" satisfies WidgetSurface },
      }),
    );
    window.scrollTo(scrollX, scrollY);
  };

  const afterMount = async () => {
    await nextTick();
    send();
    window.setTimeout(send, 60);
  };

  if (runtime.model.value) {
    void afterMount();
    return;
  }

  const stop = watch(
    () => runtime.model.value,
    (model) => {
      if (!model) return;
      stop();
      void afterMount();
    },
  );
}

/**
 * Closing is the card's own chrome — the × the app calls "Hide widget", and
 * the menu's Remove. Both land here because a page has no desk to hide into:
 * the card goes away, and the palette row that names it brings it back.
 *
 * Escape deliberately does not close anything. In the app it dismisses the
 * palette, and teaching the demo a shortcut the product does not have is the
 * kind of small lie this package exists to avoid.
 */
function onClose() {
  visible.value = false;
}

/**
 * What a page-level demo may do to this card, and nothing more.
 *
 * The tour needs to close the Wizard when its conversation is finished and to
 * know when a card is on screen. Exposing two methods keeps that from becoming
 * a script that reaches into this component's DOM and guesses — the failure
 * mode the Wizard autoplay is already careful about, and one worth avoiding
 * twice.
 */
defineExpose({
  close: onClose,
  isOpen: () => visible.value,
  /**
   * Which instance this card is, for an action that has to write into it.
   *
   * A contributed action that does not declare `needsInstance: false` targets
   * a card — "New Note" puts its text in one — and the handler scopes
   * `ctx.data` by this id. The palette runs the action before the card opens,
   * so it has to be able to ask which card it is about to reveal; the id
   * exists from setup, whether or not the card is on screen.
   */
  instanceId: () => instance.id,
});

/**
 * Mirror the open state onto the element as `data-open`.
 *
 * A page needs it: the shelf on the playground reserves a slot for a card, and
 * a closed card should not keep the gap. It is also the only honest way to
 * observe this component from the outside — which is how the wiring below was
 * debugged in the first place.
 */
watch(
  visible,
  (open) => host?.toggleAttribute("data-open", open),
  { immediate: true, flush: "post" },
);

/**
 * The visitor's veto over the demo script.
 *
 * Set by the first pointer or key that reaches this card. A script that keeps
 * typing over somebody's own sentence is worse than no script, so every step
 * checks this and stops.
 */
let userTookOver = false;
const vetoDemo = () => {
  userTookOver = true;
};

/**
 * A click is a look; a keystroke is a decision.
 *
 * Both used to end the demo outright, and that was the bug behind "sometimes
 * it just stops": clicking inside the Wizard killed *its* typing loop while
 * the director went on waiting for a package that would now never be written.
 * The demo hung with a Pause button on a tour that was no longer running.
 *
 * So a pointer pauses instead. The loops hold at their next `beat` — nothing
 * is torn down — the transport offers Play, and the visitor gets the card to
 * themselves for as long as they want it. Typing is still a hard stop: at that
 * point they are writing their own sentence, and a script that resumed into it
 * would type over them.
 *
 * Without a tour on the page there is no transport to press, so a pointer has
 * to keep meaning what it meant before — otherwise a click on the standalone
 * Wizard page would freeze the demo with no way to start it again.
 */
/**
 * Whichever demo is playing right now, if one is.
 *
 * A card is placed by a page and driven by whatever script that page runs, so
 * it cannot name one: asking for "the tour" would be this element knowing
 * about one particular demo. A paused run does not answer — the question here
 * is whether the visitor just interrupted something in progress.
 */
function onVisitorPointer() {
  const playing = demoInProgress();
  if (playing) playing.pause();
  else vetoDemo();
}

function onVisitorKey() {
  vetoDemo();
  demoInProgress()?.stop();
}

function startDemoScript() {
  if (props.autoplay === undefined || props.autoplay === "false") return;
  const script = demoScript(props.definition);
  if (!script || !host) return;

  // Same courtesy the palette demo extends: no unrequested motion for someone
  // who asked the system for less of it.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  void script(host, () => !userTookOver && visible.value);
}

/**
 * Start when the card is *on screen*, not when it mounts.
 *
 * Two separate reasons, and the second only showed up once a card was placed
 * near the bottom of a long page:
 *
 *  1. A card with `opens-on` is in the document from the first paint but
 *     hidden until its palette row runs. A script that started on mount would
 *     type into a composer nobody can see.
 *  2. A card that is open from the start still may not be *visible*. On the
 *     landing page the Wizard sits below several screens of text, and a demo
 *     that begins at page load is finished long before anybody scrolls to it:
 *     the visitor arrives at a transcript instead of a conversation.
 *
 * So the observer, matching the courtesy `<kavibay-palette-demo>` already
 * extends. `rootMargin` rather than a threshold ratio: this card is 1060 px
 * wide, and on a phone — where it sits in a scrolling rail — the visible
 * fraction of its box never reaches a ratio like 0.4 however far it is
 * scrolled into view.
 */
let demoObserver: IntersectionObserver | null = null;

function scheduleDemoScript() {
  if (demoObserver) return;
  if (!host || typeof IntersectionObserver === "undefined") {
    startDemoScript();
    return;
  }

  demoObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      demoObserver?.disconnect();
      demoObserver = null;
      if (visible.value) startDemoScript();
    },
    { rootMargin: "0px 0px -120px 0px" },
  );
  demoObserver.observe(host);
}

watch(visible, (open, wasOpen) => {
  if (open && !wasOpen) scheduleDemoScript();
});

onMounted(() => {
  document.addEventListener(PALETTE_OPEN_EVENT, onPaletteOpen);
  host?.addEventListener("pointerdown", onVisitorPointer, { capture: true });
  host?.addEventListener("keydown", onVisitorKey, { capture: true });
  if (visible.value) scheduleDemoScript();
  // Capture, so a card raises even when the widget inside stops the event.
  host?.addEventListener("pointerdown", raise, { capture: true });
  host?.addEventListener("focusin", raise);
});

onUnmounted(() => {
  vetoDemo();
  demoObserver?.disconnect();
  demoObserver = null;
  document.removeEventListener(PALETTE_OPEN_EVENT, onPaletteOpen);
  host?.removeEventListener("pointerdown", onVisitorPointer, { capture: true });
  host?.removeEventListener("keydown", onVisitorKey, { capture: true });
  host?.removeEventListener("pointerdown", raise, { capture: true });
  host?.removeEventListener("focusin", raise);
  if (highlightTimer !== null) clearTimeout(highlightTimer);
});

/**
 * Move, with the app's own edge rule.
 *
 * `WidgetHost.onWidgetMovePointerDown` clamps a card's centre inside
 * `viewportEdgeMargin`, which scales with the shorter viewport side so the
 * inset looks the same on a laptop and on an ultrawide. Reusing that function
 * is why a card here stops where a card there stops.
 *
 * Freehand, not snapped. The app snaps by default
 * (`DEFAULT_APPEARANCE.widgetLayoutMode`), but there it is a setting the user
 * can see and switch off. This page has no settings, so snapping here would be
 * a behaviour nobody could turn off.
 */
const cardRef = ref<{ $el: HTMLElement } | null>(null);

/**
 * Bring this card to the front. Called for any interaction, not just a drag:
 * typing in the calculator counts as making it the active card, the same way
 * clicking its title bar does.
 *
 * The raise persists — a card stays on top until another one is touched.
 */
function raise() {
  host?.style.setProperty("z-index", String(nextStackOrder()));
}

/**
 * Moving the card. The mechanics — and the four traps behind them — live in
 * `useDragOffset`, shared with the palette so the two cannot drift apart.
 *
 * The box it measures is the card, not the element: a page may give the
 * element a wider slot than the card fills, and clamping the wrong box stops
 * the card in the wrong place.
 */
const { onMovePointerDown, nudge } = useDragOffset({
  host,
  box: () => cardRef.value?.$el,
  onGrab: raise,
});

/**
 * A live resize: new size, and the move that keeps the far edge still.
 *
 * `deltaOffset` is the app's answer to "which way did the card grow", and two
 * things about it have to be got right or the card walks off on its own.
 *
 * FIRST, IT IS A CENTRE. The app stores a widget by its middle: pull the west
 * edge out by `dw` and the centre travels `-dw/2`. This element is positioned
 * by its top-left, from `left`/`top` in the page's own markup, so the move it
 * needs is
 *
 *     leftDelta = deltaOffset.x - (width - widthAtGestureStart) / 2
 *
 * which is zero for an east drag and the full `dw` for a west one. Without
 * this the card only ever grew rightwards and downwards, whichever edge was
 * held.
 *
 * SECOND, IT IS CUMULATIVE. `applyResizeDelta` is handed the size the gesture
 * *started* at and the pointer's total travel, so every pointermove reports
 * the whole offset again, not the step since the last one. Adding each report
 * to a running total sent the card sliding to the right for as long as the
 * pointer moved — measured, and the reason this comment is this long. So the
 * gesture's start size is remembered, the wanted offset is computed against
 * it, and only the difference from what was already applied is handed on.
 */
let resizeStart: { width: number; height: number } | null = null;
let resizeApplied = { x: 0, y: 0 };

function onResize(payload: {
  width: number;
  height: number;
  deltaOffset?: { x: number; y: number };
  contentScale?: number;
}) {
  /*
   * `?? payload.…` for the hug-height case: `initialSizeForExtension` leaves
   * the height undefined there on purpose, so there is nothing to measure the
   * gesture against and that axis simply does not move — which is right, since
   * a hug-height card has no top edge to drag.
   */
  resizeStart ??= {
    width: width.value ?? payload.width,
    height: height.value ?? payload.height,
  };

  width.value = payload.width;
  height.value = payload.height;
  if (payload.contentScale !== undefined) contentScale.value = payload.contentScale;

  if (!payload.deltaOffset) return;
  const wantX = payload.deltaOffset.x - (payload.width - resizeStart.width) / 2;
  const wantY = payload.deltaOffset.y - (payload.height - resizeStart.height) / 2;
  nudge(wantX - resizeApplied.x, wantY - resizeApplied.y);
  resizeApplied = { x: wantX, y: wantY };
}

/** The gesture is over; the next one measures from wherever the card is now. */
function onResizeEnd() {
  resizeStart = null;
  resizeApplied = { x: 0, y: 0 };
}
</script>

<template>
  <!--
    `coach-targets` is what the app passes for everything but the gallery. It
    keeps the card's chrome mounted instead of waiting for a hover, which is
    also what makes the close button reachable on a touch screen.
  -->
  <WidgetCard
    v-if="(entry || isDraft) && visible"
    ref="cardRef"
    :title="cardTitle"
    :hide-title="hideTitle"
    :instance-id="instance.id"
    :has-settings="false"
    :has-about="false"
    :highlighted="highlighted"
    :flush="Boolean(entry?.ui.flush)"
    :padding="entry?.ui.padding !== false"
    :compact="Boolean(entry?.ui.compact)"
    :allow-duplicate="false"
    :resizable="true"
    :width="width"
    :height="entry?.ui.hugHeight ? undefined : height"
    :content-scale="contentScale"
    :lock-square="Boolean(entry?.ui.playground)"
    :playground="Boolean(entry?.ui.playground)"
    :hug-height="Boolean(entry?.ui.hugHeight)"
    :full-drag="Boolean(entry?.ui.fullDrag)"
    :opaque="Boolean(entry?.ui.opaque)"
    :coach-targets="true"
    @update:hide-title="hideTitle = $event"
    @move-pointerdown="onMovePointerDown"
    @hide="onClose"
    @remove="onClose"
    @resize="onResize"
    @resize-end="onResizeEnd"
    @update:content-scale="contentScale = $event"
  >
    <!--
      The gate's branches, in the gate's order. `provider` and `unconfigured`
      are absent by admission rule, not by omission.
    -->
    <!-- A generated package: files in a sandboxed frame, not a component. -->
    <DraftFrame v-if="isDraft" :draft="props.draft!" :title="cardTitle" />

    <BrokenWidget
      v-else-if="runtime.phase.value === 'missing-definition'"
      :definition-id="instance.definitionId"
    />
    <WidgetSkeleton v-else-if="runtime.phase.value === 'loading'" />
    <WidgetError
      v-else-if="runtime.phase.value === 'error' && runtime.error.value"
      :error="runtime.error.value"
      @retry="runtime.retry()"
    />
    <component
      :is="entry!.view"
      v-else-if="entry && runtime.model.value"
      :model="runtime.model.value"
    />

    <template v-if="entry?.menu" #menu>
      <component :is="entry.menu" />
    </template>
  </WidgetCard>

  <!--
    An unknown name is the page's mistake, not a widget failure, so it gets the
    same placeholder a missing definition gets rather than silence.
  -->
  <BrokenWidget v-else-if="!entry && !isDraft" :definition-id="props.definition" />
</template>

<style>
/*
 * Unscoped and addressed by element name: this component renders in light DOM
 * so the widget views' own scoped styles apply (see `main.ts`). The element is
 * a plain block; where it sits is the page's business.
 */
kavibay-widget {
  display: block;
  /*
   * Positioned so the stacking above has something to act on. Element-name
   * specificity, so any page rule that places the card wins over it.
   */
  position: relative;
  /* Drag offset. `translate` composes with any `transform` the page sets. */
  translate: var(--kavibay-embed-dx, 0px) var(--kavibay-embed-dy, 0px);
  font-family: inherit;
  font-size: 14px;
  color: var(--text, rgba(255, 255, 255, 0.92));
  -webkit-font-smoothing: antialiased;
}

kavibay-widget *,
kavibay-widget *::before,
kavibay-widget *::after {
  box-sizing: border-box;
}

/*
 * Slim scrollbars inside a card, because the app's own answer cannot be used
 * here.
 *
 * `core/app/styles.css` hides native scrollbars everywhere (`scrollbar-width:
 * none`) and paints thumbs on top with `installOverlayScrollbars()`. That
 * helper walks `document.body` and observes the whole subtree — in an app it
 * owns the document, in a page it would attach itself to the host's own
 * scrollers. So this package does not call it, and without it a widget got the
 * platform's default bars: a light track and a blocky thumb in the middle of a
 * dark card, which is what the Wizard's code editor looked like.
 *
 * `scrollbar-color` is what modern engines read and it wins over the
 * `::-webkit-` rules where both are understood; those stay for the ones that
 * only know the old pseudo-elements. `--scrollbar` is the app's own token, so
 * a page that sets the widget tokens gets the app's colour and everything else
 * still gets something sensible.
 */
kavibay-widget * {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar, rgba(var(--fg-rgb, 255, 255, 255), 0.22)) transparent;
}

kavibay-widget *::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

kavibay-widget *::-webkit-scrollbar-track,
kavibay-widget *::-webkit-scrollbar-corner {
  background: transparent;
}

kavibay-widget *::-webkit-scrollbar-thumb {
  /* The transparent border plus `content-box` is what makes the thumb read as
     a floating pill rather than a bar filling the gutter. */
  border: 3px solid transparent;
  border-radius: 999px;
  background: var(--scrollbar, rgba(var(--fg-rgb, 255, 255, 255), 0.22));
  background-clip: content-box;
}

kavibay-widget *::-webkit-scrollbar-thumb:hover {
  background-color: rgba(var(--fg-rgb, 255, 255, 255), 0.34);
}
</style>
