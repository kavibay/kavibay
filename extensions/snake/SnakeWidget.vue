<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import { GRID_SIZE, directionFromKey } from "./snakeLogic";
import {
  claimSnakeKeyboard,
  ownsSnakeKeyboard,
  type SnakeModel,
} from "./widgets/snake";

const props = defineProps<{ model: SnakeModel }>();

const injectedId = inject<string>("widgetInstanceId");
if (!injectedId) throw new Error("widgetInstanceId missing");
const instanceId: string = injectedId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");

/** True when WidgetCard ResizeEdges owns width/height. */
const hostSized = inject<ComputedRef<boolean>>("widgetHostSized", computed(() => false));

const LCD = "#a4b086";
const INK = "#1a2212";
/** Hairline grid — slightly darker than the LCD fill. */
const GRID = "#8f9a74";

const rootEl = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
/** Square playground field pixel size. */
const fieldW = ref(0);
const fieldH = ref(0);
const playgroundSide = ref(0);

const {
  game,
  score,
  phase,
  highScore,
  boardSize,
  start,
  turn,
  setBoardSize,
} = props.model;

const scoreLabel = computed(() => String(score.value).padStart(4, "0"));
const highScoreLabel = computed(() => String(highScore.value).padStart(4, "0"));
const overlayText = computed(() => {
  if (phase.value === "won") return "YOU WIN";
  if (phase.value === "dead") return "GAME OVER";
  if (phase.value === "ready") return "Press space to start";
  return "";
});

/** Intrinsic (non-host) board box. */
const intrinsicBoardStyle = computed(() => ({
  width: `${boardSize.value}px`,
  height: `${boardSize.value}px`,
}));

/** Fill layout when the host owns an explicit size (playground cards pin the root). */
const fillLayout = computed(() => hostSized.value);
const squareLayout = computed(() => fillLayout.value && widgetSurface === "inline");

/** A host surface can be rectangular; Snake itself deliberately is not. */
const playgroundStyle = computed(() =>
  squareLayout.value && playgroundSide.value > 0
    ? { width: `${playgroundSide.value}px`, height: `${playgroundSide.value}px` }
    : undefined,
);

/** CSS px size used for drawing (full stage in playground, else square board). */
const drawW = computed(() =>
  fillLayout.value && fieldW.value > 0 ? fieldW.value : boardSize.value,
);
const drawH = computed(() =>
  fillLayout.value && fieldH.value > 0 ? fieldH.value : boardSize.value,
);

/** HUD / overlay type scales with the shorter field edge. */
const scaleEdge = computed(() => Math.min(drawW.value, drawH.value));
const hudFontPx = computed(() =>
  Math.max(11, Math.min(28, Math.round(scaleEdge.value / 14))),
);
const overlayFontPx = computed(() =>
  Math.max(11, Math.min(36, Math.round(scaleEdge.value / 12))),
);
const hudStyle = computed(() => ({ fontSize: `${hudFontPx.value}px` }));
const overlayStyle = computed(() => ({ fontSize: `${overlayFontPx.value}px` }));

/** Cached 2d context + last backing-store size (avoid getContext every paint). */
let cachedCtx: CanvasRenderingContext2D | null = null;
let cachedBufW = 0;
let cachedBufH = 0;
let cachedDpr = 0;
/** Pre-baked LCD + grid layer; rebuilt only when the field size changes. */
let gridLayer: HTMLCanvasElement | null = null;
let gridLayerKey = "";
let drawRaf = 0;
let drawDirty = false;

/** Size the canvas backing store to the drawn field; reuse context when possible. */
function syncCanvasSize() {
  const canvas = canvasEl.value;
  if (!canvas) return null;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const bufW = Math.max(1, Math.round(drawW.value * dpr));
  const bufH = Math.max(1, Math.round(drawH.value * dpr));
  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width = bufW;
    canvas.height = bufH;
    cachedCtx = null;
  }
  if (!cachedCtx || cachedBufW !== bufW || cachedBufH !== bufH || cachedDpr !== dpr) {
    cachedCtx = canvas.getContext("2d");
    if (!cachedCtx) return null;
    cachedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cachedBufW = bufW;
    cachedBufH = bufH;
    cachedDpr = dpr;
  }
  return cachedCtx;
}

/** Build (or reuse) an offscreen canvas with LCD fill + hairline grid. */
function ensureGridLayer(w: number, h: number, dpr: number): HTMLCanvasElement {
  const key = `${w}x${h}@${dpr}`;
  if (gridLayer && gridLayerKey === key) return gridLayer;

  const layer = gridLayer ?? document.createElement("canvas");
  const bufW = Math.max(1, Math.round(w * dpr));
  const bufH = Math.max(1, Math.round(h * dpr));
  layer.width = bufW;
  layer.height = bufH;
  const gctx = layer.getContext("2d");
  if (!gctx) return layer;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gctx.fillStyle = LCD;
  gctx.fillRect(0, 0, w, h);
  const cellW = w / GRID_SIZE;
  const cellH = h / GRID_SIZE;
  gctx.strokeStyle = GRID;
  gctx.lineWidth = 0.5;
  gctx.beginPath();
  for (let i = 0; i <= GRID_SIZE; i++) {
    const x = i * cellW + 0.25;
    const y = i * cellH + 0.25;
    gctx.moveTo(x, 0);
    gctx.lineTo(x, h);
    gctx.moveTo(0, y);
    gctx.lineTo(w, y);
  }
  gctx.stroke();

  gridLayer = layer;
  gridLayerKey = key;
  return layer;
}

/** Paint the board onto the canvas (cached grid + snake/food). */
function drawBoard() {
  const ctx = syncCanvasSize();
  if (!ctx) return;

  const w = drawW.value;
  const h = drawH.value;
  if (w < 1 || h < 1) return;

  const dpr = cachedDpr || 1;
  const cellW = w / GRID_SIZE;
  const cellH = h / GRID_SIZE;
  const g = game.value;
  const layer = ensureGridLayer(w, h, dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cachedBufW, cachedBufH);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const paint = (x: number, y: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
  };

  for (const seg of g.snake) {
    paint(seg.x, seg.y, INK);
  }

  paint(g.food.x, g.food.y, INK);
  const fx = g.food.x * cellW;
  const fy = g.food.y * cellH;
  const hole = Math.max(2, Math.floor(Math.min(cellW, cellH) * 0.28));
  ctx.fillStyle = LCD;
  ctx.fillRect(fx + (cellW - hole) / 2, fy + (cellH - hole) / 2, hole, hole);
}

/** Coalesce paints to one vsync (smoother than painting inside every watcher). */
function scheduleDraw() {
  drawDirty = true;
  if (drawRaf) return;
  drawRaf = requestAnimationFrame(() => {
    drawRaf = 0;
    if (!drawDirty) return;
    drawDirty = false;
    drawBoard();
  });
}

/** Claim keys and move DOM focus onto the game surface. */
async function focusGame() {
  claimSnakeKeyboard(instanceId);
  await nextTick();
  rootEl.value?.focus({ preventScroll: true });
}

/** Respond to palette Tab / Enter focus for this instance. */
function onKavibayFocusWidget(event: Event) {
  // Surface check keeps the desk card from stealing the caret from the inline view.
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  void focusGame();
}

/** Claim keyboard on press. */
function onRootPointerDown() {
  void focusGame();
}

/** Skip keys while the user is typing in another control. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** True for spacebar (prefer code — key can be " " or "Spacebar"). */
function isSpaceKey(event: KeyboardEvent): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

/** Window-level keys; only the active Snake instance handles them. */
function onWindowKeydown(event: KeyboardEvent) {
  if (!ownsSnakeKeyboard(instanceId)) return;
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Escape") return;
  if (isEditableTarget(event.target)) return;

  // Idle / game-over / win: Space starts (or restarts) a run.
  if (game.value.phase !== "playing") {
    if (!isSpaceKey(event)) return;
    if (event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    start();
    void focusGame();
    return;
  }

  const dir = directionFromKey(event.key);
  if (!dir) return;
  // Ignore OS key-repeat — only the initial press should turn.
  if (event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  turn(dir);
}

/**
 * Playground: the LCD and board stay square, centered in any rectangular host.
 * boardSize tracks the playable square edge for clamp / font scale.
 */
function syncBoardFromHost() {
  if (!fillLayout.value) return;
  if (!squareLayout.value) {
    const stage = stageEl.value;
    if (!stage) return;
    const w = Math.floor(stage.clientWidth);
    const h = Math.floor(stage.clientHeight);
    if (w < 1 || h < 1) return;
    fieldW.value = w;
    fieldH.value = h;
    setBoardSize(Math.min(w, h), { hostDriven: true });
    scheduleDraw();
    return;
  }
  const root = rootEl.value;
  const stage = stageEl.value;
  if (!root || !stage) return;
  const side = Math.floor(Math.min(root.clientWidth, root.clientHeight));
  if (side < 1) return;
  playgroundSide.value = side;
  // The stage is square by CSS; retain min as a defensive fallback for a
  // transient ResizeObserver measurement while the square style is applying.
  const fieldSide = Math.floor(Math.min(stage.clientWidth, stage.clientHeight));
  if (fieldSide < 1) return;
  fieldW.value = fieldSide;
  fieldH.value = fieldSide;
  setBoardSize(fieldSide, { hostDriven: true });
  scheduleDraw();
}

let hostResizeObserver: ResizeObserver | null = null;

watch(game, () => scheduleDraw());

watch(boardSize, async () => {
  // Size change invalidates the cached grid layer via ensureGridLayer key.
  scheduleDraw();
  await nextTick();
});

watch([drawW, drawH], () => scheduleDraw());

watch(phase, (next) => {
  if (next === "playing") void focusGame();
});

watch(fillLayout, async () => {
  await nextTick();
  syncBoardFromHost();
});

onMounted(() => {
  void focusGame();
  scheduleDraw();
  window.addEventListener("keydown", onWindowKeydown, true);
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);

  hostResizeObserver = new ResizeObserver(() => {
    syncBoardFromHost();
  });
  if (rootEl.value) hostResizeObserver.observe(rootEl.value);
  if (stageEl.value) hostResizeObserver.observe(stageEl.value);
  void nextTick().then(() => syncBoardFromHost());
});

onUnmounted(() => {
  if (drawRaf) cancelAnimationFrame(drawRaf);
  drawRaf = 0;
  hostResizeObserver?.disconnect();
  hostResizeObserver = null;
  window.removeEventListener("keydown", onWindowKeydown, true);
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  cachedCtx = null;
  gridLayer = null;
});
</script>

<template>
  <div
    ref="rootEl"
    class="snake"
    :class="{ 'snake--playground': fillLayout, 'snake--square': squareLayout }"
    data-interactive
    tabindex="0"
    aria-label="Snake. Press space to start. Arrow keys or WASD to steer."
    @pointerdown.stop="onRootPointerDown"
  >
    <div
      class="snake-lcd"
      :class="{ 'snake-lcd--playground': fillLayout, 'snake-lcd--square': squareLayout }"
      :style="playgroundStyle"
    >
      <div class="snake-hud" :style="hudStyle">
        <span class="snake-hi">HI {{ highScoreLabel }}</span>
        <span class="snake-score">{{ scoreLabel }}</span>
      </div>

      <div
        ref="stageEl"
        class="snake-stage"
        :class="{ 'snake-stage--playground': fillLayout, 'snake-stage--square': squareLayout }"
        :style="fillLayout ? undefined : intrinsicBoardStyle"
      >
        <canvas
          ref="canvasEl"
          class="snake-canvas"
          :class="{ 'snake-canvas--playground': fillLayout }"
          :style="fillLayout ? undefined : intrinsicBoardStyle"
          role="img"
          :aria-label="`Score ${score}`"
        />
        <div
          v-if="overlayText"
          class="snake-overlay"
          :style="overlayStyle"
          aria-hidden="true"
        >
          {{ overlayText }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snake {
  position: relative;
  width: fit-content;
  outline: none;
  user-select: none;
  box-sizing: border-box;
}

/* Host pins this root to the card body; LCD paints edge-to-edge. */
.snake--playground {
  width: 100%;
  height: 100%;
  display: block;
}

.snake--square {
  display: grid;
  place-items: center;
}

.snake-lcd {
  position: relative;
  padding: 8px;
  background: #a4b086;
  color: #1a2212;
  font-family: "Lucida Console", "Courier New", monospace;
  box-shadow: inset 0 0 0 2px #7e8a66;
  box-sizing: border-box;
}

.snake-lcd--playground {
  width: 100%;
  height: 100%;
  padding: 8px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: inherit;
}

/* Inside the palette the HUD floats over the LCD, leaving the square board
   almost all of the available area instead of consuming a dedicated row. */
.snake-lcd--square {
  padding: 5px;
}

.snake-lcd--square .snake-hud {
  position: absolute;
  top: 9px;
  left: 10px;
  right: 10px;
  z-index: 1;
  margin: 0;
  pointer-events: none;
}

.snake-hud {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  font-weight: 700;
  letter-spacing: 0.2em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.snake-hi {
  opacity: 0.75;
}

.snake-stage {
  position: relative;
}

/* Playfield fills all space under the HUD — no centered square letterboxing. */
.snake-stage--playground {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}

.snake-stage--square {
  width: auto;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  align-self: center;
}

.snake-canvas {
  display: block;
  image-rendering: pixelated;
}

.snake-canvas--playground {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.snake-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 8px;
  text-align: center;
  background: rgba(164, 176, 134, 0.55);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #1a2212;
  line-height: 1.2;
  box-sizing: border-box;
}
</style>
