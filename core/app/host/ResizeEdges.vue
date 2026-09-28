<script setup lang="ts">
import { ref } from "vue";
import {
  RESIZE_CURSOR,
  RESIZE_EDGES,
  applyResizeDelta,
  contentScaleForResize,
  clampContentScale,
  DEFAULT_CONTENT_SCALE,
  type ResizeClamps,
  type ResizeEdge,
  type SizeBox,
  DEFAULT_WIDGET_CLAMPS,
} from "./resizeLogic";
import { setClickThroughPaused } from "../system/clickThrough";

const props = withDefaults(
  defineProps<{
    /** Current width/height; when omitted, measured from `measureEl` on drag start. */
    width?: number;
    height?: number;
    /** Body content zoom at gesture start (Ctrl+resize updates it). */
    contentScale?: number;
    /** Element to measure when size is not yet persisted. */
    measureEl?: HTMLElement | null;
    clamps?: ResizeClamps;
    /** Keep width === height (Snake). */
    lockSquare?: boolean;
    /** Which edges/corners to show (widgets keep the top edge for moving). */
    edges?: ResizeEdge[];
    /** Mark the SE handle for the guided tour arrow. */
    coachTargets?: boolean;
  }>(),
  {
    clamps: () => DEFAULT_WIDGET_CLAMPS,
    lockSquare: false,
    edges: () => [...RESIZE_EDGES],
    coachTargets: false,
  },
);

const emit = defineEmits<{
  /** Live size + center offset delta while dragging; scale only while Ctrl is held. */
  resize: [
    payload: {
      width: number;
      height: number;
      deltaOffset: { x: number; y: number };
      contentScale?: number;
      edge?: string;
    },
  ];
  /** Fired when a resize gesture ends. */
  "resize-end": [];
}>();

const activeEdge = ref<ResizeEdge | null>(null);

/** Start an edge/corner resize gesture. */
function onHandlePointerDown(event: PointerEvent, edge: ResizeEdge) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  // Preview fitting and ancestor zoom scale pointer pixels, but sizes stay in local CSS pixels.
  const measured = props.measureEl;
  const bounds = measured?.getBoundingClientRect();
  const pointerScaleX = measured?.offsetWidth && bounds?.width ? bounds.width / measured.offsetWidth : 1;
  const pointerScaleY = measured?.offsetHeight && bounds?.height ? bounds.height / measured.offsetHeight : 1;

  let startW = props.width;
  let startH = props.height;
  // Resolve missing axes independently so hugHeight docks (height omitted) still
  // keep a finite host width instead of remeasuring both from the DOM.
  const needW = startW === undefined || !Number.isFinite(startW);
  const needH = startH === undefined || !Number.isFinite(startH);
  if (needW || needH) {
    const el = props.measureEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (needW) startW = rect.width / pointerScaleX;
    if (needH) startH = rect.height / pointerScaleY;
  }
  if (
    startW === undefined ||
    startH === undefined ||
    !Number.isFinite(startW) ||
    !Number.isFinite(startH)
  ) {
    return;
  }

  const start: SizeBox = { width: startW, height: startH };
  const startScale = clampContentScale(
    typeof props.contentScale === "number" ? props.contentScale : DEFAULT_CONTENT_SCALE,
  );
  activeEdge.value = edge;
  handle.setPointerCapture(event.pointerId);
  setClickThroughPaused(true);

  /** Apply pointer movement to size + center offset (+ content scale when Ctrl). */
  function onMove(ev: PointerEvent) {
    const raw = applyResizeDelta(
      edge,
      start,
      (ev.clientX - startX) / pointerScaleX,
      (ev.clientY - startY) / pointerScaleY,
      props.clamps,
    );

    let width = raw.width;
    let height = raw.height;
    let deltaOffset = raw.deltaOffset;

    if (props.lockSquare) {
      const side = Math.min(raw.width, raw.height);
      const appliedDw = side - start.width;
      const appliedDh = side - start.height;
      let dx = 0;
      let dy = 0;
      if (edge.includes("e")) dx += appliedDw / 2;
      if (edge.includes("w")) dx -= appliedDw / 2;
      if (edge.includes("s")) dy += appliedDh / 2;
      if (edge.includes("n")) dy -= appliedDh / 2;
      width = side;
      height = side;
      deltaOffset = { x: dx, y: dy };
    }

    const payload: {
      width: number;
      height: number;
      deltaOffset: { x: number; y: number };
      contentScale?: number;
      edge: ResizeEdge;
    } = { width, height, deltaOffset, edge };

    // Ctrl held: zoom body content with the shorter-side size ratio.
    if (ev.ctrlKey) {
      payload.contentScale = contentScaleForResize(startScale, start, {
        width,
        height,
      });
    }

    emit("resize", payload);
  }

  /** End gesture and restore click-through. */
  function onUp(ev: PointerEvent) {
    handle.releasePointerCapture(ev.pointerId);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    activeEdge.value = null;
    setClickThroughPaused(false);
    emit("resize-end");
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}
</script>

<template>
  <!--
    Each handle is data-interactive: handles overhang 3–4px outside the card,
    and click-through only uses border boxes (parent inset:0 would miss them).
  -->
  <div class="resize-edges" aria-hidden="true">
    <div
      v-for="edge in edges"
      :key="edge"
      class="resize-handle"
      data-interactive
      :data-onboarding-target="
        coachTargets && edge === 'se' ? 'widget-resize-se' : undefined
      "
      :class="[
        `resize-handle--${edge}`,
        { 'resize-handle--active': activeEdge === edge },
      ]"
      :style="{ cursor: RESIZE_CURSOR[edge] }"
      @pointerdown="onHandlePointerDown($event, edge)"
    />
  </div>
</template>

<style scoped>
.resize-edges {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
}

.resize-handle {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
  /* Invisible hit target — no hover/active chrome. */
  background: transparent;
}

/* Edge strips */
.resize-handle--n,
.resize-handle--s {
  left: 10px;
  right: 10px;
  height: 6px;
}

.resize-handle--e,
.resize-handle--w {
  top: 10px;
  bottom: 10px;
  width: 6px;
}

.resize-handle--n {
  top: -3px;
}

.resize-handle--s {
  bottom: -3px;
}

.resize-handle--e {
  right: -3px;
}

.resize-handle--w {
  left: -3px;
}

/* Corners (larger hit targets, win over edges) */
.resize-handle--ne,
.resize-handle--nw,
.resize-handle--se,
.resize-handle--sw {
  width: 12px;
  height: 12px;
  z-index: 1;
}

.resize-handle--nw {
  top: -4px;
  left: -4px;
}

.resize-handle--ne {
  top: -4px;
  right: -4px;
}

.resize-handle--sw {
  bottom: -4px;
  left: -4px;
}

.resize-handle--se {
  bottom: -4px;
  right: -4px;
}
</style>
