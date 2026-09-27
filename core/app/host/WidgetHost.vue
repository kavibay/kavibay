<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  readonly,
  toRaw,
  watch,
} from "vue";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  DeskPlacement,
  SavedLayoutV4,
  WidgetCatalogEntry,
  WidgetInstance,
  WidgetPosition,
} from "./types";
import { normalizeWidgetAppearance, type WidgetAppearance } from "./widgetAppearance";
import {
  getExtension,
  listExtensions,
  runExtensionAction,
  runDuplicateHook,
  runExtensionHook,
} from "../extensions/registry";
import {
  resolveExtension,
  useRuntimeExtensions,
} from "../runtime/useRuntimeExtensions";
import { WIDGET_FOCUS_EVENT, type WidgetSurface } from "@sdk";
import { warmLazyViews } from "@sdk/lazyView";
import { initialSizeForExtension } from "../extensions/initialSize";
import { rememberTypeSize, rememberedSizeFor } from "./typeSizeMemory";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import {
  activeDesk,
  addCatalogInstance,
  addDesk,
  catalogNotOnDesk,
  deleteDesk,
  desksWithInstance,
  instancesForDesk,
  normalizeCatalogEntry,
  normalizePlacement,
  placeOnDesk,
  purgeRedundantHiddenInstances,
  removeFromDesk,
  removeEverywhere,
  renameDesk,
  restoreRemovedInstance,
  setActiveDesk,
} from "./deskLogic";
import {
  WidgetCloseHistory,
  type WidgetCloseUndoEntry,
} from "./widgetCloseHistory";
import {
  consumeFirstOpen,
  createInstance,
  duplicateInstance,
  instanceHoldsData,
  loadLayout,
  renameWidgetType,
  saveLayout,
  hasKeptInstance,
  shouldKeepWindowAfterDismiss,
  survivesDismiss,
  spawnOffsetNearPalette,
} from "./layoutLogic";
import { renameRuntimeStorageExt } from "../runtime/runtimeStorage";
import { extensionHost } from "../extension-host/cockpit";
import {
  LayoutGeometryHistory,
  applyLayoutGeometry,
  captureLayoutGeometry,
  layoutGeometryEqual,
  type LayoutGeometrySnapshot,
} from "./layoutHistory";
import {
  clampCardCenter,
  currentViewportSize,
  resolveDeskViewport,
  viewportEdgeMargin,
  viewportsEqual,
  type ViewportSize,
} from "./viewportLayout";
import {
  needsDomGapCatcher,
  scheduleRegionSync,
  setClickThroughPaused,
  setOutsideClickDismiss,
  syncInteractiveRegions,
} from "../system/clickThrough";
import { useAppearance } from "../settings/useAppearance";
import { useExtensionsPrefs } from "../settings/useExtensionsPrefs";
import { useSettingsModal } from "../settings/useSettingsModal";
import { useExtensionAboutModal } from "../extensions/useExtensionAboutModal";
import { hostDismissHeld } from "@sdk";
import { paletteDropActive, requestInlineWidget } from "../palette/inlineWidgetRequest";
import { useOnboarding } from "../onboarding/useOnboarding";
import { setupState, startSetupIfNeeded } from "../onboarding/setupSession";
import { isSetupVisible } from "../onboarding/setupLogic";
import { isGalleryWidget, WIDGET_WIZARD_ID } from "./builtinWidgetIds";
import { pruneConnections } from "../settings/credentials/connections";
import { starterDeskIds } from "./starterDesk";
import {
  galleryPickOffset,
  galleryTourPlacement,
  type GalleryTourPlacement,
} from "./galleryTourPlacement";
import { ONBOARDING_GALLERY_STEP } from "../onboarding/onboardingLogic";
import {
  DEFAULT_PALETTE_WIDTH,
  DEFAULT_WIDGET_MIN_HEIGHT,
  DEFAULT_WIDGET_MIN_WIDTH,
  PALETTE_MIN_LIST_HEIGHT,
  PALETTE_MIN_WIDTH,
  clampContentScale,
  DEFAULT_CONTENT_SCALE,
} from "./resizeLogic";
import {
  GRID_GAP,
  snapPositionInInset,
  snapResizeGeometry,
  snapValue,
} from "./gridSnap";
import {
  findClearSpawnOffset,
  SPAWN_GAP,
  type SpawnRect,
} from "./spawnPlacement";
import { nextWidgetFocusId } from "./widgetFocusCycle";
import { resolvePeek } from "./peekSession";
import {
  classifyCtrlKey,
  emptyCtrlTapState,
  observeCtrlTap,
  type CtrlTapState,
} from "./ctrlDoubleTap";
import {
  matchWidgetCloseKey,
  resolveWidgetCloseTarget,
} from "./widgetCloseKeys";
import {
  CTRL_SHORTCUT_HINT_DELAY_MS,
  SHORTCUT_HINT_TARGET_KEY,
  type ShortcutHintTarget,
} from "./shortcutHints";
import WidgetInstanceView from "./WidgetInstanceView.vue";
import DemoHotkeyOverlay from "./DemoHotkeyOverlay.vue";
import { kavibayCockpitOpen, type CockpitTrigger } from "./cockpitSession";
import { startBrowserZoomGuard } from "./browserZoomGuard";

const extensionRegistry = listExtensions().filter((extension) => extension.isWidget);
const { hideOnOutsideClick, widgetLayoutMode } = useAppearance();
const { disabledIds, isEnabled } = useExtensionsPrefs();
const { open: settingsOpen } = useSettingsModal();
const { show: showExtensionAbout } = useExtensionAboutModal();
const { rescan: rescanRuntimeExtensions, developerExtensionsEnabled } =
  useRuntimeExtensions();
const onboarding = useOnboarding();

// All positions are centers. Widget offsets remain relative to the palette.
/** Authoritative layout-v4 document; palette + instances mirror the active desk. */
const layoutDoc = reactive<SavedLayoutV4>(loadLayout(extensionRegistry));
const palettePos = reactive<WidgetPosition>({ x: 0, y: 0 });
const palettePinned = ref(false);
const paletteWidth = ref<number | undefined>(undefined);
const paletteListHeight = ref<number | undefined>(undefined);
const instances = reactive<WidgetInstance[]>([]);
/** Window size the live layout was last scaled to (0 = not adapted yet). */
let adaptedViewport: ViewportSize = { width: 0, height: 0 };

/** Desk list for palette tabs (Task 3 UI consumes this). */
const kavibayDesks = computed(() =>
  layoutDoc.desks.map((desk) => ({ id: desk.id, name: desk.name })),
);
const kavibayActiveDeskId = computed(() => layoutDoc.activeDeskId);

/** Split live instance fields into catalog vs active-desk placement. */
function instanceToCatalogEntry(instance: WidgetInstance): WidgetCatalogEntry {
  return {
    instanceId: instance.instanceId,
    typeId: instance.typeId,
    ...(instance.title !== undefined ? { title: instance.title } : {}),
    ...(instance.hideTitle !== undefined ? { hideTitle: instance.hideTitle } : {}),
    ...(instance.appearance !== undefined ? { appearance: { ...instance.appearance } } : {}),
  };
}

/** Split live instance geometry/visibility into a desk placement row. */
function instanceToPlacement(instance: WidgetInstance): DeskPlacement {
  return {
    instanceId: instance.instanceId,
    offset: { x: instance.offset.x, y: instance.offset.y },
    ...(instance.hidden === true ? { hidden: true } : {}),
    ...(instance.hidden === true &&
    typeof instance.hiddenAt === "number" &&
    Number.isFinite(instance.hiddenAt)
      ? { hiddenAt: instance.hiddenAt }
      : {}),
    ...(instance.pinned === true ? { pinned: true } : {}),
    ...(typeof instance.width === "number" ? { width: instance.width } : {}),
    ...(typeof instance.height === "number" ? { height: instance.height } : {}),
    ...(typeof instance.contentScale === "number"
      ? { contentScale: instance.contentScale }
      : {}),
  };
}

/** Copy title/hideTitle/appearance from a live instance into its catalog entry. */
function syncCatalogFromInstance(instance: WidgetInstance): void {
  const entry = layoutDoc.catalog.find((row) => row.instanceId === instance.instanceId);
  if (!entry) return;
  if (instance.title === undefined) delete entry.title;
  else entry.title = instance.title;
  if (instance.hideTitle === undefined) delete entry.hideTitle;
  else entry.hideTitle = instance.hideTitle;
  if (instance.appearance === undefined) delete entry.appearance;
  else entry.appearance = { ...instance.appearance };
}

/** Replace reactive layoutDoc fields from a pure helper result. */
function applyLayoutDoc(next: SavedLayoutV4): void {
  layoutDoc.activeDeskId = next.activeDeskId;
  layoutDoc.desks = next.desks;
  layoutDoc.catalog = next.catalog;
}

/** Bind palette refs from the active desk in layoutDoc. */
function bindPaletteFromDoc(): void {
  const desk = activeDesk(layoutDoc);
  palettePos.x = desk.palette.x;
  palettePos.y = desk.palette.y;
  palettePinned.value = desk.palettePinned === true;
  paletteWidth.value =
    typeof desk.paletteWidth === "number" ? desk.paletteWidth : undefined;
  paletteListHeight.value =
    typeof desk.paletteListHeight === "number" ? desk.paletteListHeight : undefined;
}

/** Rebuild the live instances array from the active desk join. */
function reloadInstances(): void {
  const next = instancesForDesk(layoutDoc, layoutDoc.activeDeskId);
  instances.splice(0, instances.length, ...next);
  for (const instance of instances) {
    if (getExtension(instance.typeId)?.hugHeight && instance.height !== undefined) {
      delete instance.height;
    }
  }
}

/** Flush palette refs + live instances back into layoutDoc before persist/switch. */
function flushToDoc(): void {
  const desk = layoutDoc.desks.find((row) => row.id === layoutDoc.activeDeskId);
  if (!desk) return;
  desk.palette = { x: palettePos.x, y: palettePos.y };
  if (palettePinned.value) desk.palettePinned = true;
  else delete desk.palettePinned;
  if (typeof paletteWidth.value === "number") desk.paletteWidth = paletteWidth.value;
  else delete desk.paletteWidth;
  if (typeof paletteListHeight.value === "number") {
    desk.paletteListHeight = paletteListHeight.value;
  } else {
    delete desk.paletteListHeight;
  }
  // Remember the window size these coordinates belong to.
  const vp = currentViewportSize();
  desk.viewport = { width: vp.width, height: vp.height };
  adaptedViewport = { width: vp.width, height: vp.height };
  desk.placements = instances.map((instance) => instanceToPlacement(instance));
  for (const instance of instances) syncCatalogFromInstance(instance);
}

/**
 * Scale live palette/widgets from `from` into the current window size.
 * Keeps relative desk layout when opening on a different monitor/resolution.
 */
function scaleLiveLayout(from: ViewportSize, to: ViewportSize): void {
  if (from.width < 1 || from.height < 1) return;
  if (viewportsEqual(from, to)) return;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  palettePos.x *= sx;
  palettePos.y *= sy;
  if (typeof paletteWidth.value === "number") paletteWidth.value *= sx;
  if (typeof paletteListHeight.value === "number") {
    paletteListHeight.value *= sy;
  }
  for (const instance of instances) {
    instance.offset = {
      x: instance.offset.x * sx,
      y: instance.offset.y * sy,
    };
    if (typeof instance.width === "number") instance.width *= sx;
    if (typeof instance.height === "number") instance.height *= sy;
  }
}

/**
 * Ensure live geometry matches the current window. Call after bind/reload,
 * on resize, and when the hotkey may have moved us to another monitor.
 */
function ensureViewportAdaptation(persistAfter = false): void {
  void nextTick(recoverLayoutIntoViewport);
  const to = currentViewportSize();
  if (to.width < 1 || to.height < 1) return;

  if (adaptedViewport.width < 1 || adaptedViewport.height < 1) {
    // First bind: scale from the desk's saved (or inferred) viewport.
    const desk = activeDesk(layoutDoc);
    const from = resolveDeskViewport(desk, to);
    scaleLiveLayout(from, to);
    adaptedViewport = { width: to.width, height: to.height };
    if (persistAfter || !viewportsEqual(from, to) || desk.viewport) persist();
    return;
  }

  if (viewportsEqual(adaptedViewport, to)) return;
  scaleLiveLayout(adaptedViewport, to);
  adaptedViewport = { width: to.width, height: to.height };
  if (persistAfter) persist();
  else {
    // Keep desk.viewport in sync even when caller persists later.
    const desk = layoutDoc.desks.find((row) => row.id === layoutDoc.activeDeskId);
    if (desk) desk.viewport = { width: to.width, height: to.height };
  }
  scheduleRegionSync();
}

/** Bind active desk into live refs and adapt to the current monitor size. */
function syncActiveDeskToLive(persistAfter = false): void {
  bindPaletteFromDoc();
  reloadInstances();
  // Reset adaptation baseline so we scale from the desk's saved viewport.
  adaptedViewport = { width: 0, height: 0 };
  ensureViewportAdaptation(persistAfter);
}

/** Clear session focus/preview when the target is not on the active desk. */
function clearFocusIfNotOnActiveDesk(): void {
  const onDesk = new Set(instances.map((instance) => instance.instanceId));
  if (focusedInstanceId.value && !onDesk.has(focusedInstanceId.value)) {
    focusedInstanceId.value = null;
  }
  if (frontInstanceId.value && !onDesk.has(frontInstanceId.value)) {
    frontInstanceId.value = null;
  }
  if (previewInstanceId.value && !onDesk.has(previewInstanceId.value)) {
    previewInstanceId.value = null;
  }
  if (highlightedInstanceId.value && !onDesk.has(highlightedInstanceId.value)) {
    highlightedInstanceId.value = null;
  }
}

syncActiveDeskToLive(true);
const paletteAnchorEl = ref<HTMLElement | null>(null);
/**
 * Session cockpit: Default (non-pinned) palette/widgets are visible while open.
 * Closed by outside click or a Ctrl double tap; reopened the same way.
 * Pinned UI stays mounted independently. Persisted Hidden is unchanged.
 * Starts false — window is created hidden (`tauri.conf.json`).
 * Shared module ref so overlay-slot coach can read it without provide/inject.
 */
const cockpitOpen = kavibayCockpitOpen;
/** Session-only dismissal for the palette; desk widgets keep their cockpit state. */
const paletteHidden = ref(false);
/**
 * Hold-to-peek session (Ctrl+Space held down): the widgets are on screen
 * without the palette, and they go away again when the key comes back up.
 */
const peeking = ref(false);
/**
 * `paletteHidden` from before the peek started.
 *
 * A peek borrows that flag to suppress the palette, so it has to give back what
 * it found: somebody who had dismissed the palette with Escape must not get it
 * back merely because they peeked at the widgets once.
 */
let peekRestorePaletteHidden = false;
/**
 * Widgets the user reached into during a peek, by instance id.
 *
 * Holding Ctrl+Space is a glance, but clicking a widget mid-glance is not — it
 * says "this one I actually want". So a grabbed widget stays when the key comes
 * up while the rest of the peek disappears.
 *
 * Session-only on purpose, and deliberately not `pinned`: a pin is a decision the
 * user makes about a widget and gets written to the layout, whereas this is one
 * click that must not survive a restart or show up in their saved desk. It is
 * dropped when the widget is closed, and on the next ordinary cockpit close.
 */
const peekKept = ref(new Set<string>());

/** Forget a grab — the widget it named is gone, hidden, or the session ended. */
function releasePeekKept(instanceId: string) {
  peekKept.value.delete(instanceId);
}
/** Palette: pinned always, otherwise only with the cockpit session. */
const paletteVisible = computed(
  () => !paletteHidden.value && (palettePinned.value || cockpitOpen.value),
);

/** Whether an instance would mount if its extension were enabled. */
function wouldMountIgnoringEnable(instance: WidgetInstance): boolean {
  if (instance.hidden) return false;
  if (instance.pinned) return true;
  if (peekKept.value.has(instance.instanceId)) return true;
  return cockpitOpen.value || keepsAliveWhenHidden(instance);
}

/** Whether a widget needs to stay mounted while the cockpit is dismissed. */
function keepsAliveWhenHidden(instance: WidgetInstance): boolean {
  return defFor(instance.typeId)?.keepAliveWhenHidden === true;
}

/** Enabled instance that would mount under current cockpit/pinned/hidden rules. */
function isMountedInstance(instance: WidgetInstance): boolean {
  if (!isEnabled(instance.typeId)) return false;
  // Runtime types drop out when Developer Extensions is off or not enabled.
  if (!defFor(instance.typeId)) return false;
  return wouldMountIgnoringEnable(instance);
}

/** Mounted-instance ids for a desk-local instance list. */
function mountedIdsForInstances(rows: WidgetInstance[]): Set<string> {
  return new Set(
    rows.filter(isMountedInstance).map((instance) => instance.instanceId),
  );
}

/** Suspend instances leaving the mounted set; skip ids that will get onDispose instead. */
function suspendLeavingMountedSet(
  prevMountedIds: Set<string>,
  nextMountedIds: Set<string>,
  skipInstanceIds?: Set<string>,
) {
  for (const instance of instances) {
    if (!prevMountedIds.has(instance.instanceId)) continue;
    if (nextMountedIds.has(instance.instanceId)) continue;
    if (skipInstanceIds?.has(instance.instanceId)) continue;
    runExtensionHook(getExtension(instance.typeId), "onSuspend", instance.instanceId);
  }
}

/** Resume instances entering the mounted set after reloadInstances. */
function resumeEnteringMountedSet(
  prevMountedIds: Set<string>,
  nextMountedIds: Set<string>,
) {
  for (const instance of instances) {
    if (!nextMountedIds.has(instance.instanceId)) continue;
    if (prevMountedIds.has(instance.instanceId)) continue;
    runExtensionHook(getExtension(instance.typeId), "onResume", instance.instanceId);
  }
}

/**
 * Mounted widgets: enabled extension; not Hidden; pinned always; default only
 * while cockpit is open.
 */
const mountedInstances = computed(() =>
  instances.filter((instance) => isMountedInstance(instance)),
);

/** Mounted widgets that are actually visible; background widgets are excluded. */
const visibleMountedInstances = computed(() =>
  mountedInstances.value.filter(
    (instance) => cockpitOpen.value || survivesDismiss(instance, peekKept.value),
  ),
);

/** Rescan (or clear) AppData packages when the Developer Extensions gate changes. */
watch(developerExtensionsEnabled, () => {
  void rescanRuntimeExtensions();
  scheduleRegionSync();
});
/**
 * When Rust should report gap clicks as `cockpit:outside-click`. Settings owns
 * the dismiss while it is up, so stay disarmed under it.
 *
 * A widget grabbed out of a peek arms this on its own: the cockpit is closed by
 * then, but something of the user's is still on screen, and clicking away from it
 * has to mean the same thing it means for everything else.
 */
const outsideClickArmed = computed(
  () =>
    hideOnOutsideClick.value &&
    (cockpitOpen.value || hasKeptInstance(instances, peekKept.value)) &&
    !hostDismissHeld.value &&
    !settingsOpen.value,
);

/** Platforms where Rust cannot report gap clicks — asked once, see `needsDomGapCatcher`. */
const domGapCatcher = ref(false);

/**
 * Fullscreen catcher standing in for the native gap click. Same arming rules as
 * `outsideClickArmed`, so exactly one of the two mechanisms is ever live.
 */
const gapCatcherVisible = computed(() => domGapCatcher.value && outsideClickArmed.value);
let unlistenPaletteShow: UnlistenFn | undefined;
let unlistenPaletteHotkey: UnlistenFn | undefined;
let unlistenCockpitPeek: UnlistenFn | undefined;
let unlistenOutsideClick: UnlistenFn | undefined;
let unlistenQuickActionWidget: UnlistenFn | undefined;
let unlistenDraftChanged: UnlistenFn | undefined;
/** Instance currently showing the search flash highlight (null = none). */
const highlightedInstanceId = ref<string | null>(null);
/** Raised above sibling widgets while focused from search. */
const focusedInstanceId = ref<string | null>(null);
/** Last interacted widget — stays above siblings until another is raised. */
const frontInstanceId = ref<string | null>(null);
/** Instance scaled up while a matching palette row is selected (null = none). */
const previewInstanceId = ref<string | null>(null);
/** Brief scale pulse when keyboard focus moves to a widget. */
const focusPopInstanceId = ref<string | null>(null);
/** Active surface whose pin/hide controls advertise chords after a Ctrl hold. */
const shortcutHintTarget = ref<ShortcutHintTarget | null>(null);
let ctrlShortcutHintTimer: ReturnType<typeof setTimeout> | undefined;
let ctrlShortcutHintHeld = false;
/**
 * Which surface the user last interacted with: palette (true) or a widget
 * (false). Whatever is active paints above the rest, so a click-raised card can
 * no longer cover the palette the user is typing in.
 */
const paletteFront = ref(true);
let highlightClearTimer: ReturnType<typeof setTimeout> | undefined;
let focusPopClearTimer: ReturnType<typeof setTimeout> | undefined;
let focusPopFrame: number | undefined;

/** Persist layout-v4 (active desk palette + placements + catalog). */
function persist() {
  flushToDoc();
  saveLayout(toRaw(layoutDoc));
}

/** Snapshot move/resize geometry from live reactive layout state. */
function captureLiveGeometry(): LayoutGeometrySnapshot {
  return captureLayoutGeometry({
    palette: palettePos,
    paletteWidth: paletteWidth.value,
    paletteListHeight: paletteListHeight.value,
    instances,
  });
}

/** Apply a geometry snapshot and persist + refresh hit regions. */
function restoreGeometry(snapshot: LayoutGeometrySnapshot): void {
  applyLayoutGeometry(
    {
      palette: palettePos,
      instances,
      setPaletteWidth: (width) => {
        paletteWidth.value = width;
      },
      setPaletteListHeight: (height) => {
        paletteListHeight.value = height;
      },
    },
    snapshot,
  );
  persist();
  void nextTick(recoverLayoutIntoViewport);
  scheduleRegionSync();
}

const layoutHistory = new LayoutGeometryHistory();
/** Hide/Remove undo (max 5); shares Ctrl+Z with geometry via timestamps. */
const closeHistory = new WidgetCloseHistory();
/** Pre-gesture snapshot; committed on gesture end when geometry changed. */
let gestureBefore: LayoutGeometrySnapshot | null = null;
/** Wall-clock of last close vs geometry push — Ctrl+Z undoes the newer one. */
let lastCloseUndoAt = 0;
let lastGeometryUndoAt = 0;

/** Remember layout geometry at the start of a move/resize gesture. */
function beginLayoutGesture(): void {
  if (!gestureBefore) gestureBefore = captureLiveGeometry();
}

/** Push undo entry when the gesture actually changed geometry. */
function endLayoutGesture(): void {
  if (!gestureBefore) return;
  const after = captureLiveGeometry();
  if (!layoutGeometryEqual(gestureBefore, after)) {
    layoutHistory.pushBefore(gestureBefore);
    lastGeometryUndoAt = Date.now();
  }
  gestureBefore = null;
}

/** Record a Hide/Remove for Ctrl+Z. */
function pushCloseUndo(entry: WidgetCloseUndoEntry): void {
  closeHistory.push(entry);
  lastCloseUndoAt = Date.now();
}

/** True when Ctrl/Cmd+Z should leave text editing alone. */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

/** Ctrl/Cmd+Z undo close or geometry; Ctrl/Cmd+Y (or Shift+Z) redo geometry only. */
function onLayoutHistoryKeydown(event: KeyboardEvent): void {
  if (settingsOpen.value) return;
  if (isEditableKeyTarget(event.target)) return;
  if (drag) return;
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;

  const key = event.key.toLowerCase();
  const wantUndo = key === "z" && !event.shiftKey;
  const wantRedo = key === "y" || (key === "z" && event.shiftKey);
  if (!wantUndo && !wantRedo) return;

  event.preventDefault();
  event.stopPropagation();

  if (wantUndo) {
    // Prefer whichever action happened more recently (close vs move/resize).
    const preferClose =
      closeHistory.canUndo &&
      (!layoutHistory.canUndo || lastCloseUndoAt >= lastGeometryUndoAt);
    if (preferClose) {
      undoCloseAction();
      return;
    }
    const current = captureLiveGeometry();
    const prev = layoutHistory.undo(current);
    if (prev) restoreGeometry(prev);
    else if (closeHistory.canUndo) undoCloseAction();
    return;
  }
  const current = captureLiveGeometry();
  const next = layoutHistory.redo(current);
  if (next) restoreGeometry(next);
}

/** Reverse the newest Hide or Remove from `closeHistory`. */
function undoCloseAction(): void {
  const entry = closeHistory.pop();
  if (!entry) return;

  if (entry.kind === "hide") {
    void onFocusWidget(entry.instanceId);
    return;
  }

  flushToDoc();
  applyLayoutDoc(
    restoreRemovedInstance(cloneLayoutDoc(), entry.catalog, entry.placements),
  );
  reloadInstances();
  const typeId = entry.catalog.typeId;
  if (entry.disposed) {
    runExtensionHook(getExtension(typeId), "onCreate", entry.instanceId);
  } else {
    runExtensionHook(getExtension(typeId), "onResume", entry.instanceId);
  }
  persist();
  scheduleRegionSync();
  void onFocusWidget(entry.instanceId);
}

/**
 * Snapshot catalog + placements about to be dropped by Remove (for close undo).
 * Call after flushToDoc so live geometry is in layoutDoc.
 */
function snapshotRemoveUndo(
  instanceId: string,
  mode: "desk" | "everywhere",
): WidgetCloseUndoEntry | null {
  const catalogRaw = layoutDoc.catalog.find((row) => row.instanceId === instanceId);
  if (!catalogRaw) return null;
  const catalog = normalizeCatalogEntry(toRaw(catalogRaw));

  if (mode === "desk") {
    const deskId = layoutDoc.activeDeskId;
    const desk = layoutDoc.desks.find((row) => row.id === deskId);
    const placementRaw = desk?.placements.find((row) => row.instanceId === instanceId);
    if (!placementRaw) return null;
    const stillElsewhere = layoutDoc.desks.some(
      (d) =>
        d.id !== deskId &&
        d.placements.some((p) => p.instanceId === instanceId),
    );
    return {
      kind: "remove",
      instanceId,
      mode: "desk",
      disposed: !stillElsewhere,
      catalog,
      placements: [
        { deskId, placement: normalizePlacement(toRaw(placementRaw)) },
      ],
    };
  }

  const placements = layoutDoc.desks.flatMap((desk) =>
    desk.placements
      .filter((p) => p.instanceId === instanceId)
      .map((p) => ({
        deskId: desk.id,
        placement: normalizePlacement(toRaw(p)),
      })),
  );
  if (placements.length === 0) return null;
  return {
    kind: "remove",
    instanceId,
    mode: "everywhere",
    disposed: true,
    catalog,
    placements,
  };
}

/** Toggle whether the command palette survives outside-click dismiss. */
function onTogglePalettePinned() {
  const turningOff = palettePinned.value;
  palettePinned.value = !palettePinned.value;
  persist();
  // Unpin in pinned-only mode: keep palette up until the user dismisses.
  if (turningOff && !cockpitOpen.value) {
    void openCockpit();
    return;
  }
  scheduleRegionSync();
}

/** Build the center-based transform shared by palette and widgets. */
function centerTransform(cx: number, cy: number) {
  return { transform: `translate(calc(${cx}px - 50%), calc(${cy}px - 50%))` };
}

/** Position the palette around its persisted center point. */
function paletteStyle() {
  const base = centerTransform(palettePos.x, palettePos.y);
  if (typeof paletteWidth.value === "number") {
    return { ...base, width: `${paletteWidth.value}px` };
  }
  return base;
}

/** Position one widget from the palette center plus its instance offset. */
function widgetStyle(instance: WidgetInstance) {
  return centerTransform(
    palettePos.x + instance.offset.x,
    palettePos.y + instance.offset.y,
  );
}

/**
 * Resolve a persisted widget type via builtin registry or enabled runtime.
 * Lifecycle hooks still use getExtension (builtins only).
 */
function defFor(typeId: string): HostExtensionRef | undefined {
  return resolveExtension(typeId);
}

/** Open About with the effective UI values of this concrete widget instance. */
function onAbout(instance: WidgetInstance) {
  const def = defFor(instance.typeId);
  if (!def) return;
  showExtensionAbout(
    {
      title: def.title,
      // Empty until the lazy README chunk resolves; the modal patches it in.
      readme: "",
      ui: {
        defaultOffset: { ...instance.offset },
        defaultSize: {
          w: instance.width ?? def.defaultSize?.w ?? 280,
          h: instance.height ?? def.defaultSize?.h ?? 180,
        },
        defaultScale: instance.contentScale ?? def.defaultScale,
        defaultHideTitle: instance.hideTitle ?? def.defaultHideTitle,
      },
    },
    def.loadReadme,
  );
}

/**
 * When an extension is disabled/enabled, suspend/resume any instances that
 * would otherwise be mounted (layout is kept so re-enable restores them).
 */
watch(
  disabledIds,
  (ids, prevIds) => {
    const prev = new Set(prevIds ?? []);
    const next = new Set(ids);
    for (const instance of instances) {
      if (!wouldMountIgnoringEnable(instance)) continue;
      const wasEnabled = !prev.has(instance.typeId);
      const nowEnabled = !next.has(instance.typeId);
      if (wasEnabled && !nowEnabled) {
        runExtensionHook(getExtension(instance.typeId), "onSuspend", instance.instanceId);
      } else if (!wasEnabled && nowEnabled) {
        runExtensionHook(getExtension(instance.typeId), "onResume", instance.instanceId);
      }
    }
    scheduleRegionSync();
  },
  { deep: true },
);

type DragTarget =
  | { kind: "palette" }
  | { kind: "widget"; instanceId: string };

let drag:
  | {
      target: DragTarget;
      grabX: number;
      grabY: number;
      /** Cached at pointerdown — avoid layout thrash on every move. */
      width: number;
      height: number;
      /** Distance from the grabbed center to the highest card in this gesture. */
      topExtent: number;
      captureEl: HTMLElement;
      /**
       * Ctrl/Cmd+drag: translate the whole layout (palette + widgets).
       * Without it, only the grabbed element moves (palette-alone
       * compensates widget offsets so they stay put on screen).
       */
      moveGroup: boolean;
      /**
       * Widget drags only: where the card sat before the drag. Dropping onto the
       * palette moves the widget into the panel instead of to the pointer, and
       * the card should keep its old spot for when it comes back — not the place
       * over the palette where it was let go.
       */
      startOffset?: WidgetPosition;
    }
  | null = null;

/** Return the current screen center of a drag target. */
function centerOf(target: DragTarget): WidgetPosition {
  if (target.kind === "palette") return { x: palettePos.x, y: palettePos.y };
  const instance = instances.find((item) => item.instanceId === target.instanceId);
  const offset = instance?.offset ?? { x: 0, y: 0 };
  return { x: palettePos.x + offset.x, y: palettePos.y + offset.y };
}

/** A group must stop when its highest visible card reaches the viewport edge. */
function dragTopExtent(centerY: number, height: number, moveGroup: boolean): number {
  if (!moveGroup) return height / 2;
  let top = centerY - height / 2;
  for (const el of document.querySelectorAll<HTMLElement>(".widget-anchor, .palette-anchor")) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) top = Math.min(top, rect.top);
  }
  return centerY - top;
}

/** Start dragging the palette (capture/measure on the full palette anchor). */
function onPointerDown(event: PointerEvent, target: DragTarget) {
  if (event.button !== 0) return;

  const current = event.currentTarget as HTMLElement;
  // Palette: measure + capture the anchor so move/up handlers on it keep receiving events.
  const captureEl =
    target.kind === "palette" ? (paletteAnchorEl.value ?? current) : current;
  const measureEl = captureEl;
  const center = centerOf(target);
  const { width, height } = measureEl.getBoundingClientRect();
  const moveGroup = event.ctrlKey || event.metaKey;
  drag = {
    target,
    grabX: event.clientX - center.x,
    grabY: event.clientY - center.y,
    width,
    height,
    topExtent: dragTopExtent(center.y, height, moveGroup),
    captureEl,
    moveGroup,
  };

  beginLayoutGesture();
  captureEl.setPointerCapture(event.pointerId);
  setClickThroughPaused(true);
  event.preventDefault();
}

/**
 * Start a widget drag from the top drag strip.
 * Measure/clamp against the widget anchor; capture on that anchor.
 * Ctrl/Cmd moves the whole layout; plain drag moves only this widget.
 */
function onWidgetMovePointerDown(event: PointerEvent, instanceId: string) {
  if (event.button !== 0) return;
  const anchor = (event.target as HTMLElement | null)?.closest(
    ".widget-anchor",
  ) as HTMLElement | null;
  if (!anchor) return;

  const center = centerOf({ kind: "widget", instanceId });
  const { width, height } = anchor.getBoundingClientRect();
  const moveGroup = event.ctrlKey || event.metaKey;
  drag = {
    target: { kind: "widget", instanceId },
    grabX: event.clientX - center.x,
    grabY: event.clientY - center.y,
    width,
    height,
    topExtent: dragTopExtent(center.y, height, moveGroup),
    captureEl: anchor,
    moveGroup,
    startOffset: { ...(instances.find((i) => i.instanceId === instanceId)?.offset ?? { x: 0, y: 0 }) },
  };
  beginLayoutGesture();
  anchor.setPointerCapture(event.pointerId);
  setClickThroughPaused(true);
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Is the pointer over the palette right now?
 *
 * Measured against the anchor's rect rather than `elementFromPoint`, because the
 * dragged card is under the cursor and would answer for itself.
 */
function pointerOverPalette(event: PointerEvent): boolean {
  if (!paletteVisible.value) return false;
  const rect = paletteAnchorEl.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return false;
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/** Move the active drag target while keeping a resolution-scaled edge inset. */
function onPointerMove(event: PointerEvent) {
  if (!drag) return;

  const { width, height } = drag;
  const margin = viewportEdgeMargin({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  let { x: cx, y: cy } = clampCardCenter(
    { x: event.clientX - drag.grabX, y: event.clientY - drag.grabY },
    { width, height },
    currentViewportSize(),
    drag.topExtent,
  );

  // Grid mode: snap inside the margin inset so left/right edge gaps stay even.
  if (widgetLayoutMode.value === "grid") {
    const snapped = snapPositionInInset(
      { x: cx, y: cy },
      { width, height },
      {
        left: margin,
        top: margin,
        right: window.innerWidth - margin,
        bottom: window.innerHeight - margin,
      },
    );
    cx = snapped.x;
    cy = Math.max(snapped.y, drag.topExtent + margin);
  }

  if (drag.target.kind === "palette") {
    if (drag.moveGroup) {
      palettePos.x = cx;
      palettePos.y = cy;
    } else {
      // Move palette only: subtract the delta from every widget offset so
      // absolute widget positions stay fixed while the search bar moves.
      const dx = cx - palettePos.x;
      const dy = cy - palettePos.y;
      palettePos.x = cx;
      palettePos.y = cy;
      if (dx !== 0 || dy !== 0) {
        for (const item of instances) {
          item.offset = {
            x: item.offset.x - dx,
            y: item.offset.y - dy,
          };
        }
      }
    }
    return;
  }

  const instanceId = drag.target.instanceId;
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;

  // Dragging a card onto the palette hands it to the panel. Group-drag moves the
  // whole layout including the palette, so there is nothing to drop onto there.
  paletteDropActive.value = !drag.moveGroup && pointerOverPalette(event);

  if (drag.moveGroup) {
    // Keep the grabbed widget under the cursor; shift palette so all offsets stay put.
    palettePos.x = cx - instance.offset.x;
    palettePos.y = cy - instance.offset.y;
  } else {
    instance.offset = { x: cx - palettePos.x, y: cy - palettePos.y };
  }
}

/**
 * Finish a drag, persist it, and resume click-through handling.
 *
 * Also the handler for `pointercancel` and `lostpointercapture`: WebKitGTK cancels
 * a pointer far more readily than Windows does, and without those a cancelled drag
 * never ran this cleanup — click-through stayed paused and, worse, the capture
 * stayed on the palette anchor, which then swallowed the `pointerdown` of every
 * later widget drag.
 */
function onPointerUp(event: PointerEvent) {
  if (!drag) return;
  const movedWidgetId =
    drag.target.kind === "widget" ? drag.target.instanceId : null;
  const { captureEl } = drag;
  // Released over the palette: this was a move into the panel, not to a spot on
  // the desk, so put the card's offset back before handing the widget over.
  const droppedOnPalette = paletteDropActive.value && movedWidgetId !== null;
  const restoreOffset = drag.startOffset;
  paletteDropActive.value = false;
  // Clear the state before touching the DOM. `releasePointerCapture` throws
  // NotFoundError once the pointer is already released, and that exception used to
  // strand every line below it — leaving `drag` set and click-through paused.
  drag = null;
  if (captureEl.hasPointerCapture(event.pointerId)) {
    captureEl.releasePointerCapture(event.pointerId);
  }
  endLayoutGesture();
  if (droppedOnPalette && movedWidgetId) {
    const moved = instances.find((item) => item.instanceId === movedWidgetId);
    if (moved && restoreOffset) moved.offset = { ...restoreOffset };
  }
  persist();
  setClickThroughPaused(false);
  syncInteractiveRegions();
  if (droppedOnPalette && movedWidgetId) {
    onMoveToPanel(movedWidgetId);
    return;
  }
  if (movedWidgetId) {
    const moved = instances.find((item) => item.instanceId === movedWidgetId);
    if (moved) onboarding.notifyWidgetMoved(moved.typeId);
  }
}

/** Duplicate one instance on the active desk and run onDuplicate. */
async function onDuplicate(instanceId: string) {
  const source = instances.find((item) => item.instanceId === instanceId);
  if (!source) return;

  const copy = duplicateInstance(source);
  await runDuplicateHook(getExtension(source.typeId), source.instanceId, copy.instanceId);
  flushToDoc();
  applyLayoutDoc(
    addCatalogInstance(
      toRaw(layoutDoc),
      instanceToCatalogEntry(copy),
      instanceToPlacement(copy),
    ),
  );
  reloadInstances();
  // A duplicate is a new working surface, so take the same focus path as a
  // palette Focus action (including editor focus for widgets such as Notes).
  void onFocusWidget(copy.instanceId);
  persist();
  scheduleRegionSync();
}

/** Persist a custom title (or clear it when undefined). */
function onRename(instanceId: string, title: string | undefined) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (title === undefined) {
    delete instance.title;
  } else {
    instance.title = title;
  }
  persist();
  scheduleRegionSync();
}

/** Persist title visibility for one instance. */
function onHideTitle(instanceId: string, hideTitle: boolean) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (hideTitle) {
    instance.hideTitle = true;
  } else {
    delete instance.hideTitle;
  }
  persist();
  scheduleRegionSync();
}

/**
 * Merge one changed field into an instance's own surface, or drop it on null
 * so the manifest's look applies again. Merged here, against what is stored,
 * rather than in the form, whose props may not have caught up yet.
 */
function onAppearance(instanceId: string, patch: WidgetAppearance | null) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  const next = patch ? normalizeWidgetAppearance({ ...instance.appearance, ...patch }) : undefined;
  if (next) instance.appearance = next;
  else delete instance.appearance;
  persist();
}

/**
 * When no open cards remain, return keyboard focus to the command palette.
 * Palette must still be visible (cockpit or pinned).
 */
function focusPaletteIfNoCardsLeft() {
  void nextTick(() => {
    if (mountedInstances.value.length > 0) return;
    if (!paletteVisible.value) return;
    void emit("palette:show");
  });
}

/**
 * Soft-hide one instance (keeps settings and offset; unmounts card).
 * Records `hiddenAt` so the palette Hidden list puts last-closed first.
 */
function onHide(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance || instance.hidden === true) return;
  pushCloseUndo({ kind: "hide", instanceId });
  runExtensionHook(getExtension(instance.typeId), "onSuspend", instance.instanceId);
  instance.hidden = true;
  instance.hiddenAt = Date.now();
  if (focusedInstanceId.value === instanceId) focusedInstanceId.value = null;
  if (frontInstanceId.value === instanceId) frontInstanceId.value = null;
  if (previewInstanceId.value === instanceId) previewInstanceId.value = null;
  releasePeekKept(instanceId);
  persist();
  scheduleRegionSync();
  focusPaletteIfNoCardsLeft();
  const def = defFor(instance.typeId);
  const displayName = instance.title?.trim() || def?.title || instance.typeId;
  onboarding.notifyWidgetHidden(instance.typeId, displayName);
}

/** Click into the palette makes it the active surface again (above all cards). */
function raisePalette() {
  paletteFront.value = true;
}

/** Bring a widget above overlapping siblings (click / drag / chrome). */
function raiseWidget(instanceId: string) {
  // Reaching into a widget mid-peek is the request to keep it: this fires from
  // `pointerdown.capture`, so it lands before anything inside the card can stop
  // the event, and long before the peek key comes back up.
  if (peeking.value) peekKept.value.add(instanceId);
  frontInstanceId.value = instanceId;
  // The clicked card is now the active surface — palette drops behind it, and a
  // stale keyboard focus on another card must not keep that one on top.
  paletteFront.value = false;
  if (focusedInstanceId.value !== instanceId) focusedInstanceId.value = null;
  /**
   * Touching a card also ends the palette's ↑/↓ preview, exactly as taking
   * keyboard focus into one does (`onFocusWidget`). The palette only pushes a
   * new target when its selection moves, so without this the ring would stay on
   * the arrowed-at card after clicking into another.
   */
  if (previewInstanceId.value !== instanceId) previewInstanceId.value = null;
}

/**
 * Keyboard focus landed inside a card: that card is the focused widget, however
 * focus got there.
 *
 * `onFocusWidget` is only one of the ways in — a click into a text field, Tab
 * between controls, or a widget focusing itself on mount all arrive here and
 * nowhere else. Without this, `--focused` meant "focused *from search*" while
 * the class it drives claims to mean focused, so a widget being typed into sat
 * at the click-raise layer (300) under any card with an open ⋯ menu (310).
 *
 * Cheap to fire often: `focusin` bubbles from every control inside the card, and
 * assigning the id it already holds is a no-op for Vue.
 */
function onCardFocusIn(instanceId: string) {
  focusedInstanceId.value = instanceId;
  frontInstanceId.value = instanceId;
  paletteFront.value = false;
}

/** Toggle pin state for one widget and persist the layout. */
function onTogglePin(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance || instance.hidden) return;

  if (instance.pinned) {
    delete instance.pinned;
    persist();
    onboarding.notifyPinToggled(instance.typeId);
    // Unpin in pinned-only mode: keep the card up until the user dismisses.
    if (!cockpitOpen.value) {
      void openCockpit();
      return;
    }
    scheduleRegionSync();
    return;
  }

  instance.pinned = true;
  persist();
  onboarding.notifyPinToggled(instance.typeId);
  scheduleRegionSync();
}

/** Move the palette to the viewport center; keep widgets fixed on screen. */
function centerPalette() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const dx = cx - palettePos.x;
  const dy = cy - palettePos.y;
  if (dx === 0 && dy === 0) return;
  palettePos.x = cx;
  palettePos.y = cy;
  for (const instance of instances) {
    instance.offset = {
      x: instance.offset.x - dx,
      y: instance.offset.y - dy,
    };
  }
  persist();
  scheduleRegionSync();
}

/**
 * Resume default widgets and show the non-pinned palette (cockpit open).
 *
 * `alreadyShown` is true when Rust revealed the window before emitting the
 * hotkey. Repeating show/focus from here is not free — each is an IPC round trip
 * that ends in a native call on a fullscreen transparent window — and it buys
 * nothing the hotkey path has not already done.
 *
 * `withPalette` is false for the hold-to-peek hotkey, which shows the widgets
 * alone. That is a different opening, not a different screen: everything else
 * here (resume hooks, rescale, hit-test) is what makes the widgets usable and
 * must run either way.
 */
async function openCockpit(alreadyShown = false, withPalette = true) {
  // Double tap / tray open puts keyboard focus in the search field.
  paletteHidden.value = !withPalette;
  paletteFront.value = withPalette;
  const win = getCurrentWindow();
  // Pause click-through so the window is interactable before rects are reported.
  setClickThroughPaused(true);
  if (!alreadyShown) {
    // Fire show/focus without serial awaits — this path covers openers that
    // reach the host without Rust having shown the window (palette commands).
    void win.show().then(() => win.setFocus());
  }

  const opening = !cockpitOpen.value;
  if (opening) {
    cockpitOpen.value = true;
  }

  // Resume widgets + hit-test after first paint so the palette isn't blocked.
  requestAnimationFrame(() => {
    // Hotkey may have moved the window onto another monitor — rescale first.
    ensureViewportAdaptation(true);
    if (opening) {
      for (const instance of instances) {
        if (instance.pinned || instance.hidden) continue;
        if (!isEnabled(instance.typeId)) continue;
        if (keepsAliveWhenHidden(instance)) continue;
        runExtensionHook(getExtension(instance.typeId), "onResume", instance.instanceId);
      }
    }
    void nextTick().then(() => {
      syncInteractiveRegions();
      setClickThroughPaused(false);
      scheduleRegionSync();
    });
  });
}

/** Hide only the palette; visible desk widgets remain mounted and running. */
function onHidePalette() {
  paletteHidden.value = true;
  paletteFront.value = false;
  if (visibleMountedInstances.value.length === 0) {
    void getCurrentWindow().hide();
  } else {
    scheduleRegionSync();
  }
}

/**
 * Hide default (non-pinned) palette/widgets for this session.
 * Pinned UI stays; window hides only when nothing pinned remains.
 */
function closeCockpit(options: { keepPeeked?: boolean } = {}) {
  // Only the release of a peek hands its grabs forward; every other close is the
  // user putting the desk away, and that includes what they grabbed.
  const releasing = options.keepPeeked ? new Set<string>() : new Set(peekKept.value);
  if (!options.keepPeeked) peekKept.value.clear();
  if (cockpitOpen.value) {
    for (const instance of instances) {
      if (instance.pinned || instance.hidden) continue;
      if (!isEnabled(instance.typeId)) continue;
      if (keepsAliveWhenHidden(instance)) continue;
      // A grabbed widget stays on screen, so it must keep running too.
      if (peekKept.value.has(instance.instanceId)) continue;
      runExtensionHook(getExtension(instance.typeId), "onSuspend", instance.instanceId);
    }
    cockpitOpen.value = false;
  } else {
    // The cockpit was already closed, so the only thing leaving the screen is
    // what the user grabbed out of a peek — and that one was skipped by the loop
    // above when the peek ended, so it has been running ever since. Without this
    // it would keep polling behind a hidden window.
    for (const instance of instances) {
      if (!releasing.has(instance.instanceId)) continue;
      if (instance.pinned || instance.hidden) continue;
      if (!isEnabled(instance.typeId)) continue;
      if (keepsAliveWhenHidden(instance)) continue;
      runExtensionHook(getExtension(instance.typeId), "onSuspend", instance.instanceId);
    }
  }
  if (!shouldKeepWindowAfterDismiss(instances, palettePinned.value, peekKept.value)) {
    void getCurrentWindow().hide();
  } else {
    scheduleRegionSync();
  }
}

/**
 * Toggle: close only when the cockpit is already visible; otherwise open.
 * `revealedByRust` is true when Rust showed a previously hidden window — in that
 * case always open (avoids flash-close after launch hid the window without
 * clearing cockpitOpen).
 */
function onPaletteHotkey(revealedByRust = false) {
  // The setup card owns the screen until it is answered, and `paletteHidden` is
  // true *on purpose* while it is up — so every branch below would read that as
  // "the palette is away, bring it back" and put a search field behind the one
  // thing the user is being asked to read. Rust may still have revealed the
  // window on the way in; leaving it visible with the card on it is correct.
  if (isSetupVisible(setupState.value)) return;
  // A toggle during a peek keeps what the peek put on screen: the session
  // stops being a peek, so releasing the peek key no longer takes it away.
  if (peeking.value) {
    peeking.value = false;
    void openCockpit(true);
    void emit("palette:show");
    return;
  }
  if (paletteHidden.value) {
    void openCockpit(revealedByRust);
    // Focus search field (CommandPalette listens; host open is idempotent).
    void emit("palette:show");
    return;
  }
  if (cockpitOpen.value && !revealedByRust) {
    closeCockpit();
    return;
  }

  void openCockpit(revealedByRust);
  // Focus search field (CommandPalette listens; host open is idempotent).
  void emit("palette:show");
}

/**
 * The closing half of the Ctrl double tap.
 *
 * Rust owns the opening half, but on Windows and macOS alike it sees no keys at
 * all once our own webview holds the keyboard focus — and focus is exactly when
 * these events reach us, so the two halves cover disjoint cases without needing
 * to coordinate.
 * The condition is deliberately *not* `cockpitOpen`: a widget grabbed out of a
 * peek keeps the window up and focused with the cockpit closed, and the toggle
 * has to work there too.
 *
 * `onPaletteHotkey` is the same entry Rust uses, so both halves land on one
 * toggle rather than two that can disagree.
 */
let ctrlTap: CtrlTapState = emptyCtrlTapState();
/** When Rust last delivered a toggle — see the belt-and-braces check below. */
let lastRustHotkeyAt = 0;
function onCtrlTapKey(event: KeyboardEvent) {
  const observed = classifyCtrlKey(event.type as "keydown" | "keyup", event.key);
  if (!observed) return;
  const result = observeCtrlTap(ctrlTap, observed, event.timeStamp);
  ctrlTap = result.state;
  if (!result.doubleTap) return;
  // Measured behaviour says the hook is blind whenever we can see these keys, so
  // this should never be true. It is cheap insurance against the one failure it
  // would otherwise cause — a toggle counted twice, which closes and instantly
  // reopens and reads as the hotkey being broken.
  if (Date.now() - lastRustHotkeyAt < 600) return;
  onPaletteHotkey(false);
}

/**
 * Hold-to-peek: show the widgets while the key is down, take them away on release.
 *
 * Rust reveals the window on the press half and never hides it again — only the
 * host knows whether pinned widgets have to survive the release, and that rule
 * already lives in `closeCockpit`.
 */
function onPeekHotkey(pressed: boolean, revealedByRust: boolean) {
  const action = resolvePeek({
    pressed,
    cockpitOpen: cockpitOpen.value,
    peeking: peeking.value,
  });
  if (action === "ignore") return;
  if (action === "open") {
    peeking.value = true;
    peekRestorePaletteHidden = paletteHidden.value;
    void openCockpit(revealedByRust, false);
    return;
  }
  peeking.value = false;
  closeCockpit({ keepPeeked: true });
  paletteHidden.value = peekRestorePaletteHidden;
}

/** Outside click closes the cockpit session (non-pinned UI disappears). */
function onDismissOutside() {
  // Settings / gallery own the fullscreen layer — don't dismiss the cockpit under them.
  if (settingsOpen.value) return;
  closeCockpit();
}

/** Toggle persisted Hidden for palette search (open ↔ closed). */
function onToggleWidget(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (instance.hidden) {
    onRevealWidget(instanceId);
  } else {
    onHide(instanceId);
  }
}

/**
 * "Move to main panel": take the card off the desk and let the palette render
 * this instance instead. Hiding is the existing way for an instance to stay
 * itself while giving up its card, so the trip back is the panel's ↗ button
 * (or Show from the palette row) — nothing about the widget is lost either way.
 */
function onMoveToPanel(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  const typeId = instance.typeId;
  if (!instance.hidden) {
    onHide(instanceId);
    // Hiding means "off screen" and suspends the widget, but this one is about
    // to be on screen in the panel — a suspended clock would sit there frozen.
    runExtensionHook(getExtension(typeId), "onResume", instanceId);
  }
  // A keyboard move can start from a desk card while the palette is closed.
  // Open it before sending the request so the inline target is immediately visible.
  openCockpit();
  requestInlineWidget(instanceId, typeId);
}

/** Clear persisted Hidden and open the cockpit so a default widget can appear. */
function onRevealWidget(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  const wasHidden = instance.hidden === true;
  if (wasHidden) {
    delete instance.hidden;
    delete instance.hiddenAt;
    // Also clear the active-desk placement flag directly so a later flush cannot
    // resurrect Hidden from a stale placement row.
    const desk = layoutDoc.desks.find((row) => row.id === layoutDoc.activeDeskId);
    const placement = desk?.placements.find((row) => row.instanceId === instanceId);
    if (placement) {
      delete placement.hidden;
      delete placement.hiddenAt;
    }
    persist();
    // Purge other soft-hidden-only copies of this type (Gallery/New orphans).
    disposePurgedHidden(instance.typeId);
  }
  openCockpit();
  // Pinned + was Hidden: not covered by cockpit session resume.
  if (wasHidden && instance.pinned) {
    runExtensionHook(getExtension(instance.typeId), "onResume", instance.instanceId);
  }
  if (wasHidden) onboarding.notifyWidgetRestored(instance.typeId);
  onboarding.notifyWidgetVisible(instance.typeId);
  scheduleRegionSync();
}

/**
 * Remove soft-hidden-only catalog siblings for a type and run onDispose.
 * Call after show/remove so the Hidden filter matches real leftovers.
 */
function disposePurgedHidden(typeId: string) {
  flushToDoc();
  const { layout, removedInstanceIds } = purgeRedundantHiddenInstances(
    cloneLayoutDoc(),
    instanceHoldsData,
    typeId,
  );
  if (removedInstanceIds.length === 0) return;
  applyLayoutDoc(layout);
  reloadInstances();
  for (const id of removedInstanceIds) {
    runExtensionHook(getExtension(typeId), "onDispose", id);
  }
  persist();
}

/** Flash a colorful border on a widget for ~1s (search-result ping). */
function onHighlightWidget(instanceId: string) {
  highlightedInstanceId.value = instanceId;
  if (highlightClearTimer !== undefined) clearTimeout(highlightClearTimer);
  highlightClearTimer = setTimeout(() => {
    if (highlightedInstanceId.value === instanceId) {
      highlightedInstanceId.value = null;
    }
    highlightClearTimer = undefined;
  }, 900);
}

/**
 * Mark a mounted widget while its palette row is selected (↑/↓ preview).
 * Pass null to clear. Does not restack, flash, or steal input focus — the
 * card keeps its place, scales slightly, and WidgetCard draws a ring.
 */
function onPreviewWidget(instanceId: string | null) {
  previewInstanceId.value = instanceId;
}

/** Clear keyboard-focus raise state (e.g. Shift+Tab back to search). */
function onClearWidgetFocus() {
  focusedInstanceId.value = null;
  // Keyboard focus is back in the palette — it becomes the active surface.
  paletteFront.value = true;
}

const NUDGE_PX = 10;

/** Cycle keyboard focus through visible widgets on the active desk. */
function onCycleWidgetFocusKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") return;

  const openIds = mountedInstances.value
    .filter((instance) => instance.hidden !== true)
    .map((instance) => instance.instanceId);
  const currentId = paletteFront.value ? null : (focusedInstanceId.value ?? frontInstanceId.value);
  const nextId = nextWidgetFocusId(openIds, currentId, event.shiftKey);

  event.preventDefault();
  event.stopPropagation();
  if (!nextId) {
    if (paletteFront.value) return;
    onClearWidgetFocus();
    window.dispatchEvent(new CustomEvent("kavibay:focus-palette"));
    return;
  }
  void onFocusWidget(nextId);
}

/**
 * Ctrl+Alt+S jumps straight into the palette search from anywhere.
 *
 * `event.code` rather than `event.key`: Ctrl+Alt is AltGr on Windows layouts,
 * and AltGr can rewrite `key` into whatever character the layout composes.
 * Capture-phase, like the other host chords, so a widget owning plain letters
 * (Snake, Notes) cannot swallow it first.
 */
function onFocusSearchKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
  if (event.code !== "KeyS") return;

  event.preventDefault();
  event.stopPropagation();
  onClearWidgetFocus();
  // Select what is already typed — the chord means "search for something",
  // so the old query should give way to the first keystroke.
  window.dispatchEvent(
    new CustomEvent("kavibay:focus-palette", { detail: { select: true } }),
  );
}

/** Reuse the palette preview scale as a short focus-confirmation pulse. */
function onFocusPop(instanceId: string) {
  if (focusPopClearTimer !== undefined) clearTimeout(focusPopClearTimer);
  if (focusPopFrame !== undefined) cancelAnimationFrame(focusPopFrame);
  focusPopInstanceId.value = null;
  focusPopFrame = requestAnimationFrame(() => {
    focusPopInstanceId.value = instanceId;
    focusPopClearTimer = setTimeout(() => {
      if (focusPopInstanceId.value === instanceId) focusPopInstanceId.value = null;
      focusPopClearTimer = undefined;
    }, 240);
    focusPopFrame = undefined;
  });
}

/**
 * Ctrl+Shift+arrows nudge the keyboard-focused widget by 10px and persist.
 * Capture-phase so it works while Snake/Notes own normal arrow keys.
 */
function onNudgeKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;

  let dx = 0;
  let dy = 0;
  switch (event.key) {
    case "ArrowUp":
      dy = -NUDGE_PX;
      break;
    case "ArrowDown":
      dy = NUDGE_PX;
      break;
    case "ArrowLeft":
      dx = -NUDGE_PX;
      break;
    case "ArrowRight":
      dx = NUDGE_PX;
      break;
    default:
      return;
  }

  const id = focusedInstanceId.value;
  if (!id) return;
  const instance = instances.find((item) => item.instanceId === id);
  if (!instance || instance.hidden) return;
  if (!mountedInstances.value.some((item) => item.instanceId === id)) return;

  event.preventDefault();
  event.stopPropagation();
  beginLayoutGesture();
  instance.offset = {
    x: instance.offset.x + dx,
    y: instance.offset.y + dy,
  };
  ensureInstanceOnScreen(instance);
  endLayoutGesture();
  persist();
  scheduleRegionSync();
}

/** Move the active palette or widget by one drag-grid gap per arrow press. */
function onGapMoveKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;

  let dx = 0;
  let dy = 0;
  switch (event.key) {
    case "ArrowUp":
      dy = -GRID_GAP;
      break;
    case "ArrowDown":
      dy = GRID_GAP;
      break;
    case "ArrowLeft":
      dx = -GRID_GAP;
      break;
    case "ArrowRight":
      dx = GRID_GAP;
      break;
    default:
      return;
  }

  // Palette focus wins over the last-clicked widget, matching the other host
  // chords. A hidden palette cannot own the chord even if its input kept focus.
  const paletteActive = paletteVisible.value &&
    (paletteHasDomFocus() || paletteFront.value);
  const target = paletteActive ? null : widgetChordTarget();
  if (!paletteActive && !target) return;

  event.preventDefault();
  event.stopPropagation();
  beginLayoutGesture();

  if (paletteActive) {
    // Match a plain palette drag: move only the palette and compensate widget
    // offsets so their absolute screen positions do not jump.
    palettePos.x += dx;
    palettePos.y += dy;
    if (dx !== 0 || dy !== 0) {
      for (const item of instances) {
        item.offset = {
          x: item.offset.x - dx,
          y: item.offset.y - dy,
        };
      }
    }
  } else if (target) {
    target.offset = {
      x: target.offset.x + dx,
      y: target.offset.y + dy,
    };
    ensureInstanceOnScreen(target);
  }

  if (paletteActive) ensurePaletteOnScreen();

  endLayoutGesture();
  persist();
  scheduleRegionSync();
}

/**
 * Ctrl+Shift+1…9 switches to the Nth desk (1-based, same order as palette tabs).
 * Uses event.code so Shift does not turn "1" into "!".
 */
function onDeskSwitchKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return;
  const index = Number(match[1]) - 1;
  const desks = layoutDoc.desks;
  if (index < 0 || index >= desks.length) return;
  event.preventDefault();
  event.stopPropagation();
  const deskId = desks[index]?.id;
  if (!deskId || deskId === layoutDoc.activeDeskId) return;
  kavibaySwitchDesk(deskId);
}

/** Instance id of the card the DOM focus currently sits in, if any. */
function focusedCardInstanceId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const anchor = active.closest<HTMLElement>("[data-widget-instance]");
  return anchor?.dataset.widgetInstance ?? null;
}

/** True while the DOM focus sits anywhere inside the palette (search, rows, menus). */
function paletteHasDomFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return active.closest(".palette-anchor") != null;
}

/**
 * Ctrl/Cmd+W or Ctrl/Cmd+H closes/hides the widget you are in, Ctrl/Cmd+R
 * removes it — the palette chords, without going back to the palette to reach them.
 *
 * Capture-phase like the other host chords, so a widget that owns plain keys
 * (Snake, Notes) cannot swallow them first. Text fields inside a card are
 * deliberately *not* exempt the way Ctrl+Z is: neither chord means anything to
 * an editor, and Notes would otherwise be the one widget this never worked in.
 * Remove stays undoable (Ctrl+Z, five deep).
 */
/**
 * The card a widget chord applies to: mounted, on screen, and resolved by the
 * shared "where is the user" rules. Null means the chord belongs to nobody —
 * typing in the palette, or a target that is hidden or unmounted.
 */
function widgetChordTarget(): WidgetInstance | null {
  const instanceId = resolveWidgetCloseTarget({
    paletteHasFocus: paletteHasDomFocus(),
    domInstanceId: focusedCardInstanceId(),
    focusedInstanceId: focusedInstanceId.value,
    frontInstanceId: frontInstanceId.value,
    paletteFront: paletteFront.value,
  });
  if (!instanceId) return null;

  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance || instance.hidden) return null;
  if (!mountedInstances.value.some((item) => item.instanceId === instanceId)) return null;
  return instance;
}

/** Find the surface that owns the current keyboard focus/click target. */
function resolveShortcutHintTarget(): ShortcutHintTarget | null {
  if (settingsOpen.value) return null;
  if (paletteHasDomFocus()) return { kind: "palette" };
  const widget = widgetChordTarget();
  return widget ? { kind: "widget", instanceId: widget.instanceId } : null;
}

/** Cancel a pending/visible Ctrl shortcut hint. */
function clearCtrlShortcutHint() {
  if (ctrlShortcutHintTimer !== undefined) {
    clearTimeout(ctrlShortcutHintTimer);
    ctrlShortcutHintTimer = undefined;
  }
  ctrlShortcutHintHeld = false;
  shortcutHintTarget.value = null;
}

/** Show pin/hide shortcut hints once Ctrl has been held on an active surface. */
function onCtrlShortcutHintKeydown(event: KeyboardEvent) {
  // Ctrl+Alt is reserved for movement/search chords, never for discoverability
  // hints. Cancel both a pending timer and already-visible hints immediately.
  if (event.key === "Alt") {
    clearCtrlShortcutHint();
    return;
  }
  if (event.key !== "Control" && event.key !== "Meta") return;
  if (event.altKey) {
    clearCtrlShortcutHint();
    return;
  }
  if (event.repeat || ctrlShortcutHintHeld) return;
  ctrlShortcutHintHeld = true;
  ctrlShortcutHintTimer = setTimeout(() => {
    ctrlShortcutHintTimer = undefined;
    if (!ctrlShortcutHintHeld) return;
    shortcutHintTarget.value = resolveShortcutHintTarget();
  }, CTRL_SHORTCUT_HINT_DELAY_MS);
}

/** Hide the shortcut hints as soon as the modifier is released. */
function onCtrlShortcutHintKeyup(event: KeyboardEvent) {
  if (event.key === "Control" || event.key === "Meta") clearCtrlShortcutHint();
}

/** Avoid leaving hints visible when the webview loses keyboard focus. */
function onCtrlShortcutHintBlur() {
  clearCtrlShortcutHint();
}

/** Settings takes over the surface, so no underlying pin/hide hint survives. */
watch(settingsOpen, (open) => {
  if (open) clearCtrlShortcutHint();
});

/** Modifier shape shared by the single-letter card chords (Ctrl/Cmd, no Shift/Alt). */
function isCardChord(event: KeyboardEvent, letter: string): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.altKey || event.shiftKey) return false;
  return (event.key.length === 1 ? event.key.toLowerCase() : event.key) === letter;
}

/**
 * Ctrl/Cmd+S pins the widget you are working in, the same toggle the card's
 * pin dot offers. No Shift/Alt, so it stays clear of Ctrl+Alt+S (palette
 * search) — which on Windows layouts arrives as AltGr+S with ctrlKey set.
 */
function onPinKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (drag) return;
  if (!isCardChord(event, "s")) return;

  const target = widgetChordTarget();
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  onTogglePin(target.instanceId);
}

/**
 * Ctrl/Cmd+D duplicates the widget you are working in.
 *
 * Types that opt out (`allowDuplicate: false`) are skipped: the card menu hides
 * Duplicate for them, and a chord must not reach past what the UI offers.
 */
function onDuplicateKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (drag) return;
  if (!isCardChord(event, "d")) return;

  const target = widgetChordTarget();
  if (!target) return;
  if (getExtension(target.typeId)?.allowDuplicate === false) return;

  event.preventDefault();
  event.stopPropagation();
  onDuplicate(target.instanceId);
}

/** Ctrl/Cmd+O moves the focused desk card into the palette's inline surface. */
function onMoveToPanelKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (drag) return;
  if (!isCardChord(event, "o")) return;

  const target = widgetChordTarget();
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  onMoveToPanel(target.instanceId);
}

function onWidgetCloseKeydown(event: KeyboardEvent) {
  if (settingsOpen.value) return;
  if (drag) return;

  const action = matchWidgetCloseKey(event);
  if (!action) return;

  const target = widgetChordTarget();
  if (!target) return;
  const instanceId = target.instanceId;

  event.preventDefault();
  event.stopPropagation();
  if (action === "hide") {
    onHide(instanceId);
    return;
  }
  // Same scope the palette's Ctrl+R uses: one chord, one meaning, whichever
  // surface it was pressed on. The desk-only variant stays a menu choice.
  onRemove(instanceId, "everywhere");
}

/**
 * Bring a widget to the front, flash it, and ask it to take input focus
 * (Notes focuses the TipTap editor). Used by palette note findings.
 */
async function onFocusWidget(instanceId: string, openPackageId?: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  // Tab / Enter focus ends the live selection preview.
  previewInstanceId.value = null;
  const wasHidden = instance.hidden === true;
  onRevealWidget(instanceId);
  // Spawn offsets (or old layouts) can leave the card outside the window.
  if (ensureInstanceOnScreen(instance)) persist();
  focusedInstanceId.value = instanceId;
  frontInstanceId.value = instanceId;
  // Focus moved into the card (Tab / Enter on a search hit) — palette steps back.
  paletteFront.value = false;
  onHighlightWidget(instanceId);
  onFocusPop(instanceId);

  const dispatchFocus = () => {
    window.dispatchEvent(
      new CustomEvent(WIDGET_FOCUS_EVENT, {
        detail: {
          instanceId,
          surface: "desk" satisfies WidgetSurface,
          ...(openPackageId ? { openPackageId } : {}),
        },
      }),
    );
  };

  await nextTick();
  if (wasHidden) await nextTick();
  dispatchFocus();
  // TipTap may still be mounting after a reveal — retry once.
  window.setTimeout(dispatchFocus, 60);
}

/**
 * Keep the card inside the viewport, measuring auto-height widgets instead of
 * guessing their height. Returns true when its offset changed.
 */
function ensureInstanceOnScreen(instance: WidgetInstance, measuredSize?: ViewportSize): boolean {
  const rect = measuredSize ?? document.querySelector<HTMLElement>(
    `[data-widget-instance="${CSS.escape(instance.instanceId)}"]`,
  )?.getBoundingClientRect();
  const w =
    typeof instance.width === "number" && Number.isFinite(instance.width)
      ? instance.width
      : (rect?.width || 340);
  const h =
    typeof instance.height === "number" && Number.isFinite(instance.height)
      ? instance.height
      : (rect?.height || 220);
  const cx = palettePos.x + instance.offset.x;
  const cy = palettePos.y + instance.offset.y;
  const { x: nx, y: ny } = clampCardCenter(
    { x: cx, y: cy },
    measuredSize ?? { width: w, height: h },
    currentViewportSize(),
  );
  if (nx === cx && ny === cy) return false;
  instance.offset = {
    x: nx - palettePos.x,
    y: ny - palettePos.y,
  };
  return true;
}

/** Correct the palette alone, preserving the absolute positions of its widgets. */
function ensurePaletteOnScreen(): boolean {
  const rect = paletteAnchorEl.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return false;
  const next = clampCardCenter(palettePos, rect, currentViewportSize());
  const dx = next.x - palettePos.x;
  const dy = next.y - palettePos.y;
  if (dx === 0 && dy === 0) return false;
  palettePos.x = next.x;
  palettePos.y = next.y;
  for (const instance of instances) {
    instance.offset = { x: instance.offset.x - dx, y: instance.offset.y - dy };
  }
  return true;
}

/** Recover old layouts after mount, reveal, undo, or a change of work area. */
function recoverLayoutIntoViewport(): void {
  let changed = ensurePaletteOnScreen();
  for (const instance of instances) {
    const rect = document.querySelector<HTMLElement>(
      `[data-widget-instance="${CSS.escape(instance.instanceId)}"]`,
    )?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      changed = ensureInstanceOnScreen(instance, rect) || changed;
    }
  }
  if (changed) persist();
  scheduleRegionSync();
}

let layoutBoundsObserver: ResizeObserver | undefined;

/** Auto-height content and font loading can move a centered card's top edge too. */
function observeLayoutBounds(): void {
  layoutBoundsObserver?.disconnect();
  document.querySelectorAll(".palette-anchor, .widget-anchor").forEach((el) => {
    layoutBoundsObserver?.observe(el);
  });
}

/** Handle extension-driven reveal requests (e.g. alarm fired while hidden). */
function onRevealWidgetEvent(event: Event) {
  const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
  if (detail?.instanceId) onRevealWidget(detail.instanceId);
}

/** Let a first-party widget adjust its own card width without owning host layout. */
function onResizeWidgetEvent(event: Event) {
  const detail = (event as CustomEvent<{
    instanceId?: string;
    width?: number;
    anchor?: "left" | "right" | "center";
  }>).detail;
  if (!detail?.instanceId || typeof detail.width !== "number" || !Number.isFinite(detail.width)) {
    return;
  }
  const instance = instances.find((item) => item.instanceId === detail.instanceId);
  if (!instance) return;
  const currentWidth = instance.width ?? defFor(instance.typeId)?.defaultSize?.w;
  if (typeof currentWidth !== "number") return;
  const width = Math.max(DEFAULT_WIDGET_MIN_WIDTH, Math.round(detail.width));
  const delta = width - currentWidth;
  instance.width = width;
  // Card offsets describe their centre. Preserve the requested opposite edge.
  if (detail.anchor === "left") instance.offset.x += delta / 2;
  if (detail.anchor === "right") instance.offset.x -= delta / 2;
  persist();
  scheduleRegionSync();
}

/**
 * The Ctrl+Shift+Q popup is a separate webview, so Rust relays this declared
 * widget hand-off here after it has released the borrowed clipboard state.
 */
async function onQuickActionOpenWidget(payload: {
  extensionId: string;
  actionId: string;
  args: Record<string, string>;
  text: string;
}) {
  const extension = getExtension(payload.extensionId);
  if (!extension || !extension.actions.some((action) => action.id === payload.actionId)) return;

  const visible = instances.find(
    (instance) => instance.typeId === payload.extensionId && instance.hidden !== true,
  );
  const instanceId = visible?.instanceId ?? onAddType(payload.extensionId);
  if (!instanceId) return;

  const ran = await runExtensionAction(extension, payload.actionId, {
    instanceId,
    // `text` is the conventional optional input parameter for quick-action hand-offs.
    args: { ...payload.args, text: payload.text },
  });
  if (ran) await onFocusWidget(instanceId);
}

/** A first-party builder saved a runtime package and wants to open it now. */
async function onRunRuntimeWidget(event: Event) {
  const detail = (event as CustomEvent<{ typeId?: string; openPackageId?: string }>)
    .detail;
  const typeId = detail?.typeId;
  if (typeof typeId !== "string" || !typeId) return;
  await rescanRuntimeExtensions();
  /**
   * A card of this type that is already on screen is the answer.
   *
   * `onAddType` reveals a hidden one and otherwise creates, but has nothing to
   * say about a visible one — so asking for a widget that was already there
   * made a second card of it. That is wrong for both callers: the Wizard's
   * "Add to desk" after editing a widget means *that* widget, and the palette's
   * "New Widget" means the Wizard you already have open.
   */
  const visible = instances.find((row) => row.typeId === typeId && row.hidden !== true);
  const instanceId = visible?.instanceId ?? onAddType(typeId);
  if (instanceId) await onFocusWidget(instanceId, detail?.openPackageId);
}

/**
 * Reopen a Wizard-built package in the Wizard.
 *
 * Deliberately the same event the Wizard's own "New Widget" action uses, so the
 * host keeps one rule for which card answers — reveal a hidden one, focus a
 * visible one, or make one — instead of this path guessing at an instance and
 * guessing wrong whenever there are two Wizards.
 */
function onEditInWizard(packageId: string) {
  window.dispatchEvent(
    new CustomEvent("kavibay:run-runtime-widget", {
      detail: { typeId: WIDGET_WIZARD_ID, openPackageId: packageId },
    }),
  );
}

onMounted(async () => {
  layoutBoundsObserver = new ResizeObserver(recoverLayoutIntoViewport);
  observeLayoutBounds();
  // Pinch needs zoomHotkeysEnabled, which also turns on browser zoom — cancel it.
  startBrowserZoomGuard();
  void rescanRuntimeExtensions();
  // Bootstrap lifecycle for every catalog entry (alarms start ticking, etc.).
  for (const entry of layoutDoc.catalog) {
    runExtensionHook(getExtension(entry.typeId), "onCreate", entry.instanceId);
  }
  // Same moment, same reason: the catalog is loaded and complete here, which is
  // the only point where "this instance no longer exists" can be said safely.
  void pruneConnections(layoutDoc.catalog.map((entry) => entry.instanceId)).catch(
    console.error,
  );
  window.addEventListener("kavibay:reveal-widget", onRevealWidgetEvent);
  window.addEventListener("kavibay:resize-widget", onResizeWidgetEvent);
  window.addEventListener("kavibay:run-runtime-widget", onRunRuntimeWidget);
  window.addEventListener("keydown", onCtrlTapKey, true);
  window.addEventListener("keyup", onCtrlTapKey, true);
  window.addEventListener("keydown", onCtrlShortcutHintKeydown, true);
  window.addEventListener("keyup", onCtrlShortcutHintKeyup, true);
  window.addEventListener("blur", onCtrlShortcutHintBlur);
  window.addEventListener("keydown", onCycleWidgetFocusKeydown, true);
  window.addEventListener("keydown", onNudgeKeydown, true);
  window.addEventListener("keydown", onDeskSwitchKeydown, true);
  window.addEventListener("keydown", onLayoutHistoryKeydown, true);
  window.addEventListener("keydown", onWidgetCloseKeydown, true);
  window.addEventListener("keydown", onFocusSearchKeydown, true);
  window.addEventListener("keydown", onPinKeydown, true);
  window.addEventListener("keydown", onDuplicateKeydown, true);
  window.addEventListener("keydown", onMoveToPanelKeydown, true);
  window.addEventListener("keydown", onGapMoveKeydown, true);
  window.addEventListener("resize", onViewportResize);
  // Constant for the process lifetime — the display backend cannot change under it.
  domGapCatcher.value = await needsDomGapCatcher();
  // Focus search after open (also idempotent cockpit open).
  // Every emitter of `palette:show` — tray Open/Settings in Rust, the hotkey
  // handler, the last-card-closed nudge — has a visible, focused window by the
  // time it fires, so the host must not repeat show/focus over IPC here. The
  // hotkey path in particular emits this right after opening, which would
  // otherwise undo the saving in `onPaletteHotkey`.
  unlistenPaletteShow = await listen("palette:show", () => {
    void openCockpit(true);
  });
  unlistenPaletteHotkey = await listen<{ revealed?: boolean; trigger?: CockpitTrigger }>(
    "palette:hotkey",
    (event) => {
      lastRustHotkeyAt = Date.now();
      const revealed = event.payload?.revealed === true;
      onPaletteHotkey(revealed);
      // The tour's hotkey step is passed here and nowhere else: this is the only
      // path on which Rust reports *which* gesture brought a hidden window back.
      onboarding.notifyCockpitRevealed(event.payload?.trigger ?? "app", revealed);
    },
  );
  // Hold-to-peek fires twice per hold — once on the way down, once on the way up.
  unlistenCockpitPeek = await listen<{ active?: boolean; revealed?: boolean }>(
    "cockpit:peek",
    (event) => {
      onPeekHotkey(event.payload?.active === true, event.payload?.revealed === true);
    },
  );
  // Native gap click ("Hide on outside click"). The same click already went to the app
  // below — this only tears down the cockpit session.
  unlistenOutsideClick = await listen("cockpit:outside-click", () => {
    onDismissOutside();
  });
  unlistenQuickActionWidget = await listen<{
    extensionId: string;
    actionId: string;
    args: Record<string, string>;
    text: string;
  }>("quickaction:open-widget", (event) => {
    void onQuickActionOpenWidget(event.payload);
  });
  // A saved widget can change its package id — the manifest names the package,
  // and renaming it is an edit somebody makes in the wizard or through MCP.
  // Everything the desk keeps about that widget is keyed by the old id.
  unlistenDraftChanged = await listen<{
    id: string;
    kind: "written" | "discarded" | "promoted";
    renamedFrom?: string;
  }>("runtime-draft:changed", (event) => {
    const { id, kind, renamedFrom } = event.payload;
    if (kind !== "promoted" || !renamedFrom) return;
    onPackageRenamed(renamedFrom, id);
  });
  // Installer "Start Kavibay" / first ever launch: search + guided tour.
  // Later launches stay hidden until a Ctrl double tap or tray Open.
  const firstOpen = consumeFirstOpen();
  if (firstOpen) startSetupIfNeeded(true);
  // An unanswered setup card brings the window up, and it does so on *every*
  // start rather than only the first.
  //
  // `consumeFirstOpen` fires once and is spent, so a user who closed Kavibay
  // mid-card came back to a card that existed, rendered, and sat behind a
  // hidden window — waiting for the double tap that the card itself is there to
  // teach. The one screen nobody can be expected to get past on their own was
  // the one screen that required knowing how.
  //
  // The card comes *alone*, too: showing it over a search field and a desk of
  // cards put five overlapping panels in front of someone who had never seen
  // the app. So the window opens with no palette behind it, and the rest of the
  // first run is the reward for answering: desk, palette, tour, in that order.
  if (isSetupVisible(setupState.value)) {
    void openCockpit(false, false);
    const stopWatchingSetup = watch(setupState, (next) => {
      if (next?.status !== "done") return;
      stopWatchingSetup();
      void revealFirstRun({ afterSetup: true });
    });
  } else if (firstOpen) {
    void revealFirstRun();
  }
  warmDeskViewsWhenIdle();
});

/**
 * Fetch the chunks of the widgets on this desk while nothing else is happening.
 *
 * Widget views are lazy so they stay out of the start-up graph, but the desk's
 * widgets all mount together on the first open — without this, that open
 * pays for every one of their chunks at the worst possible moment. Idle time
 * right after boot is free: the window is hidden and the user is elsewhere.
 */
function warmDeskViewsWhenIdle() {
  const warm = () => {
    warmLazyViews(instances.map((instance) => defFor(instance.typeId)?.component));
  };
  // requestIdleCallback waits for a genuinely quiet moment; the timeout is both
  // its ceiling and the fallback for engines that lack it.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(warm, { timeout: 3000 });
  } else {
    setTimeout(warm, 1500);
  }
}

/** Debounced rescale when the Kavibay window changes size (monitor switch). */
let viewportResizeTimer: ReturnType<typeof setTimeout> | undefined;
function onViewportResize() {
  if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    ensureViewportAdaptation(true);
  }, 50);
}

onUnmounted(() => {
  layoutBoundsObserver?.disconnect();
  if (highlightClearTimer !== undefined) clearTimeout(highlightClearTimer);
  if (focusPopClearTimer !== undefined) clearTimeout(focusPopClearTimer);
  if (focusPopFrame !== undefined) cancelAnimationFrame(focusPopFrame);
  clearCtrlShortcutHint();
  if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
  window.removeEventListener("kavibay:reveal-widget", onRevealWidgetEvent);
  window.removeEventListener("kavibay:resize-widget", onResizeWidgetEvent);
  window.removeEventListener("kavibay:run-runtime-widget", onRunRuntimeWidget);
  window.removeEventListener("keydown", onCtrlTapKey, true);
  window.removeEventListener("keyup", onCtrlTapKey, true);
  window.removeEventListener("keydown", onCtrlShortcutHintKeydown, true);
  window.removeEventListener("keyup", onCtrlShortcutHintKeyup, true);
  window.removeEventListener("blur", onCtrlShortcutHintBlur);
  window.removeEventListener("keydown", onCycleWidgetFocusKeydown, true);
  window.removeEventListener("keydown", onNudgeKeydown, true);
  window.removeEventListener("keydown", onDeskSwitchKeydown, true);
  window.removeEventListener("keydown", onLayoutHistoryKeydown, true);
  window.removeEventListener("keydown", onWidgetCloseKeydown, true);
  window.removeEventListener("keydown", onFocusSearchKeydown, true);
  window.removeEventListener("keydown", onPinKeydown, true);
  window.removeEventListener("keydown", onDuplicateKeydown, true);
  window.removeEventListener("keydown", onMoveToPanelKeydown, true);
  window.removeEventListener("keydown", onGapMoveKeydown, true);
  window.removeEventListener("resize", onViewportResize);
  unlistenPaletteShow?.();
  unlistenPaletteHotkey?.();
  unlistenCockpitPeek?.();
  unlistenOutsideClick?.();
  unlistenQuickActionWidget?.();
  unlistenDraftChanged?.();
  setOutsideClickDismiss(false);
});

// Keep native click-through rects aligned when cockpit / palette visibility change.
watch([hideOnOutsideClick, paletteVisible, mountedInstances], async () => {
  await nextTick();
  observeLayoutBounds();
  recoverLayoutIntoViewport();
});

// Arm native outside-click detection exactly while the cockpit should dismiss on it.
watch(outsideClickArmed, (armed) => setOutsideClickDismiss(armed), { immediate: true });

/**
 * Snapshot layout-v4 to plain JSON before structural edits.
 * Avoids mutating shared reactive placement arrays through toRaw aliases.
 */
function cloneLayoutDoc(): SavedLayoutV4 {
  return JSON.parse(JSON.stringify(toRaw(layoutDoc))) as SavedLayoutV4;
}

/** Remove from active desk or everywhere; onDispose when catalog entry is dropped. */
function kavibayRemoveWidget(instanceId: string, mode: "desk" | "everywhere") {
  const catalogEntry = layoutDoc.catalog.find((row) => row.instanceId === instanceId);
  const typeId = catalogEntry?.typeId;
  flushToDoc();
  const closeUndo = snapshotRemoveUndo(instanceId, mode);
  if (closeUndo) pushCloseUndo(closeUndo);
  if (mode === "desk") {
    const instance = instances.find((row) => row.instanceId === instanceId);
    const wasMounted = instance != null && isMountedInstance(instance);
    const { layout, disposed } = removeFromDesk(
      cloneLayoutDoc(),
      instanceId,
      layoutDoc.activeDeskId,
    );
    applyLayoutDoc(layout);
    reloadInstances();
    if (focusedInstanceId.value === instanceId) focusedInstanceId.value = null;
    if (frontInstanceId.value === instanceId) frontInstanceId.value = null;
    releasePeekKept(instanceId);
    if (wasMounted && !disposed && catalogEntry) {
      runExtensionHook(getExtension(catalogEntry.typeId), "onSuspend", instanceId);
    }
    if (disposed && catalogEntry) {
      runExtensionHook(getExtension(catalogEntry.typeId), "onDispose", instanceId);
    }
  } else {
    applyLayoutDoc(removeEverywhere(cloneLayoutDoc(), instanceId));
    reloadInstances();
    if (focusedInstanceId.value === instanceId) focusedInstanceId.value = null;
    if (frontInstanceId.value === instanceId) frontInstanceId.value = null;
    releasePeekKept(instanceId);
    if (catalogEntry) {
      runExtensionHook(getExtension(catalogEntry.typeId), "onDispose", instanceId);
    }
  }
  // Clear soft-hidden-only leftovers of this type so Hidden does not keep ghosts.
  if (typeId) disposePurgedHidden(typeId);
  persist();
  scheduleRegionSync();
  focusPaletteIfNoCardsLeft();
  onboarding.notifyWidgetRemoved(typeId);
}

/**
 * Remove one instance from the card menu.
 * Multi-desk instances choose this desk only vs all desks in WidgetCard.
 */
function onRemove(instanceId: string, mode: "desk" | "everywhere") {
  kavibayRemoveWidget(instanceId, mode);
}

/** True when the catalog instance is placed on two or more desks. */
function isMultiDeskInstance(instanceId: string): boolean {
  return desksWithInstance(toRaw(layoutDoc), instanceId).length > 1;
}

/** Gesture-start offset so resize deltas (from drag start) apply absolutely. */
let resizeStartOffset: WidgetPosition | null = null;
let resizeStartInstanceId: string | null = null;
let paletteResizeStart: WidgetPosition | null = null;

/** Apply host edge-resize to one instance (size + center offset + optional scale). */
function onResizeInstance(
  instanceId: string,
  payload: {
    width: number;
    height: number;
    deltaOffset: { x: number; y: number };
    contentScale?: number;
    edge?: string;
  },
) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (resizeStartInstanceId !== instanceId || !resizeStartOffset) {
    beginLayoutGesture();
    resizeStartOffset = { ...instance.offset };
    resizeStartInstanceId = instanceId;
  }

  let nextWidth = payload.width;
  let nextHeight = payload.height;
  let nextOffset = {
    x: resizeStartOffset.x + payload.deltaOffset.x,
    y: resizeStartOffset.y + payload.deltaOffset.y,
  };
  const def = defFor(instance.typeId);

  // Grid mode: snap only edges the gesture moves (keeps opposite edge fixed).
  if (widgetLayoutMode.value === "grid" && payload.edge) {
    const center = {
      x: palettePos.x + nextOffset.x,
      y: palettePos.y + nextOffset.y,
    };
    if (def?.hugHeight) {
      // Width + horizontal edges only; keep freehand vertical offset.
      const snapped = snapResizeGeometry(
        payload.edge.replace(/[ns]/g, "") || "e",
        center,
        { width: nextWidth, height: nextHeight },
        { minWidth: DEFAULT_WIDGET_MIN_WIDTH, minHeight: 0 },
      );
      nextWidth = snapped.width;
      nextOffset = {
        x: snapped.center.x - palettePos.x,
        y: nextOffset.y,
      };
    } else {
      const snapped = snapResizeGeometry(
        payload.edge,
        center,
        { width: nextWidth, height: nextHeight },
        {
          minWidth: DEFAULT_WIDGET_MIN_WIDTH,
          minHeight: DEFAULT_WIDGET_MIN_HEIGHT,
        },
      );
      nextWidth = snapped.width;
      nextHeight = snapped.height;
      nextOffset = {
        x: snapped.center.x - palettePos.x,
        y: snapped.center.y - palettePos.y,
      };
    }
  }

  instance.width = nextWidth;
  if (def?.hugHeight) {
    // Dock widgets: width only — drop any stale tall height from older layouts.
    delete instance.height;
  } else {
    instance.height = nextHeight;
  }
  if (typeof payload.contentScale === "number") {
    instance.contentScale = payload.contentScale;
  }
  instance.offset = nextOffset;
  ensureInstanceOnScreen(instance);
  persist();
}

/** After a widget resize gesture, refresh click-through regions. */
function onResizeInstanceEnd() {
  const resizedId = resizeStartInstanceId;
  resizeStartOffset = null;
  resizeStartInstanceId = null;
  endLayoutGesture();
  void nextTick(recoverLayoutIntoViewport);
  scheduleRegionSync();
  if (resizedId) {
    const resized = instances.find((item) => item.instanceId === resizedId);
    if (resized) onboarding.notifyWidgetResized(resized.typeId);
    // Remember at gesture end, not per frame — the size someone settled on.
    if (resized && typeof resized.width === "number") {
      rememberTypeSize(resized.typeId, {
        w: resized.width,
        ...(typeof resized.height === "number" ? { h: resized.height } : {}),
      });
    }
  }
}

/** Persist Ctrl+wheel / Ctrl+resize content zoom for one instance. */
function onContentScale(instanceId: string, scale: number) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  const next = clampContentScale(scale);
  if (next === DEFAULT_CONTENT_SCALE) {
    delete instance.contentScale;
  } else {
    instance.contentScale = next;
  }
  persist();
}

/** Apply palette width + list-height resize from the command palette. */
function onResizePalette(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
  edge?: string;
}) {
  if (!paletteResizeStart) {
    beginLayoutGesture();
    paletteResizeStart = { x: palettePos.x, y: palettePos.y };
  }

  let nextWidth = payload.width;
  let nextHeight = payload.height;
  let nextPos = {
    x: paletteResizeStart.x + payload.deltaOffset.x,
    y: paletteResizeStart.y + payload.deltaOffset.y,
  };

  if (widgetLayoutMode.value === "grid" && payload.edge) {
    const snapped = snapResizeGeometry(
      payload.edge,
      nextPos,
      { width: nextWidth, height: nextHeight },
      { minWidth: PALETTE_MIN_WIDTH, minHeight: PALETTE_MIN_LIST_HEIGHT },
    );
    nextWidth = snapped.width;
    nextHeight = snapped.height;
    nextPos = snapped.center;
  }

  // Center-anchored resize moves palettePos; keep widgets fixed on screen
  // (same compensation as plain palette drag).
  const dx = nextPos.x - palettePos.x;
  const dy = nextPos.y - palettePos.y;
  paletteWidth.value = nextWidth;
  paletteListHeight.value = nextHeight;
  palettePos.x = nextPos.x;
  palettePos.y = nextPos.y;
  if (dx !== 0 || dy !== 0) {
    for (const item of instances) {
      item.offset = {
        x: item.offset.x - dx,
        y: item.offset.y - dy,
      };
    }
  }
  persist();
  scheduleRegionSync();
}

/** Clear palette resize gesture baseline. */
function onResizePaletteEnd() {
  paletteResizeStart = null;
  endLayoutGesture();
  void nextTick(recoverLayoutIntoViewport);
  scheduleRegionSync();
}

/** Palette footprint in screen space (center = palettePos). */
function paletteSpawnObstacle(): SpawnRect {
  const el = paletteAnchorEl.value;
  if (el) {
    const r = el.getBoundingClientRect();
    return {
      x: palettePos.x,
      y: palettePos.y,
      w: Math.max(1, r.width),
      h: Math.max(1, r.height),
    };
  }
  return {
    x: palettePos.x,
    y: palettePos.y,
    w: paletteWidth.value ?? DEFAULT_PALETTE_WIDTH,
    // Closed search chrome is short; prefer real measure when mounted.
    h: 100,
  };
}

/** Mounted widgets as spawn obstacles in screen space. */
function widgetSpawnObstacles(): SpawnRect[] {
  return visibleMountedInstances.value.map((instance) => {
    const def = defFor(instance.typeId);
    const w =
      typeof instance.width === "number" && Number.isFinite(instance.width)
        ? instance.width
        : (def?.defaultSize?.w ?? 280);
    const h =
      typeof instance.height === "number" && Number.isFinite(instance.height)
        ? instance.height
        : (def?.defaultSize?.h ?? 180);
    return {
      x: palettePos.x + instance.offset.x,
      y: palettePos.y + instance.offset.y,
      w,
      h,
    };
  });
}

/** Snap spawn size to the 15px grid so edges share the same rhythm. */
function gridSnapSpawnSize(size: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.max(GRID_GAP, snapValue(size.w)),
    h: Math.max(GRID_GAP, snapValue(size.h)),
  };
}

/**
 * Near-palette preferred offset, clear of palette + widgets, snapped to the
 * same inset grid used while dragging (so gaps stay a multiple of 15px).
 */
function clearSpawnOffsetFor(
  preferred: WidgetPosition,
  size: { w: number; h: number },
): WidgetPosition {
  const margin = viewportEdgeMargin({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  // Obstacles in palette-offset space (palette centered at 0,0 for ray push-out).
  const paletteObs = paletteSpawnObstacle();
  const obstacles: SpawnRect[] = [
    { x: 0, y: 0, w: paletteObs.w, h: paletteObs.h },
    ...widgetSpawnObstacles().map((obs) => ({
      x: obs.x - palettePos.x,
      y: obs.y - palettePos.y,
      w: obs.w,
      h: obs.h,
    })),
  ];

  return findClearSpawnOffset({
    preferred,
    size,
    obstacles,
    quantize: (center, sz) => {
      // Snap in screen space (inset grid), then convert back to palette offset.
      const screen = {
        x: palettePos.x + center.x,
        y: palettePos.y + center.y,
      };
      const snapped = snapPositionInInset(
        screen,
        { width: sz.w, height: sz.h },
        {
          left: margin,
          top: margin,
          right: window.innerWidth - margin,
          bottom: window.innerHeight - margin,
        },
      );
      return {
        x: snapped.x - palettePos.x,
        y: snapped.y - palettePos.y,
      };
    },
  });
}

/**
 * Add a fresh instance on the active desk; returns instanceId for settings seeding.
 * Optional `screen` places the card center at that viewport point (no jitter).
 * By default, shows a soft-hidden instance of the same type instead of
 * stacking a second card that leaves the hidden one stuck under Hidden.
 */
function onAddType(
  typeId: string,
  opts?: {
    screen?: { x: number; y: number };
    forceNew?: boolean;
    /**
     * What asked for this card. The gallery is the only caller that says, and
     * it says because it covers the band above the palette — a card opening
     * there would land behind the panel that spawned it.
     */
    origin?: "gallery";
  },
): string | undefined {
  if (!isEnabled(typeId)) return undefined;
  if (!opts?.forceNew) {
    const hidden = instances.find(
      (row) => row.typeId === typeId && row.hidden === true,
    );
    if (hidden) {
      void onFocusWidget(hidden.instanceId);
      return hidden.instanceId;
    }
  }
  const def = defFor(typeId);
  if (!def) return undefined;
  // Whatever the last card of this type was resized to beats the manifest.
  const size = initialSizeForExtension(def, rememberedSizeFor(typeId));
  const preferredSize = {
    w: size.width ?? def.defaultSize?.w ?? 280,
    h: size.height ?? def.defaultSize?.h ?? 180,
  };
  const atScreen = opts?.screen;
  // The tour's gallery step is the one spawn that is composed rather than
  // fitted: palette-width, directly above it, so the two read as one surface.
  // Null means it would not fit and this falls through to the ordinary path.
  const tourPlaced = atScreen ? null : galleryTourSpawn(typeId, preferredSize.h);
  const spawnSize = tourPlaced?.size ?? gridSnapSpawnSize(preferredSize);
  // A pick from the gallery starts on the free side of the palette instead of
  // at its own manifest offset, then goes through the same de-overlap as
  // everything else — so the second and third pick stack outward from there.
  const pickOffset =
    !atScreen && opts?.origin === "gallery"
      ? galleryPickOffset({
          paletteWidth: paletteSpawnObstacle().w,
          widgetWidth: spawnSize.w,
          gap: SPAWN_GAP,
        })
      : null;
  // Manifest offsets fan out; pull nearer, clear overlaps, snap to 15px grid.
  const preferred =
    pickOffset ??
    (atScreen
      ? { x: atScreen.x - palettePos.x, y: atScreen.y - palettePos.y }
      : spawnOffsetNearPalette(def.position));
  const baseOffset =
    tourPlaced?.offset ??
    (atScreen ? preferred : clearSpawnOffsetFor(preferred, spawnSize));
  const created = createInstance(typeId, baseOffset, {
    hideTitle: Boolean(def.defaultHideTitle),
    width: spawnSize.w,
    // Dock / hugHeight: host owns width only.
    ...(def.hugHeight ? {} : { height: spawnSize.h }),
    // Manifest `ui.defaultScale` — the zoom Ctrl+wheel would otherwise set by hand.
    ...(typeof def.defaultScale === "number" ? { contentScale: def.defaultScale } : {}),
    jitter: false,
  });
  flushToDoc();
  applyLayoutDoc(
    addCatalogInstance(
      toRaw(layoutDoc),
      instanceToCatalogEntry(created),
      instanceToPlacement(created),
    ),
  );
  reloadInstances();
  const live = instances.find((row) => row.instanceId === created.instanceId);
  if (live) ensureInstanceOnScreen(live);
  runExtensionHook(getExtension(typeId), "onCreate", created.instanceId);
  persist();
  onboarding.notifyWidgetAdded(typeId);
  scheduleRegionSync();
  return created.instanceId;
}

/**
 * The gallery's composed placement, but only while the tour is teaching it.
 *
 * Guarded on the active step rather than on "is this the gallery", because
 * every other way of opening it — the palette command, the Widgets button, a
 * later visit during the extras — is somebody reaching for a tool on a desk
 * they have arranged, and moving their card would be rude. During the lesson
 * there is no arranged desk to disturb.
 */
function galleryTourSpawn(
  typeId: string,
  preferredHeight: number,
): GalleryTourPlacement | null {
  if (!isGalleryWidget(typeId)) return null;
  if (onboarding.activeStep.value !== ONBOARDING_GALLERY_STEP) return null;
  const palette = paletteSpawnObstacle();
  return galleryTourPlacement({
    paletteWidth: palette.w,
    paletteHeight: palette.h,
    paletteCentreY: palettePos.y,
    preferredHeight,
    viewportHeight: window.innerHeight,
    margin: viewportEdgeMargin({ width: window.innerWidth, height: window.innerHeight }),
    gap: SPAWN_GAP,
  });
}

/**
 * Everything the first run shows once the setup card has been answered.
 *
 * Order matters and is not arbitrary: the palette has to be placed before the
 * widgets, because spawn offsets are measured from it, and the tour has to
 * start after them, or its "add a widget" step would count the starters as the
 * user's own doing. (`startIfNeeded` is idempotent, so the card no longer
 * calls it — one owner for the sequence beats two that have to agree.)
 */
async function revealFirstRun(opts: { afterSetup?: boolean } = {}) {
  onPaletteHotkey(true);
  await waitForPaletteBox();
  placeStarterDesk();
  // Guided tour replaces the former auto-spawned Gallery. Coming out of the
  // setup card it starts past the welcome step, which that card delivered —
  // and both calls no-op if the card already declined the tour.
  if (opts.afterSetup) {
    onboarding.startAfterSetup();
    return;
  }
  onboarding.startIfNeeded(true);
}

/**
 * Wait until the palette has a box worth measuring.
 *
 * Starters are placed *around* the palette, and `onPaletteHotkey` only flips it
 * from `display: none` to visible — Vue paints it a frame or two later. Measure
 * before that and `paletteSpawnObstacle()` reports 1x1, which blocks nothing
 * and drops the first card straight across the search field. That was visible
 * on the very first screen a new user sees, and invisible to every test that
 * checked only *which* widgets were placed.
 *
 * Capped rather than open-ended: a few frames is generous, and a placement
 * slightly off beats a first run that never finishes revealing itself.
 */
async function waitForPaletteBox(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await nextTick();
    if ((paletteAnchorEl.value?.getBoundingClientRect().height ?? 0) > 1) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/**
 * Put the manifest-declared starter widgets on a brand-new desk.
 *
 * Which widgets those are is not a decision this file gets to make — see
 * `starterDesk.ts` for why the manifests own it. All the host does is ask the
 * registry, respect the user's own enable prefs, and add the cards.
 */
function placeStarterDesk() {
  const ids = starterDeskIds(
    extensionRegistry.map((extension) => ({
      id: extension.id,
      starter: extension.starter,
      enabled: isEnabled(extension.id),
      isWidget: extension.isWidget,
    })),
  );
  for (const typeId of ids) {
    onAddType(typeId);
  }
}

/** Switch active desk: flush current state, rebind palette, clear stale focus. */
function kavibaySwitchDesk(deskId: string) {
  if (deskId === layoutDoc.activeDeskId) return;

  const prevMountedIds = mountedIdsForInstances(instances);
  const nextMountedIds = mountedIdsForInstances(
    instancesForDesk(toRaw(layoutDoc), deskId),
  );

  suspendLeavingMountedSet(prevMountedIds, nextMountedIds);

  flushToDoc();
  applyLayoutDoc(setActiveDesk(toRaw(layoutDoc), deskId));
  syncActiveDeskToLive(false);
  clearFocusIfNotOnActiveDesk();

  resumeEnteringMountedSet(prevMountedIds, nextMountedIds);

  persist();
  scheduleRegionSync();
}

/** Append a new empty desk with the next default label ("Desk n"). */
function kavibayAddDesk() {
  flushToDoc();
  const { layout } = addDesk(toRaw(layoutDoc));
  applyLayoutDoc(layout);
  persist();
}

/**
 * Carry a widget's cards and its stored data to the id its package now has.
 *
 * A package's folder name is its identity: the desk stores it as a card's
 * `typeId`, and both storage backends key their cells on it. Moving the folder
 * alone would take the widget off every desk it is on — the load path drops
 * catalog entries whose typeId resolves to nothing — while its position, its
 * title and its data all sat on disk under the name nothing points at any more.
 *
 * Both stores are asked, because a package is one of two formats and neither
 * call touches an id it does not hold. Instance data keyed by instance id is
 * already safe: an instance keeps its id through a rename.
 */
function onPackageRenamed(from: string, to: string): void {
  renameRuntimeStorageExt(from, to);
  extensionHost.data.renameSharedScope(`local.${from}`, `local.${to}`);
  const next = renameWidgetType(toRaw(layoutDoc), from, to);
  if (next !== toRaw(layoutDoc)) {
    applyLayoutDoc(next);
    reloadInstances();
    persist();
  }
  void rescanRuntimeExtensions();
}

/** Rename a desk display label (id unchanged). */
function kavibayRenameDesk(deskId: string, name: string) {
  applyLayoutDoc(renameDesk(toRaw(layoutDoc), deskId, name));
  persist();
}

/** Delete a desk; dispose catalog entries exclusive to it via onDispose. */
function kavibayDeleteDesk(deskId: string) {
  const deletingActive = deskId === layoutDoc.activeDeskId;
  let prevMountedIds: Set<string> | undefined;
  let nextMountedIds: Set<string> | undefined;

  if (deletingActive) {
    const raw = toRaw(layoutDoc);
    const remainingDesks = raw.desks.filter((d) => d.id !== deskId);
    const nextActiveId = remainingDesks[0]!.id;
    const target = raw.desks.find((d) => d.id === deskId);
    const skipSuspendIds = new Set<string>();
    for (const instanceId of target?.placements.map((p) => p.instanceId) ?? []) {
      const stillPlaced = remainingDesks.some((d) =>
        d.placements.some((p) => p.instanceId === instanceId),
      );
      if (!stillPlaced) skipSuspendIds.add(instanceId);
    }

    prevMountedIds = mountedIdsForInstances(instances);
    nextMountedIds = mountedIdsForInstances(
      instancesForDesk({ ...raw, activeDeskId: nextActiveId }, nextActiveId),
    );
    suspendLeavingMountedSet(prevMountedIds, nextMountedIds, skipSuspendIds);
  }

  flushToDoc();
  const catalogById = new Map(
    layoutDoc.catalog.map((entry) => [entry.instanceId, entry]),
  );
  const { layout, disposedInstanceIds } = deleteDesk(toRaw(layoutDoc), deskId);
  applyLayoutDoc(layout);
  syncActiveDeskToLive(false);
  clearFocusIfNotOnActiveDesk();

  if (deletingActive && prevMountedIds && nextMountedIds) {
    resumeEnteringMountedSet(prevMountedIds, nextMountedIds);
  }

  for (const instanceId of disposedInstanceIds) {
    const entry = catalogById.get(instanceId);
    if (entry) {
      runExtensionHook(getExtension(entry.typeId), "onDispose", instanceId);
    }
  }
  persist();
  scheduleRegionSync();
}

/** Place an existing catalog instance on the active desk (also-on). */
function kavibayPlaceOnActiveDesk(instanceId: string) {
  const catalogEntry = layoutDoc.catalog.find((row) => row.instanceId === instanceId);
  if (!catalogEntry) return;
  const def = defFor(catalogEntry.typeId);
  const preferred = spawnOffsetNearPalette(def?.position ?? { x: 0, y: 0 });
  const spawnSize = gridSnapSpawnSize({
    w: def?.defaultSize?.w ?? 280,
    h: def?.defaultSize?.h ?? 180,
  });
  const baseOffset = clearSpawnOffsetFor(preferred, spawnSize);
  const created = createInstance(catalogEntry.typeId, baseOffset, {
    width: spawnSize.w,
    ...(def?.hugHeight ? {} : { height: spawnSize.h }),
    jitter: false,
  });
  flushToDoc();
  const next = placeOnDesk(
    toRaw(layoutDoc),
    instanceId,
    layoutDoc.activeDeskId,
    created.offset,
  );
  if (!next) return;
  applyLayoutDoc(next);
  reloadInstances();
  const placed = instances.find((row) => row.instanceId === instanceId);
  if (placed && isMountedInstance(placed)) {
    ensureInstanceOnScreen(placed);
    runExtensionHook(getExtension(catalogEntry.typeId), "onResume", instanceId);
  }
  persist();
  scheduleRegionSync();
}

/** Catalog entries not yet placed on the active desk. */
function kavibayCatalogNotOnActiveDesk(): WidgetCatalogEntry[] {
  return catalogNotOnDesk(toRaw(layoutDoc), layoutDoc.activeDeskId);
}

/** Comma-joined desk names where the catalog instance is placed. */
function kavibayInstanceDeskLabels(instanceId: string): string {
  const raw = toRaw(layoutDoc);
  const deskName = (id: string) =>
    raw.desks.find((d) => d.id === id)?.name ?? id;
  return desksWithInstance(raw, instanceId).map(deskName).join(", ");
}

/** Also-on rows with desk labels so duplicate titles stay distinguishable. */
function kavibayAlsoOnDeskRows(): {
  instanceId: string;
  typeId: string;
  title: string;
  onDesks: string;
}[] {
  const raw = toRaw(layoutDoc);
  const entries = catalogNotOnDesk(raw, raw.activeDeskId);
  const deskName = (id: string) =>
    raw.desks.find((d) => d.id === id)?.name ?? id;

  const rows = entries.map((entry) => {
    const def = getExtension(entry.typeId);
    const title = entry.title ?? def?.title ?? entry.typeId;
    const onDesks = desksWithInstance(raw, entry.instanceId)
      .map(deskName)
      .join(", ");
    return { instanceId: entry.instanceId, typeId: entry.typeId, title, onDesks };
  });

  // Same title on the same desks → Clock (1), Clock (2), …
  const keyCounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.title}\0${row.onDesks}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labeled = rows.map((row) => {
    const key = `${row.title}\0${row.onDesks}`;
    if ((keyCounts.get(key) ?? 0) <= 1) return row;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...row, title: `${row.title} (${n})` };
  });

  return labeled.sort((a, b) => a.title.localeCompare(b.title));
}

// Command palette status bar uses this to create widgets.
provide("kavibayAddWidget", onAddType);
provide("kavibayToggleWidget", onToggleWidget);
provide("kavibayRevealWidget", onRevealWidget);
provide("kavibayHighlightWidget", onHighlightWidget);
provide("kavibayPreviewWidget", onPreviewWidget);
provide("kavibayFocusWidget", onFocusWidget);
provide("kavibayClearWidgetFocus", onClearWidgetFocus);
provide("kavibayCloseCockpit", closeCockpit);
provide("kavibayHidePalette", onHidePalette);
provide("kavibayWidgetInstances", instances);
provide("kavibayDesks", kavibayDesks);
provide("kavibayActiveDeskId", kavibayActiveDeskId);
provide("kavibaySwitchDesk", kavibaySwitchDesk);
provide("kavibayAddDesk", kavibayAddDesk);
provide("kavibayRenameDesk", kavibayRenameDesk);
provide("kavibayDeleteDesk", kavibayDeleteDesk);
provide("kavibayCenterPalette", centerPalette);
provide("kavibayPlaceOnActiveDesk", kavibayPlaceOnActiveDesk);
provide("kavibayCatalogNotOnActiveDesk", kavibayCatalogNotOnActiveDesk);
provide("kavibayAlsoOnDeskRows", kavibayAlsoOnDeskRows);
provide("kavibayInstanceDeskLabels", kavibayInstanceDeskLabels);
provide("kavibayRemoveWidget", kavibayRemoveWidget);
// The palette's inline header renames the same way a card's title does.
provide("kavibayRenameWidget", onRename);
provide("kavibayPalettePinned", palettePinned);
provide("kavibayTogglePalettePinned", onTogglePalettePinned);
provide("kavibayPaletteWidth", paletteWidth);
provide("kavibayPaletteListHeight", paletteListHeight);
provide(SHORTCUT_HINT_TARGET_KEY, readonly(shortcutHintTarget));
provide("kavibayResizePalette", onResizePalette);
provide("kavibayResizePaletteEnd", onResizePaletteEnd);
provide("kavibayPaletteMovePointerdown", (event: PointerEvent) => {
  onPointerDown(event, { kind: "palette" });
});
</script>

<template>
  <div class="widget-host">
    <!-- Visual underlay for gaps — only while the cockpit session is open
         (pinned-only desktop stays fully transparent). -->
    <div
      v-if="cockpitOpen"
      class="desktop-fill"
      aria-hidden="true"
    />
    <!-- Stand-in for the native gap click where Rust cannot report it. No
         `data-interactive`: click-through is off wherever this renders, so there
         is no rect for Rust to honour and nothing to keep transparent. -->
    <div
      v-if="gapCatcherVisible"
      class="dismiss-catcher"
      aria-hidden="true"
      @pointerdown="onDismissOutside"
    />
    <!-- Palette-Anker (Mitte). Top drag strip + pin live inside CommandPalette. -->
    <div
      v-show="paletteVisible"
      ref="paletteAnchorEl"
      class="palette-anchor"
      :class="{ 'palette-anchor--front': paletteFront }"
      :style="paletteStyle()"
      @pointerdown.capture="raisePalette"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @lostpointercapture="onPointerUp"
    >
      <slot name="center" />
    </div>

    <!-- Widgets are positioned relative to the palette and can be moved individually. -->
    <div
      v-for="instance in mountedInstances"
      :key="instance.instanceId"
      class="widget-anchor"
      :data-widget-instance="instance.instanceId"
      :class="{
        'widget-anchor--focused': focusedInstanceId === instance.instanceId,
        'widget-anchor--front': frontInstanceId === instance.instanceId,
      }"
      :style="widgetStyle(instance)"
      v-show="cockpitOpen || survivesDismiss(instance, peekKept)"
      @pointerdown.capture="raiseWidget(instance.instanceId)"
      @focusin="onCardFocusIn(instance.instanceId)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @lostpointercapture="onPointerUp"
    >
      <div
        class="widget-anchor-scale"
        :class="{
          'widget-anchor-scale--preview':
            previewInstanceId === instance.instanceId || focusPopInstanceId === instance.instanceId,
        }"
      >
        <WidgetInstanceView
          v-if="defFor(instance.typeId)"
          :instance="instance"
          :def="defFor(instance.typeId)!"
          :highlighted="highlightedInstanceId === instance.instanceId"
          :previewed="previewInstanceId === instance.instanceId"
          :multi-desk-remove="isMultiDeskInstance(instance.instanceId)"
          @rename="onRename(instance.instanceId, $event)"
          @update:hide-title="onHideTitle(instance.instanceId, $event)"
          @update:appearance="onAppearance(instance.instanceId, $event)"
          @duplicate="onDuplicate(instance.instanceId)"
          @about="onAbout(instance)"
          @edit-in-wizard="onEditInWizard($event)"
          @toggle-pin="onTogglePin(instance.instanceId)"
          @move-pointerdown="onWidgetMovePointerDown($event, instance.instanceId)"
          @hide="onHide(instance.instanceId)"
          @move-to-panel="onMoveToPanel(instance.instanceId)"
          @remove="onRemove(instance.instanceId, $event)"
          @resize="onResizeInstance(instance.instanceId, $event)"
          @resize-end="onResizeInstanceEnd"
          @update:content-scale="onContentScale(instance.instanceId, $event)"
        />
      </div>
    </div>

    <!-- Untransformed root slot: lets Settings sit in the provide tree (inject
         kavibayAddWidget/kavibayWidgetInstances) while keeping position:fixed
         correct, since palette-anchor/widget-anchor use their own transforms. -->
    <slot name="overlay" />
    <DemoHotkeyOverlay />
  </div>
</template>

<style scoped>
/* Does not catch pointer events itself — only cards, the palette, and the handle do. This
   keeps clicks in WebView gaps from being intercepted (Rust passes them through to the OS). */
.widget-host {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

/* Fullscreen tint behind widgets; never steals clicks (OS click-through stays). */
.desktop-fill {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--desktop-fill-bg, transparent);
}

.dismiss-catcher {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: auto;
}

.palette-anchor {
  position: absolute;
  top: 0;
  left: 0;
  width: min(640px, 90vw);
  /* Above idle widgets; cards raised by click/focus stack above this (300+). */
  z-index: 200;
  pointer-events: auto;
}

/*
 * Palette is the active surface (opened, clicked, or Shift+Tab back into
 * search): it wins over every raised card. Selection preview no longer
 * restacks a card above it — the ring lives on the widget in place.
 */
.palette-anchor--front {
  z-index: 330;
}

.widget-anchor {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  pointer-events: auto;
  cursor: default;
  touch-action: none;
  user-select: none;
}

/* Inner wrapper keeps position transform free for palette-relative layout. */
.widget-anchor-scale {
  transform: scale(1);
  transform-origin: center center;
  transition: transform 0.15s ease;
}

.widget-anchor-scale--preview {
  transform: scale(1.02);
}

/* Click-raised card — above idle widgets and the command palette. */
.widget-anchor--front {
  z-index: 300;
}

/* Open ⋯ / settings on a card stays above a mere click-raise. */
.widget-anchor:has(.widget-card--menu-open) {
  z-index: 310;
}

/*
 * Keyboard focus (Tab / Enter from search) must win over every other card,
 * including a previously click-raised sibling at 300. The palette gives way
 * here — focus lives in the card, so paletteFront is false.
 */
.widget-anchor--focused,
/* Named again with the menu, because `:has()` carries the specificity of its
   argument and would otherwise drop the focused card back to 310 the moment it
   opened its own ⋯ menu. */
.widget-anchor--focused:has(.widget-card--menu-open) {
  z-index: 320;
}

.widget-anchor:active {
  cursor: default;
}
</style>
