<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  type Component,
  type ComputedRef,
  type Ref,
  watch,
} from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "./commands";
import KbdHint from "./KbdHint.vue";
import PaletteSearchActions from "./PaletteSearchActions.vue";
import PaletteWidgetShortcuts from "./PaletteWidgetShortcuts.vue";
import PaletteAnswerPanel from "./PaletteAnswerPanel.vue";
import { usePaletteAnswer } from "./usePaletteAnswer";
import { getQuickActionModelDefinition } from "../settings/ai/aiApi";
import { useSearchPrefs } from "../settings/useSearchPrefs";
import { usePaletteWidgetPrefs } from "../settings/usePaletteWidgetPrefs";
import { buildWebSearchUrl, type SearchActionId, type WebSearchActionId } from "./searchActions";
import { connectionEpoch, HOST_OWNER } from "../settings/credentials/connections";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import {
  alignArgValues,
  nextParamIndex,
  paramPlaceholder,
  previousParamIndex,
  validateActionArgs,
} from "./commandArgs";
import {
  attachNoteSnippets,
  buildAppRows,
  buildExtensionActionRows,
  buildFolderRows,
  buildOpenNewRows,
  buildTypeRows,
  buildOffDeskWidgetRows,
  buildWidgetOverviewRows,
  buildInstanceSearchIndex,
  groupInstancesWithCreateRow,
  mergePaletteCatalog,
  filterPaletteRows,
  paletteRowAction,
  resolveActionTarget,
  resolveTypeSmart,
  toCommandRow,
  typeMatchesWidgetFilter,
  type PaletteRowAction,
  type PalettePathRow,
  type PaletteRow,
  type PaletteTypeRow,
  type PaletteWidgetRow,
} from "./paletteResults";
import {
  ensureAppIcons,
  ensureInstalledAppsIndex,
  installedAppIcons,
  installedAppsIndex,
  prewarmAppIcons,
} from "./installedAppsIndex";
import {
  builtinFoldersIndex,
  ensureKnownFoldersIndex,
  knownFoldersIndex,
} from "./knownFolders";
import { looksLikePathQuery, parsePathQuery } from "./pathQuery";
import {
  currentFolder,
  enterFolder,
  folderTitle,
  isBrowsableRow,
  leaveFolder,
  scopePlaceholder,
  type FolderScopeEntry,
} from "./folderScope";
import {
  completePath,
  fileEntriesToRows,
  listFolder,
  revealInFileManager,
  searchFolder,
} from "./fileSearch";
import {
  ensureFileTypeIcons,
  fileTypeIconKey,
  fileTypeIcons,
} from "./fileTypeIcons";
import {
  formatModified,
  loadFileSortMode,
  nextSortMode,
  saveFileSortMode,
  sortFileRows,
  sortModeLabel,
} from "./fileSort";
import { homeDir } from "@tauri-apps/api/path";
import {
  loadAppLaunchHistory,
  queryFrecencyBoost,
  recordAppLaunch,
  saveAppLaunchHistory,
  usageBoostForApp,
  type AppLaunchHistoryState,
} from "./appLaunchHistory";
import {
  hideApp,
  isAppHidden,
  loadHiddenApps,
  saveHiddenApps,
  unhideApp,
} from "./hiddenApps";
import {
  loadRecentPaletteRuns,
  recentAppsFromLaunchHistory,
  recordRecentPaletteRun,
  saveRecentPaletteRuns,
  type RecentPaletteRun,
} from "./recentPaletteRuns";
import {
  buildGoogleSearchUrl,
  parsePrefixSearch,
  resolveStaticSearchTerm,
  type PrefixSearchMatch,
} from "./prefixSearch";
import {
  inlineScratchInstanceId,
  isInlineScratchInstanceId,
  resolveInlineWidgetTarget,
  type InlineWidgetTarget,
} from "./inlineWidgetTarget";
import {
  loadInlineZoom,
  saveInlineZoom,
  withInlineZoom,
  type InlineZoomMap,
} from "./inlineWidgetZoom";
import { inlineWidgetRequest, paletteDropActive } from "./inlineWidgetRequest";
import { pickAndImport } from "../runtime/widgetImport";
import {
  getExtension,
  runDuplicateHook,
  runExtensionAction,
  runExtensionHook,
} from "../extensions/registry";
import {
  resolveExtension,
  useRuntimeExtensions,
} from "../runtime/useRuntimeExtensions";
import type { WidgetInstance } from "../host/types";
import { GALLERY_WIDGET_ID, WIDGET_WIZARD_ID } from "../host/builtinWidgetIds";
import type {
  ActionArgs,
  ActionParam,
  ExtensionInlineView,
  ExtensionInstanceAction,
} from "@sdk/types";
import { scheduleRegionSync, setClickThroughPaused } from "../system/clickThrough";
import { isCardHeaderHit, useCardChromePosition } from "../host/useCardChromePosition";
import { evaluate, formatResult } from "../../../extensions/calculator/widgets/calculator";
import { useAppearance } from "../settings/useAppearance";
import { useExtensionsPrefs } from "../settings/useExtensionsPrefs";
import { useSettingsModal } from "../settings/useSettingsModal";
import { SquareArrowOutUpRightIcon } from "@sdk/icons";
import InlineWidgetBody from "../host/InlineWidgetBody.vue";
import PinIcon from "../host/PinIcon.vue";
import {
  SHORTCUT_HINT_TARGET_KEY,
  shortcutModifierLabel,
} from "../host/shortcutHints";
import ResizeEdges from "../host/ResizeEdges.vue";
import {
  loadTypeSizes,
  rememberTypeSize,
  type RememberedSize,
} from "../host/typeSizeMemory";
import {
  DEFAULT_CONTENT_SCALE,
  DEFAULT_PALETTE_CLAMPS,
  DEFAULT_PALETTE_LIST_HEIGHT,
  DEFAULT_PALETTE_WIDTH,
  RESIZE_EDGES_NO_TOP,
} from "../host/resizeLogic";
import { useOnboarding } from "../onboarding/useOnboarding";

const { allExtensions, enabledExtensions, isEnabled } = useExtensionsPrefs();
const { enabledHostRefs } = useRuntimeExtensions();

/** Built-in extensions plus enabled runtime packages, for every widget list. */
const widgetCatalog = computed(() =>
  mergePaletteCatalog(enabledExtensions.value, enabledHostRefs.value, isEnabled),
);

/** Resolve the same catalog icon for an existing widget row and its New row. */
function extensionIconUrl(row: PaletteRow): string | undefined {
  if (row.kind === "type" || row.kind === "extensionAction") return row.iconUrl;
  if (row.kind === "widget") {
    return widgetCatalog.value.find((extension) => extension.id === row.typeId)?.iconUrl;
  }
  return undefined;
}

/**
 * Inline icon component for an extension, when it ships one.
 *
 * Keyed by type id rather than by row so search results and the widget
 * overview share it — and looked up from the catalog rather than carried on the row,
 * so searchable rows stay plain data.
 *
 * `getExtension` is the first-party path: action-only extensions are not in
 * the widget catalog, so looking only there would hide their icons.
 */
function extensionIconComponent(typeId: string): Component | undefined {
  return (
    getExtension(typeId)?.iconComponent ??
    widgetCatalog.value.find((extension) => extension.id === typeId)?.iconComponent
  );
}

/** Type/action-only id used to look up the catalog icon for a result row. */
function resultExtensionId(row: PaletteRow): string | undefined {
  if (row.kind === "type" || row.kind === "widget") return row.typeId;
  if (row.kind === "extensionAction") return row.extId;
  return undefined;
}

/**
 * Enabled actions that target no widget instance — whatever else their
 * extension ships.
 *
 * This used to also require `!extension.isWidget`, which conflates two
 * different things: whether the *extension* has a card, and whether the
 * *action* needs one. `needsInstance: false` already says the second, and
 * `buildExtensionActionRows` filters on exactly that.
 *
 * The conflation made such an action unreachable rather than merely misplaced.
 * A widget extension's actions are otherwise run from an instance row's chips,
 * and there is no instance row for an action that wants no instance — so the
 * handler could not be triggered at all. Snippets' "Expand Snippet" has been
 * declared that way and unreachable the whole time.
 */
const extensionActionRows = computed(() =>
  buildExtensionActionRows(allExtensions().filter((extension) => isEnabled(extension.id))),
);

const {
  statusLabel: onboardingLabel,
  progress: onboardingProgress,
  notifyPaletteQuery,
  replay,
  continueTour,
  skipTourAction,
} = useOnboarding();

/** Arc geometry for the onboarding status control (r=7 in a 20×20 viewBox). */
const ONBOARDING_ARC_CIRCUMFERENCE = 2 * Math.PI * 7;

const onboardingMenuOpen = ref(false);
const onboardingMenuEl = ref<HTMLElement | null>(null);
const onboardingTriggerEl = ref<HTMLButtonElement | null>(null);

/** Toggle the Continue / Restart / Quit menu on the status control. */
function toggleOnboardingMenu() {
  onboardingMenuOpen.value = !onboardingMenuOpen.value;
  if (onboardingMenuOpen.value) paletteMenuOpen.value = false;
}

/** Close the onboarding status dropdown. */
function closeOnboardingMenu() {
  onboardingMenuOpen.value = false;
}

/** Open the cockpit and show the coach bubble for the current tour step. */
function continueOnboarding() {
  closeOnboardingMenu();
  continueTour();
  void emit("palette:show");
}

/** Reset the tour to step 1 and show the coach again. */
function restartOnboarding() {
  closeOnboardingMenu();
  replay();
  continueTour();
  void emit("palette:show");
}

/** End the tour (same as Skip tour on the coach). */
function quitOnboarding() {
  closeOnboardingMenu();
  skipTourAction();
}

/** Reset transient browse state after an accepted action (does not advance onboarding). */
function afterPaletteAction() {
  selectedIndex.value = 0;
  // Opening something from inside a folder ends the browse — the next open
  // should not land back in a folder listing from minutes ago.
  exitFolderScope(false);
  closeRowMenu(false);
}

/** Hide the palette surface without dismissing the widgets behind it. */
function hidePaletteFromChrome() {
  paletteMenuOpen.value = false;
  closeOnboardingMenu();
  closeRowMenu(false);
  inlineMenuOpen.value = false;
  hidePalette?.();
}

const query = ref("");
const selectedIndex = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);
const searchActionsEl = ref<InstanceType<typeof PaletteSearchActions> | null>(null);
const widgetShortcutsEl = ref<InstanceType<typeof PaletteWidgetShortcuts> | null>(null);
const inlineWidgetBodyEl = ref<InstanceType<typeof InlineWidgetBody> | null>(null);
const answerPanelEl = ref<InstanceType<typeof PaletteAnswerPanel> | null>(null);
const searchActionError = ref<string | null>(null);
const { enabledActions: enabledSearchActions } = useSearchPrefs();
const { selectedIds: widgetShortcutIds } = usePaletteWidgetPrefs();
const widgetShortcuts = computed(() => widgetShortcutIds.value.flatMap((id) => {
  const widget = widgetCatalog.value.find((entry) => entry.id === id);
  return widget ? [widget] : [];
}));
const paletteAi = usePaletteAnswer({
  loadModel: getQuickActionModelDefinition,
  stream: (request, onEvent) =>
    tauriWidgetCapabilityTransport.llmStream("palette-search", request, onEvent, HOST_OWNER),
  cancel: (requestId) => tauriWidgetCapabilityTransport.llmCancel(requestId),
});
const { model: searchAiModel, answer: aiAnswer, messages: aiMessages, busy: aiBusy } = paletteAi;

/** Model discovery reads configuration only; it never sends the search text. */
function refreshSearchAiModel() {
  void paletteAi.refreshModel().catch(() => {});
}
watch(connectionEpoch, refreshSearchAiModel);

function closeAiAnswer() {
  paletteAi.reset();
  focusSearchInput();
}

function askSearchAi() {
  if (!showSearchActions.value) return;
  searchActionError.value = null;
  void paletteAi.ask(query.value);
  void nextTick(() => answerPanelEl.value?.focusComposer());
}

function runSearchAction(id: SearchActionId) {
  if (!enabledSearchActions.value.includes(id)) return;
  if (id === "ai") askSearchAi();
  else void searchWeb(id);
}

/** The OS opens the query in the user's default browser, just like the g prefix. */
async function searchWeb(id: WebSearchActionId) {
  if (!showSearchActions.value) return;
  paletteAi.reset();
  searchActionError.value = null;
  try {
    await invoke("launch_path", { path: buildWebSearchUrl(id, query.value) });
    afterPaletteAction();
    dismissAfterAction();
  } catch {
    searchActionError.value = "Could not open the browser. Try again.";
    focusSearchInput();
  }
}
const listEl = ref<HTMLUListElement | null>(null);
/** Custom overlay scrollbar (paints on top of rows; no layout gutter). */
const listOverlay = reactive({
  needed: false,
  thumbH: 0,
  thumbY: 0,
});
let listOverlayRo: ResizeObserver | undefined;
const paletteMenuOpen = ref(false);
/** Where a right-click opened the menu, relative to the palette; null for the ⋯ button. */
const paletteMenuAt = ref<{ x: number; y: number } | null>(null);
const paletteMenuEl = ref<HTMLElement | null>(null);
const paletteMenuTriggerEl = ref<HTMLElement | null>(null);
const paletteHeaderHovered = ref(false);
const paletteChromeFocused = ref(false);
const paletteRootEl = ref<HTMLElement | null>(null);

/** Habitual palette launches (boost only after 2+ gap-debounced opens). */
const appLaunchHistory = ref<AppLaunchHistoryState>(loadAppLaunchHistory());

/** Last 12 palette runs (ArrowDown on empty search). */
const recentRuns = ref<RecentPaletteRun[]>(loadRecentPaletteRuns());
/** When true and query is empty, results show `recentRuns` instead of search hits. */
const recentOpen = ref(false);
/** Empty-query ArrowUp shows the widgets already placed on the current desk. */
const widgetsOpen = ref(false);
/**
 * Widget rendered inside the results panel (Ctrl/Cmd+Enter), or null.
 *
 * Only ids are kept, never the instance: a real one stays the host's, so a
 * widget deleted or moved off this desk while inline drops out of the view
 * instead of leaving a stale copy behind. Declared up here because
 * `syncPreviewFromSelection` reads it long before the rest of the machinery.
 */
const inlineWidget = ref<{ instanceId: string; typeId: string } | null>(null);
const inlineShortcutId = ref<string | null>(null);
watch(inlineWidget, (target) => {
  if (!target) inlineShortcutId.value = null;
});

/** Apps the user hid from search (still reachable via Show more). */
const hiddenAppKeys = ref(loadHiddenApps());
/** When true, append hidden matches below the main list (Show hidden). */
const showHiddenApps = ref(false);

/** Path-autocomplete rows for the current path-like query. */
const pathCompletionRows = ref<PalettePathRow[]>([]);
let pathCompletionsTimer: ReturnType<typeof setTimeout> | undefined;
let pathCompletionsSeq = 0;
/** Cached home for `~` expansion (from Tauri path API). */
const homePath = ref<string | null>(null);

/* ── Folder scope ───────────────────────────────────────────────────────
 * Tab on a folder row stops searching everything and starts searching *in*
 * that folder: the list becomes its contents, and the chip next to the query
 * is where the in-folder search is typed. Subfolders stack, so Shift+Tab walks
 * back up the way it came.
 */

/** Browsed folders, innermost last; empty means folder scope is off. */
const folderStack = ref<FolderScopeEntry[]>([]);
/** What is typed into the folder chip — deliberately not the palette query. */
const folderScopeQuery = ref("");
/** Rows for the current folder (contents, or search hits inside it). */
const folderScopeRows = ref<PalettePathRow[]>([]);
const folderScopeInputEl = ref<HTMLInputElement | null>(null);
let folderScopeTimer: ReturnType<typeof setTimeout> | undefined;
let folderScopeSeq = 0;

/** The folder being browsed, or null. Declared here: `results` reads it. */
const folderScopeFolder = computed(() => currentFolder(folderStack.value));
const folderScopeActive = computed(() => folderScopeFolder.value !== null);

/** Sort order for file listings, remembered across sessions. */
const fileSortMode = ref(loadFileSortMode());

/** Host provides this to create a new widget instance by registry type id. */
const addWidget = inject<
  (
    typeId: string,
    opts?: { screen?: { x: number; y: number }; forceNew?: boolean },
  ) => string | undefined
>("kavibayAddWidget");
const toggleWidget = inject<(instanceId: string) => void>("kavibayToggleWidget");
const renameWidget = inject<(instanceId: string, title: string | undefined) => void>(
  "kavibayRenameWidget",
);
const removeWidget = inject<(instanceId: string, mode: "desk" | "everywhere") => void>(
  "kavibayRemoveWidget",
);
const focusWidget = inject<(instanceId: string) => void | Promise<void>>("kavibayFocusWidget");
const clearWidgetFocus = inject<() => void>("kavibayClearWidgetFocus");
const closeCockpit = inject<() => void>("kavibayCloseCockpit");
const hidePalette = inject<() => void>("kavibayHidePalette");
const previewWidget = inject<(instanceId: string | null) => void>("kavibayPreviewWidget");
const widgetInstances = inject<WidgetInstance[]>("kavibayWidgetInstances");
/** Desk names for a catalog instance (e.g. "Main" or "Main, Work"). */
const instanceDeskLabels = inject<(instanceId: string) => string>(
  "kavibayInstanceDeskLabels",
  () => "",
);
const palettePinned = inject<Ref<boolean>>("kavibayPalettePinned", ref(false));
const togglePalettePinned = inject<() => void>("kavibayTogglePalettePinned");
const paletteMovePointerdown = inject<(event: PointerEvent) => void>(
  "kavibayPaletteMovePointerdown",
);
const paletteWidth = inject<Ref<number | undefined>>("kavibayPaletteWidth", ref(undefined));
const paletteListHeight = inject<Ref<number | undefined>>(
  "kavibayPaletteListHeight",
  ref(undefined),
);
const shortcutHintTarget = inject(SHORTCUT_HINT_TARGET_KEY);
const shortcutModifier = shortcutModifierLabel();
const pinShortcutTip = `Pin\n${shortcutModifier}+P`;
const hidePaletteShortcutTip = `Hide\n${shortcutModifier}+W`;
const shortcutHintVisible = computed(
  () => shortcutHintTarget?.value?.kind === "palette",
);
const MAX_DESK_SHORTCUTS = 9;

/** Ctrl+Shift+1…9 selects the matching desk; later desks have no chord. */
function deskShortcutLabel(index: number): string | undefined {
  const number = index + 1;
  return number <= MAX_DESK_SHORTCUTS ? `Ctrl+Shift+${number}` : undefined;
}

/** Tooltip text for a desk chord while the palette shortcut hints are active. */
function deskShortcutTip(index: number): string | undefined {
  return deskShortcutLabel(index);
}
const resizePalette = inject<
  (payload: {
    width: number;
    height: number;
    deltaOffset: { x: number; y: number };
    edge?: string;
  }) => void
>("kavibayResizePalette");
const resizePaletteEnd = inject<() => void>("kavibayResizePaletteEnd");

/** Compact desk tab metadata from the host (Task 2 injects). */
type DeskTab = { id: string; name: string };

const kavibayDesks = inject<ComputedRef<DeskTab[]>>("kavibayDesks");
const kavibayActiveDeskId = inject<ComputedRef<string>>("kavibayActiveDeskId");
const kavibaySwitchDesk = inject<(deskId: string) => void>("kavibaySwitchDesk");
const kavibayAddDesk = inject<() => void>("kavibayAddDesk");
const kavibayRenameDesk = inject<(deskId: string, name: string) => void>("kavibayRenameDesk");
const kavibayDeleteDesk = inject<(deskId: string) => void>("kavibayDeleteDesk");
const kavibayCenterPalette = inject<() => void>("kavibayCenterPalette");
const kavibayAlsoOnDeskRows = inject<
  () => { instanceId: string; typeId: string; title: string; onDesks: string }[]
>("kavibayAlsoOnDeskRows");
const kavibayPlaceOnActiveDesk = inject<(instanceId: string) => void>("kavibayPlaceOnActiveDesk");

const deskCtxEl = ref<HTMLElement | null>(null);
const resultsPanelEl = ref<HTMLElement | null>(null);
const listShellEl = ref<HTMLElement | null>(null);
const renamingDeskId = ref<string | null>(null);
const renameDraft = ref("");
const renameInputEl = ref<HTMLInputElement | null>(null);
const deskCtxMenu = ref<{ deskId: string; x: number; y: number; confirming?: boolean } | null>(
  null,
);

/** Open / hidden tallies for the Widgets button tooltip (enabled types). */
const widgetTypeCounts = computed(() => {
  const instances = widgetInstances ?? [];
  let all = 0;
  let open = 0;
  let hidden = 0;
  for (const def of widgetCatalog.value) {
    all += 1;
    if (typeMatchesWidgetFilter(def.id, instances, "open")) open += 1;
    if (typeMatchesWidgetFilter(def.id, instances, "hidden")) hidden += 1;
  }
  return { all, open, hidden };
});

/** Hover tooltip: "3 open, 2 hidden" — omit any count that is 0. */
const widgetsButtonTitle = computed(() => {
  const parts: string[] = [];
  const { open, hidden } = widgetTypeCounts.value;
  if (open > 0) parts.push(`${open} open`);
  if (hidden > 0) parts.push(`${hidden} hidden`);
  return parts.length > 0 ? parts.join(", ") : "Widgets";
});

/**
 * Catalog instances parked on other desks, as rows of the widget overview.
 *
 * Only while the overview is open: the host walks every desk to label these,
 * and outside the overview an Enter that quietly re-lays-out the current desk
 * is not what a search hit should do.
 */
const offDeskWidgetRows = computed<PaletteWidgetRow[]>(() =>
  widgetsOpen.value ? buildOffDeskWidgetRows(kavibayAlsoOnDeskRows?.() ?? []) : [],
);

/** Bring a catalog instance from another desk onto this one. */
function placeOffDeskRow(row: PaletteWidgetRow) {
  if (!kavibayPlaceOnActiveDesk) return;
  kavibayPlaceOnActiveDesk(row.instanceId);
  closeWidgetOverview();
  afterPaletteAction();
}

/** True when delete is allowed (more than one desk). */
const canDeleteDesk = computed(() => (kavibayDesks?.value.length ?? 0) > 1);

let deskTabClickTimer: ReturnType<typeof setTimeout> | null = null;

const {
  open: settingsOpen,
  show: showSettings,
  showSection: showSettingsSection,
} = useSettingsModal();

// Settings takes focus while open; return it to the palette search when its
// modal closes so typing can continue without an extra click.
watch(settingsOpen, async (isOpen, wasOpen) => {
  if (isOpen || !wasOpen) return;
  refreshSearchAiModel();
  await nextTick();
  inputEl.value?.focus();
});
const { toggleColorMode } = useAppearance();

/** Search focus and hovering results do not reveal the card controls. */
function onPalettePointerMove(event: PointerEvent) {
  const rect = paletteRootEl.value?.getBoundingClientRect();
  if (!rect) return;
  paletteHeaderHovered.value = isCardHeaderHit(event.clientY, rect.top);
}

/** Match widgets: header hover, focus on a control, an open menu, or shortcut hints. */
const paletteChromeVisible = computed(
  () =>
    paletteHeaderHovered.value ||
    paletteChromeFocused.value ||
    paletteMenuOpen.value ||
    shortcutHintVisible.value,
);
const paletteChromePositionStyle = useCardChromePosition(paletteRootEl, paletteChromeVisible);

/** Effective palette outer width for resize handles. */
const resizeWidth = computed(() => paletteWidth.value ?? DEFAULT_PALETTE_WIDTH);

/** Stored height for the results list. */
const resizeListHeight = computed(
  () => paletteListHeight.value ?? DEFAULT_PALETTE_LIST_HEIGHT,
);

/** Keep a result panel from ever touching the bottom of the active screen. */
const RESULTS_VIEWPORT_GAP = 24;
const viewportListHeight = ref(Number.POSITIVE_INFINITY);
const renderedListHeight = computed(() =>
  Math.max(0, Math.min(resizeListHeight.value, viewportListHeight.value)),
);

function syncViewportListHeight() {
  const top = listShellEl.value?.getBoundingClientRect().top;
  if (top === undefined) return;

  viewportListHeight.value = Math.max(
    0,
    window.innerHeight - top - RESULTS_VIEWPORT_GAP,
  );
}

function onPalettePointerUp() {
  // The host applies its final drag position after bubbling the pointer event.
  requestAnimationFrame(syncViewportListHeight);
}

/** Height the list actually renders at, used as the resize handle's baseline. */
const listBoxHeight = ref(DEFAULT_PALETTE_LIST_HEIGHT);

/**
 * What the drag handle starts from. It tracks the rendered list height, which
 * can differ briefly while the palette is mounting or its results change.
 */
const resizeHandleHeight = computed(() =>
  showResultsList.value ? listBoxHeight.value : resizeListHeight.value,
);

/** Forward palette edge-resize to the host. */
function onPaletteResize(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
}) {
  resizePalette?.(payload);
}

/** End palette resize gesture. */
function onPaletteResizeEnd() {
  resizePaletteEnd?.();
  void nextTick().then(() => scheduleRegionSync());
}

/**
 * Resolve which mounted widget (if any) should show the selection ring.
 * Only visible/focusable targets — not create, show-hidden, commands, or apps.
 * App rows fall through to null (no ring on app selection).
 */
function previewTargetId(row: PaletteRow | undefined): string | null {
  if (!row) return null;
  if (row.kind === "type" && row.smart === "focus" && row.targetInstanceId) {
    return row.targetInstanceId;
  }
  if (row.kind === "widget" && !row.hidden && !row.offDesk) {
    return row.instanceId;
  }
  return null;
}

/**
 * After Tab focuses a widget, skip the selection ring/scale for that instance
 * until the user moves the selection (otherwise the watch would re-preview).
 */
let suppressPreviewInstanceId: string | null = null;

/**
 * True after Tab jumped from search into a widget. Shift+Tab then returns
 * focus to the palette input (capture listener) without breaking in-widget
 * Shift+Tab shortcuts at other times.
 */
let leftSearchViaTab = false;

/** Push the current selection’s preview target to the host (or clear it). */
function syncPreviewFromSelection() {
  // With a widget in the panel the selection is off screen — ringing a desk
  // card for it would highlight something the user is not looking at.
  if (inlineWidget.value !== null) {
    previewWidget?.(null);
    return;
  }
  const row = results.value[selectedIndex.value] as PaletteRow | undefined;
  const targetId = previewTargetId(row);
  if (targetId && targetId === suppressPreviewInstanceId) {
    previewWidget?.(null);
    return;
  }
  suppressPreviewInstanceId = null;
  previewWidget?.(targetId);
}

/** Resolve persisted MRU entries into live palette rows (skip missing/disabled). */
function resolveRecentRows(runs: RecentPaletteRun[]): PaletteRow[] {
  const instances = widgetInstances ?? [];
  const typeRows = buildTypeRows(widgetCatalog.value, instances);
  const typeById = new Map(typeRows.map((row) => [row.typeId, row]));
  const cmdById = new Map(commands.map((c) => [c.id, c]));
  const apps = installedAppsIndex.value;
  const appByPath = new Map(
    apps.map((app) => [app.path.trim().toLowerCase(), app] as const),
  );

  const rows: PaletteRow[] = [];
  for (const run of runs) {
    if (run.kind === "command") {
      const cmd = cmdById.get(run.commandId);
      if (!cmd) continue;
      rows.push(toCommandRow(cmd));
      continue;
    }
    if (run.kind === "type") {
      const row = typeById.get(run.typeId);
      if (row) rows.push(row);
      continue;
    }
    const app = appByPath.get(run.path.trim().toLowerCase());
    const name = app?.name ?? run.title;
    const path = app?.path ?? run.path;
    if (isAppHidden(hiddenAppKeys.value, name, path)) continue;
    const pinned = app?.pinned === true;
    rows.push({
      kind: "app",
      id: `app:${path}`,
      title: name,
      subtitle: pinned ? "Pinned app" : "App",
      keywords: [name],
      path,
      pinned,
      usageBoost: 0,
      rankScore: 0,
    });
  }
  return rows;
}

/** Score boosts shared by visible + hidden app row builders. */
function appUsageBoost(app: { name: string; path: string }): number {
  return usageBoostForApp(appLaunchHistory.value.apps, app.name, app.path);
}
function appQueryBoost(app: { name: string; path: string }): number {
  return queryFrecencyBoost(appLaunchHistory.value, query.value, app.name, app.path);
}

/** App visibility changes with the index/preferences, not with the search text. */
const appSearchPools = computed(() => {
  const visible: typeof installedAppsIndex.value = [];
  const hidden: typeof installedAppsIndex.value = [];
  for (const app of installedAppsIndex.value) {
    (isAppHidden(hiddenAppKeys.value, app.name, app.path) ? hidden : visible).push(app);
  }
  return { visible, hidden };
});

/** Hidden installed apps that still fuzzy-match the current query. */
const hiddenAppMatches = computed(() => {
  const q = query.value.trim();
  if (!q) return [];
  return buildAppRows(q, appSearchPools.value.hidden, 12, appUsageBoost, appQueryBoost).map((row) => ({
    ...row,
    fromHiddenSearch: true,
    subtitle: "Hidden from search",
  }));
});

const hiddenAppMatchCount = computed(() => hiddenAppMatches.value.length);

const openNewRows = computed(() => buildOpenNewRows(widgetCatalog.value));

/**
 * Keep query-independent rows and body text warm. Extension hooks read reactive
 * state here, so edits still invalidate the index; typing only re-ranks it.
 * Every instance is its own row; the create row rides underneath them.
 */
const widgetSearchIndex = computed(() =>
  buildInstanceSearchIndex(
    widgetInstances ?? [],
    widgetCatalog.value,
    (instance) => getExtension(instance.typeId)?.searchText?.(instance.instanceId) ?? "",
    (id) => instanceDeskLabels?.(id) ?? "",
  ),
);

const resultState = computed(() => {
  // Inside a folder, that folder is the whole world — mixing apps and widgets
  // back in would defeat the point of having scoped the search. Sorting here
  // (not at fetch time) is what makes switching the order instant.
  if (folderScopeActive.value) {
    return { rows: sortFileRows(folderScopeRows.value, fileSortMode.value), hasOtherResults: false };
  }

  // ArrowDown starts with the recent list; a typed query still ranks globally.
  if (recentOpen.value && query.value.trim().length === 0) {
    return { rows: resolveRecentRows(recentRuns.value), hasOtherResults: false };
  }

  const { rows: widgetRowsWithNotes, searchTextFor } = widgetSearchIndex.value;
  const typeRows = openNewRows.value;
  const offDeskRows = offDeskWidgetRows.value;
  if (widgetsOpen.value) {
    if (query.value.trim().length === 0) {
      return {
        rows: buildWidgetOverviewRows(widgetRowsWithNotes, typeRows, offDeskRows),
        hasOtherResults: false,
      };
    }
  }
  // Off-desk rows rank with the rest inside the overview and nowhere else.
  const searchableWidgetRows = widgetsOpen.value
    ? [...widgetRowsWithNotes, ...offDeskRows]
    : widgetRowsWithNotes;
  const appRows = buildAppRows(
    query.value,
    appSearchPools.value.visible,
    12,
    appUsageBoost,
    appQueryBoost,
  );
  const folderRows = buildFolderRows(query.value, knownFoldersIndex.value);
  const filtered = filterPaletteRows(
    query.value,
    commands,
    searchableWidgetRows,
    typeRows,
    appRows,
    folderRows,
    extensionActionRows.value,
  );
  const grouped = groupInstancesWithCreateRow(filtered);
  const withNotes = attachNoteSnippets(grouped, query.value, searchTextFor);
  // Path completions float first (high rankScore); then normal hits.
  const withPaths =
    pathCompletionRows.value.length > 0
      ? [...pathCompletionRows.value, ...withNotes]
      : withNotes;
  // Hidden matches stay off the main ranking until "Show hidden" is used.
  const allRows =
    showHiddenApps.value && hiddenAppMatches.value.length > 0
      ? [...withPaths, ...hiddenAppMatches.value]
      : withPaths;
  if (query.value.trim().length > 0 && (widgetsOpen.value || recentOpen.value)) {
    const scopedRows = widgetsOpen.value
      ? [...searchableWidgetRows, ...typeRows]
      : resolveRecentRows(recentRuns.value);
    const scopedIds = new Set(scopedRows.map((row) => row.id));
    return {
      rows: allRows.filter((row) => scopedIds.has(row.id)),
      hasOtherResults: allRows.some((row) => !scopedIds.has(row.id)),
    };
  }
  return { rows: allRows, hasOtherResults: false };
});

const results = computed(() => resultState.value.rows);
const scopedSearchHasOtherResults = computed(() => resultState.value.hasOtherResults);

/** Section titles for the empty-query widget overview; headers are not rows. */
const widgetOverviewSectionTitles = computed(() => {
  if (!widgetsOpen.value || query.value.trim().length !== 0) return new Map<number, string>();

  const titles = new Map<number, string>();
  const rows = results.value;
  const firstOpen = rows.findIndex(
    (row) => row.kind === "widget" && !row.hidden && !row.offDesk,
  );
  const firstHidden = rows.findIndex(
    (row) => row.kind === "widget" && row.hidden && !row.offDesk,
  );
  const firstOffDesk = rows.findIndex((row) => row.kind === "widget" && row.offDesk === true);
  const firstType = rows.findIndex((row) => row.kind === "type");
  if (firstOpen !== -1) titles.set(firstOpen, "Opened widgets");
  if (firstHidden !== -1) titles.set(firstHidden, "Hidden widgets");
  if (firstOffDesk !== -1) titles.set(firstOffDesk, "On other desks");
  if (firstType !== -1) titles.set(firstType, "All widgets");
  return titles;
});

/**
 * Per-instance glances for the visible rows, keyed by instanceId.
 *
 * Deliberately its own computed rather than a field baked into the rows: the
 * extension state it reads (a ticking countdown) changes several times a
 * second, and `results` must not re-rank apps and folders that often. This one
 * invalidates instead, and it is a handful of Map writes.
 */
const inlineViews = computed(() => {
  const out = new Map<string, ExtensionInlineView>();
  for (const row of results.value) {
    if (row.kind !== "widget" || row.offDesk) continue;
    const view = getExtension(row.typeId)?.inlineView?.(row.instanceId);
    // An extension may return null, or nothing worth a column.
    if (view && (view.value || view.label)) out.set(row.instanceId, view);
  }
  return out;
});

/**
 * State-dependent extension buttons for the visible instance rows.
 *
 * Shares the tick with `inlineViews` — both read the same extension state, so
 * a timer that runs out swaps "Pause" for "Dismiss" in the same frame the
 * countdown reaches zero.
 */
const instanceActions = computed(() => {
  const out = new Map<string, ExtensionInstanceAction[]>();
  for (const row of results.value) {
    if (row.kind !== "widget" || row.offDesk) continue;
    const actions = getExtension(row.typeId)?.instanceActions?.(row.instanceId);
    if (actions?.length) out.set(row.instanceId, actions);
  }
  return out;
});

/**
 * Actions of the selected instance row, offered as chips in the search field.
 *
 * They live next to what was typed rather than on the row itself: a row button
 * is a mouse target, while the palette is a keyboard surface — "tim", arrow to
 * the running timer, Tab, Enter.
 */
const rowActions = computed<ExtensionInstanceAction[]>(() => {
  const row = results.value[selectedIndex.value] as PaletteRow | undefined;
  if (!row || row.kind !== "widget" || row.offDesk) return [];
  return instanceActions.value.get(row.instanceId) ?? [];
});

/** Chips show as a dim hint as soon as such a row is selected. */
const showActionChips = computed(() => rowActions.value.length > 0);

/** Tab has committed to the chips; Enter now runs one instead of opening the row. */
const actionChipMode = ref(false);
const activeActionChipIndex = ref(0);
/** Typed text per chip, parallel to `rowActions`; only param chips use theirs. */
const actionChipValues = ref<string[]>([]);
const actionChipInputEls = ref<HTMLInputElement[]>([]);

/** Collect chip inputs in template order (v-for refs arrive unordered). */
function setActionChipInputEl(el: unknown, index: number) {
  if (el instanceof HTMLInputElement) actionChipInputEls.value[index] = el;
}

/** Activate the action chips for the selected row, landing on `index`. */
function enterActionChipMode(index = 0) {
  const actions = rowActions.value;
  if (actions.length === 0) return;
  if (!actionChipMode.value) {
    actionChipValues.value = actions.map(() => "");
    actionChipMode.value = true;
  }
  focusActionChip(Math.min(index, actions.length - 1));
}

/** Highlight a chip, and put the caret in it when it takes a value. */
function focusActionChip(index: number) {
  activeActionChipIndex.value = index;
  void nextTick(() => {
    if (rowActions.value[index]?.param) {
      const el = actionChipInputEls.value[index];
      el?.focus();
      el?.select();
      return;
    }
    // A button chip has nothing to type into; keys stay with the search field.
    inputEl.value?.focus();
  });
}

/** Back to plain search; chips fall back to their dim hint state. */
function exitActionChipMode() {
  if (!actionChipMode.value) return;
  actionChipMode.value = false;
  activeActionChipIndex.value = 0;
  actionChipValues.value = [];
  void nextTick(() => {
    inputEl.value?.focus();
    const len = query.value.length;
    inputEl.value?.setSelectionRange(len, len);
  });
}

/**
 * Run one action and stay put — the palette is mid-task, and the row it
 * belongs to re-renders into its next state (Pause becomes Resume).
 *
 * A rejected value (an unparsable duration) throws out of `run`; keep the chip
 * open with the text intact so it can be corrected rather than retyped.
 */
function runInstanceAction(action: ExtensionInstanceAction, value = "") {
  if (action.param?.required && !value.trim()) {
    return;
  }
  try {
    action.run(value.trim());
  } catch {
    return;
  }
  exitActionChipMode();
}

/** Enter while the chips are live runs the highlighted one. */
function runActiveActionChip() {
  const index = activeActionChipIndex.value;
  const action = rowActions.value[index];
  if (action) runInstanceAction(action, actionChipValues.value[index] ?? "");
}

/** Click on a chip: run it outright, or open it for typing when it takes a value. */
function onActionChipClick(action: ExtensionInstanceAction, index: number) {
  if (action.param) {
    enterActionChipMode(index);
    return;
  }
  runInstanceAction(action);
}

/**
 * The folder the chip talks about: the one being browsed, or — before Tab —
 * the folder row the selection is sitting on. That preview is what makes the
 * chip a hint rather than a mode nobody finds.
 */
const folderChipEntry = computed<FolderScopeEntry | null>(() => {
  const active = folderScopeFolder.value;
  if (active) return active;
  const row = results.value[selectedIndex.value];
  if (!isBrowsableRow(row)) return null;
  return { path: row.path, title: folderTitle(row.path) };
});

/** Full path of the browsed folder, for the breadcrumb above the list. */
const folderScopePath = computed(() => folderScopeFolder.value?.path ?? "");

/** Label of the sort control, e.g. "Modified ↓". */
const fileSortLabel = computed(() => sortModeLabel(fileSortMode.value));

/** Step to the next order and keep it for next time. Selection stays on row 0. */
function cycleFileSort() {
  const next = nextSortMode(fileSortMode.value);
  fileSortMode.value = next;
  saveFileSortMode(next);
  selectedIndex.value = 0;
  void scrollSelectedIntoView();
}

/** Empty list inside a folder: nothing matched, or the folder itself is empty. */
const folderScopeEmptyLabel = computed(() => {
  const title = folderScopeFolder.value?.title ?? "this folder";
  return folderScopeQuery.value.trim()
    ? `No matches in ${title}`
    : `${title} is empty`;
});

/** Start browsing `path`; descending from inside stacks another level. */
function enterFolderScope(path: string) {
  folderStack.value = enterFolder(folderStack.value, path);
  folderScopeQuery.value = "";
  folderScopeRows.value = [];
  selectedIndex.value = 0;
  void loadFolderScope();
  focusFolderChip();
}

/** Tab / click on the chip: browse whatever the chip is currently naming. */
function enterFolderScopeFromChip() {
  const entry = folderChipEntry.value;
  if (!entry) return;
  if (folderScopeActive.value) {
    focusFolderChip();
    return;
  }
  enterFolderScope(entry.path);
}

/** One level back up; leaving the outermost level returns to plain search. */
function leaveFolderScope() {
  const next = leaveFolder(folderStack.value);
  folderStack.value = next;
  folderScopeQuery.value = "";
  folderScopeRows.value = [];
  selectedIndex.value = 0;
  if (next.length === 0) {
    focusSearchInput();
    return;
  }
  void loadFolderScope();
  focusFolderChip();
}

/** Drop folder scope entirely (Escape, or the palette query changing). */
function exitFolderScope(refocus = true) {
  if (!folderScopeActive.value) return;
  folderScopeSeq += 1;
  if (folderScopeTimer) clearTimeout(folderScopeTimer);
  folderStack.value = [];
  folderScopeQuery.value = "";
  folderScopeRows.value = [];
  selectedIndex.value = 0;
  if (refocus) focusSearchInput();
}

function focusFolderChip() {
  void nextTick(() => {
    folderScopeInputEl.value?.focus();
    folderScopeInputEl.value?.select();
  });
}

/** Put the caret back at the end of the palette query. */
function focusSearchInput() {
  void nextTick(() => {
    inputEl.value?.focus();
    const len = query.value.length;
    inputEl.value?.setSelectionRange(len, len);
  });
}

/** Typing in the chip re-runs the in-folder search (debounced like paths). */
watch(folderScopeQuery, () => {
  if (!folderScopeActive.value) return;
  if (folderScopeTimer) clearTimeout(folderScopeTimer);
  folderScopeTimer = setTimeout(() => void loadFolderScope(), 90);
});

/**
 * Fill the list from the backend: contents while the chip is empty, search
 * hits once something is typed. Sequence-guarded so a slow answer for an
 * earlier keystroke cannot overwrite a newer one.
 */
async function loadFolderScope() {
  const folder = folderScopeFolder.value;
  if (!folder) return;
  const seq = ++folderScopeSeq;
  const term = folderScopeQuery.value.trim();
  try {
    const entries = term
      ? await searchFolder(folder.path, term)
      : await listFolder(folder.path);
    if (seq !== folderScopeSeq) return;
    folderScopeRows.value = fileEntriesToRows(entries, folder.path);
    selectedIndex.value = 0;
  } catch {
    // Unreadable folder — an empty list plus the still-open chip is the answer.
    if (seq === folderScopeSeq) folderScopeRows.value = [];
  }
}

/* ── Argument mode ──────────────────────────────────────────────────────
 * A command row with params collects them as inline chips before running.
 * The search input's value never changes while chips are typed, so the result
 * list stays frozen on the selected row without extra state.
 */

const argMode = ref(false);
const argValues = ref<string[]>([]);
const activeParamIndex = ref(0);
const argInputEls = ref<HTMLInputElement[]>([]);
const enumSuggestionIndex = ref(0);

/**
 * The action of the selected row — an extension action riding on its widget
 * row, or a parameterized OS command. Null when the row has none.
 */
const activeAction = computed<PaletteRowAction | null>(() =>
  paletteRowAction(results.value[selectedIndex.value] as PaletteRow | undefined),
);

/** Params of the row currently selected (previewed) or collecting arguments. */
const argParams = computed<ActionParam[]>(() => {
  const action = activeAction.value;
  if (!action) return [];
  if (action.extId) {
    const ext = getExtension(action.extId);
    if (typeof ext?.dynamicActionParams === "function") {
      return ext.dynamicActionParams(action.actionId, argValues.value);
    }
  }
  return action.params;
});

// Placeholder chips come and go as the template is typed; keep values by name.
watch(
  argParams,
  (params, previous) => {
    const aligned = alignArgValues(params, previous ?? [], argValues.value);
    if (
      aligned.length === argValues.value.length &&
      aligned.every((value, index) => value === argValues.value[index])
    ) {
      return;
    }
    argValues.value = aligned;
  },
  { flush: "sync" },
);

/**
 * Chips are visible as soon as a parameterized row is selected — the hint is
 * what makes Tab discoverable. They only accept input in argument mode.
 */
const showChips = computed(() => argParams.value.length > 0);

/** Palette-native autocomplete for enum arguments — native datalists ignore our theme. */
const enumSuggestions = computed(() => {
  if (!argMode.value) return [];
  const param = argParams.value[activeParamIndex.value];
  if (!param?.options?.length) return [];
  const needle = (argValues.value[activeParamIndex.value] ?? "").trim().toLowerCase();
  return (param.options ?? []).filter((option) => option.toLowerCase().includes(needle));
});

watch([activeParamIndex, () => argValues.value[activeParamIndex.value] ?? ""], () => {
  enumSuggestionIndex.value = 0;
});

function selectEnumSuggestion(index = enumSuggestionIndex.value, advance = false) {
  const option = enumSuggestions.value[index];
  if (!option) return;
  argValues.value[activeParamIndex.value] = option;
  enumSuggestionIndex.value = index;
  if (advance) focusParamChip(nextParamIndex(activeParamIndex.value, argParams.value.length));
}

/** Collect chip inputs in template order (v-for refs arrive unordered). */
function setArgInputEl(el: unknown, index: number) {
  if (el instanceof HTMLInputElement) argInputEls.value[index] = el;
  else delete argInputEls.value[index];
}

function focusParamChip(index: number) {
  activeParamIndex.value = index;
  void nextTick(() => {
    const el = argInputEls.value[index];
    el?.focus();
    el?.select();
  });
}

/** Activate the chips for the selected row; no-op when it takes no parameters. */
function enterArgMode(index = 0) {
  const action = activeAction.value;
  if (!action || argParams.value.length === 0) return;
  if (!argMode.value) {
    argValues.value = argParams.value.map((_, index) => argValues.value[index] ?? "");
    argMode.value = true;
  }
  focusParamChip(index);
}

/** Click on a preview chip: activate argument mode on that very chip. */
function enterArgModeAt(index: number) {
  enterArgMode(index);
}

/** Click on the Arguments hint: select that row first, then open its chips. */
function enterArgModeFor(index: number) {
  selectedIndex.value = index;
  void nextTick(() => enterArgMode());
}

/** Back to plain search; the chips fall back to their dim hint state. */
function exitArgMode(focusSearch = true) {
  if (!argMode.value) return;
  argMode.value = false;
  argValues.value = [];
  activeParamIndex.value = 0;
  enumSuggestionIndex.value = 0;
  if (!focusSearch) return;
  void nextTick(() => {
    inputEl.value?.focus();
    const len = query.value.length;
    inputEl.value?.setSelectionRange(len, len);
  });
}

// Changing what is selected, or what was searched for, invalidates the chips.
watch([query, selectedIndex], () => {
  if (argMode.value) exitArgMode();
  if (actionChipMode.value) exitActionChipMode();
});

/** Live calculator result for the current query; null when not a valid expression. */
const calcDisplay = computed(() => {
  const result = evaluate(query.value);
  if (!result.ok) return null;
  return formatResult(result.value);
});

/**
 * The instance to render inline: the host's if it owns one under that id, else
 * the palette's own scratch widget for the type.
 *
 * The scratch shape is built here instead of being added to the layout on
 * purpose. An instance placed on no desk has no home in the layout — the host
 * reads hidden-everywhere instances as leftovers and purges them — so the
 * palette keeps this one to itself. Only the widget's own state persists, under
 * the stable scratch id, exactly as it would for a real instance.
 */
const inlineWidgetInstance = computed<WidgetInstance | null>(() => {
  const target = inlineWidget.value;
  if (!target) return null;
  const live = widgetInstances?.find((row) => row.instanceId === target.instanceId);
  if (live) return live;
  if (!isInlineScratchInstanceId(target.instanceId)) return null;
  return { instanceId: target.instanceId, typeId: target.typeId, offset: { x: 0, y: 0 } };
});

/** Its extension (builtin or enabled runtime package); null when unavailable. */
const inlineWidgetDef = computed(() => {
  const instance = inlineWidgetInstance.value;
  if (!instance) return null;
  return resolveExtension(instance.typeId) ?? null;
});

/** True only while there is something to render — the panel follows this. */
const inlineWidgetOpen = computed(
  () => inlineWidgetInstance.value !== null && inlineWidgetDef.value !== null,
);

/**
 * Inline widgets may be shorter than the result list. Their height is
 * remembered per widget type using the same size memory as desk cards.
 */
const inlineTypeSizes = ref<Record<string, RememberedSize>>(loadTypeSizes());

const inlineWidgetHeight = computed(() => {
  const def = inlineWidgetDef.value;
  const preferredHeight = def?.defaultSize?.h;
  const rememberedHeight = def ? inlineTypeSizes.value[def.id]?.h : undefined;
  if (typeof rememberedHeight === "number") return rememberedHeight;
  return typeof preferredHeight === "number"
    ? preferredHeight
    : resizeListHeight.value;
});

/** Persist an inline height without overwriting the type's desk-card width. */
function onInlineWidgetResize(payload: { height: number }) {
  const def = inlineWidgetDef.value;
  if (!def) return;
  const previous = inlineTypeSizes.value[def.id];
  const size: RememberedSize = {
    w: previous?.w ?? def.defaultSize?.w ?? resizeWidth.value,
    h: payload.height,
  };
  inlineTypeSizes.value = { ...inlineTypeSizes.value, [def.id]: size };
  rememberTypeSize(def.id, size);
}

/** Per-widget zoom of the inline view, surviving close/reopen and restarts. */
const inlineZoom = ref<InlineZoomMap>(loadInlineZoom());

/**
 * Zoom is surface-local. A desk card can legitimately be zoomed for a tiny
 * corner, but inheriting that scale into the wide palette made compact widgets
 * overflow their panel before the user ever zoomed there.
 */
const inlineWidgetScale = computed(() => {
  const target = inlineWidget.value;
  if (!target) return DEFAULT_CONTENT_SCALE;
  const remembered = inlineZoom.value[target.instanceId];
  if (typeof remembered === "number") return remembered;
  return DEFAULT_CONTENT_SCALE;
});

/** Ctrl/Cmd+wheel or trackpad pinch inside the panel. */
function onInlineZoom(scale: number) {
  const target = inlineWidget.value;
  if (!target) return;
  const next = withInlineZoom(inlineZoom.value, target.instanceId, scale);
  inlineZoom.value = next;
  saveInlineZoom(next);
}

/** Panel header: the instance's own name, falling back to the type's. */
const inlineWidgetTitle = computed(() => {
  const instance = inlineWidgetInstance.value;
  if (!instance) return "";
  return instance.title ?? inlineWidgetDef.value?.title ?? instance.typeId;
});

/**
 * Ctrl/Cmd+Enter: open the selected row's widget inside the panel.
 *
 * Nothing is added to the desk — that is the whole point of the chord. A row
 * that owns an instance shows that instance; a catalog row shows the palette's
 * scratch copy of the type, so peeking at a widget the user does not have never
 * leaves a card behind.
 *
 * The query is left alone, so Back returns to the results it was opened from.
 */
function openInlineWidget(index: number) {
  const target = resolveInlineWidgetTarget(results.value[index] as PaletteRow | undefined);
  if (!target) return;
  showInlineWidget(target);
  inputEl.value?.focus();
}

function showInlineWidget(target: InlineWidgetTarget, fromShortcut = false) {
  inlineShortcutId.value = fromShortcut ? target.typeId : null;
  const instanceId = target.kind === "instance" ? target.instanceId : inlineScratchInstanceId(target.typeId);
  // Focus and click can arrive for the same icon; do not initialise it twice.
  if (inlineWidget.value?.instanceId === instanceId) return;
  // Chips belong to a row; the row list is about to be replaced by the widget.
  if (argMode.value) exitArgMode(false);
  if (actionChipMode.value) exitActionChipMode();
  closeRowMenu(false);
  if (target.kind === "scratch") {
    // A catalog "New" row is a fresh, palette-local instance. Let extensions
    // initialise it through the same lifecycle hook used for desk instances.
    runExtensionHook(
      getExtension(target.typeId),
      "onCreate",
      inlineScratchInstanceId(target.typeId),
    );
  }
  inlineWidget.value = { instanceId, typeId: target.typeId };
  previewWidget?.(null);
  rememberRecentRun({ kind: "type", typeId: target.typeId, title: target.title });
}

function openWidgetShortcut(typeId: string) {
  const widget = widgetShortcuts.value.find((entry) => entry.id === typeId);
  if (!widget) return;
  // Match the catalog's normal reuse policy, including hidden desk instances.
  const row = buildTypeRows([widget], widgetInstances ?? [])[0];
  const target = resolveInlineWidgetTarget(row);
  if (target) showInlineWidget(target, true);
}

function leaveWidgetShortcuts() {
  if (inlineShortcutId.value) closeInlineWidget();
  focusSearchInput();
}

function enterWidgetShortcut() {
  void nextTick(() => inlineWidgetBodyEl.value?.focusEntry());
}

watch(widgetShortcuts, (widgets) => {
  if (inlineShortcutId.value && !widgets.some((widget) => widget.id === inlineShortcutId.value)) {
    closeInlineWidget();
  }
});

/**
 * Send the inline widget out of the palette and onto the desk as its own card.
 *
 * A real instance just gets revealed and focused — the same thing Ctrl+Enter on
 * its row does. The palette's scratch copy has no card to reveal, so it gets one,
 * and its content **moves** with it: the duplicate hook is the established way to
 * carry per-instance state to a new id, and without it the button would promise
 * the widget on screen and hand over an empty one.
 */
async function popOutInlineWidget() {
  const target = inlineWidget.value;
  if (!target) return;
  const title = inlineWidgetTitle.value;

  if (!isInlineScratchInstanceId(target.instanceId)) {
    const instanceId = target.instanceId;
    closeInlineWidget();
    rememberRecentRun({ kind: "type", typeId: target.typeId, title });
    afterPaletteAction();
    await focusWidget?.(instanceId);
    return;
  }

  const created = addWidget?.(target.typeId, { forceNew: true });
  if (!created) return;
  const ext = getExtension(target.typeId);
  // Synchronous on purpose: the new card mounts on the next tick, so the widget
  // reads the seeded state instead of the defaults it was created with.
  await runDuplicateHook(ext, target.instanceId, created);
  // Moved, not copied — but only where the hooks can actually carry the state.
  // A runtime package keeps its storage in Rust, out of reach of onDispose, so
  // its scratch copy is left intact rather than cleared after nothing moved.
  if (ext) runExtensionHook(ext, "onDispose", target.instanceId);
  closeInlineWidget();
  rememberRecentRun({ kind: "type", typeId: target.typeId, title });
  afterPaletteAction();
  await focusWidget?.(created);
}

/** Leave the inline widget and return to the rows it was opened from. */
function closeInlineWidget() {
  if (inlineWidget.value === null) return;
  inlineWidget.value = null;
  syncPreviewFromSelection();
  inputEl.value?.focus();
  void scrollSelectedIntoView();
}

/**
 * Inline-local shortcuts: Escape or Alt+Left return to results; Ctrl/Cmd+O
 * puts the widget on the desk. This must live on the container because a
 * focused widget is a sibling of the palette search input, not its child.
 *
 * Bubble phase on purpose: a widget that handles Escape itself (closing its own
 * popover) stops the event before it gets here, and the window-level handler
 * that hides the whole overlay only ever sees Escapes we did not want.
 */
function onInlineWidgetKeydown(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    event.stopPropagation();
    void popOutInlineWidget();
    return;
  }
  if (event.altKey && !mod && event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    closeInlineWidget();
    return;
  }
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeInlineWidget();
}

/** Deleted, moved off this desk, or its extension disabled — drop the view.
    A scratch widget has no such fate; only real instances can vanish. */
watch(inlineWidgetOpen, (open) => {
  if (!open) closeInlineWidget();
});

/**
 * A card menu chose "Move to main panel". Taken and cleared here so the same
 * widget can be moved over again later, and so a request that arrives while
 * another widget is inline simply replaces it.
 */
watch(inlineWidgetRequest, (request) => {
  if (!request) return;
  inlineWidgetRequest.value = null;
  if (argMode.value) exitArgMode(false);
  if (actionChipMode.value) exitActionChipMode();
  closeRowMenu(false);
  // The query is deliberately left alone: clearing it here would fire the query
  // watcher, whose whole job is to drop the inline view — it would close the
  // panel we are opening. Back then returns to whatever was searched, same as
  // when the view is opened from a row.
  inlineShortcutId.value = null;
  inlineWidget.value = { instanceId: request.instanceId, typeId: request.typeId };
  previewWidget?.(null);
});

/** Show the results panel while searching, calc, browsing recents or a folder. */
const showResultsList = computed(
  () =>
    query.value.trim().length > 0 ||
    calcDisplay.value !== null ||
    recentOpen.value ||
    widgetsOpen.value ||
    inlineWidgetOpen.value ||
    folderScopeActive.value,
);

/** Offer external answers only when ordinary search has genuinely found nothing. */
const showSearchActions = computed(() =>
  enabledSearchActions.value.length > 0 && query.value.trim().length > 0 && results.value.length === 0 &&
  hiddenAppMatchCount.value === 0 && !scopedSearchHasOtherResults.value &&
  calcDisplay.value === null && !folderScopeActive.value && !inlineWidgetOpen.value &&
  !argMode.value && !actionChipMode.value && !looksLikePathQuery(query.value) &&
  parsePrefixSearch(query.value) === null,
);
const showWidgetShortcuts = computed(() =>
  widgetShortcuts.value.length > 0 && query.value.trim().length === 0 &&
  !folderScopeActive.value && !argMode.value && !actionChipMode.value,
);
watch(showSearchActions, (visible) => {
  if (visible) return;
  paletteAi.reset();
  searchActionError.value = null;
});

/** Keep host preview scale in sync with the selected palette row. */
watch([selectedIndex, results], syncPreviewFromSelection, { immediate: true });

/** Warm shell icons for visible app hits (debounced so typing isn't fighting IPC). */
let iconWarmTimer: ReturnType<typeof setTimeout> | undefined;
watch(results, (rows) => {
  if (iconWarmTimer) clearTimeout(iconWarmTimer);
  iconWarmTimer = setTimeout(() => {
    const paths = rows
      .filter((row): row is Extract<PaletteRow, { kind: "app" }> => row.kind === "app")
      .map((row) => row.path);
    if (paths.length > 0) ensureAppIcons(paths);
    // File rows want one icon per extension, so a folder full of PDFs asks once.
    const typeKeys = rows.map((row) => rowFileTypeKey(row));
    void ensureFileTypeIcons(typeKeys);
  }, 80);
});

/**
 * Right-hand meta text for a file row: when it was last written.
 *
 * Fixed to the date even while sorting by size — the size already sits on the
 * row's second line, and a column that repeats it would waste the one spot
 * where the other fact fits.
 */
function rowMetaLabel(row: PaletteRow): string {
  if (row.kind !== "path") return "";
  return formatModified(row.modifiedMs);
}

/** Type key for a file row's shell icon; null for anything that isn't a file. */
function rowFileTypeKey(row: PaletteRow): string | null {
  if (row.kind !== "path") return null;
  return fileTypeIconKey(row.title, row.isDir);
}

/** Loaded shell icon for a row, or null while the drawn mark stands in. */
function rowFileTypeIcon(row: PaletteRow): string | null {
  const key = rowFileTypeKey(row);
  return key ? fileTypeIcons.value[key] ?? null : null;
}

/** Leave the empty-query widget inventory without changing the search text. */
function closeWidgetOverview() {
  widgetsOpen.value = false;
  selectedIndex.value = 0;
  inputEl.value?.focus();
}

/** Leave the empty-query recent-runs list without changing the search text. */
function closeRecentOverview() {
  recentOpen.value = false;
  selectedIndex.value = 0;
  inputEl.value?.focus();
}

/** The fixed panel header is shared by the browse views and the inline widget. */
const overviewHeaderTitle = computed(() => {
  // A valid expression owns the results panel. Do not leave the browse
  // breadcrumb visible when the palette has switched to calculator mode.
  if (calcDisplay.value !== null) return null;
  if (inlineWidgetOpen.value) return inlineWidgetTitle.value;
  if (widgetsOpen.value) return "Widgets";
  if (recentOpen.value) return "Recently opened";
  return null;
});

/**
 * Double-click the panel title to rename, exactly as on a card.
 *
 * Only a real instance can be renamed: the name lives on its catalog entry, and
 * a scratch copy has none — so the gesture is not offered there rather than
 * quietly doing nothing.
 */
const inlineWidgetRenameable = computed(
  () =>
    inlineWidgetOpen.value &&
    inlineWidget.value !== null &&
    !isInlineScratchInstanceId(inlineWidget.value.instanceId),
);

/**
 * The inline widget's own menu (Notes' "Show formatting" and friends).
 *
 * The state lives here because the button is in the header, but the popover is
 * rendered by `InlineWidgetBody` — only that subtree provides the context an
 * extension's menu component injects.
 */
const inlineMenuOpen = ref(false);
const inlineMenuTriggerEl = ref<HTMLButtonElement | null>(null);

/** True when the widget contributes menu items worth a ⋯ button. */
const inlineWidgetHasMenu = computed(() =>
  Boolean(inlineWidgetDef.value?.menuComponent || inlineWidgetDef.value?.settingsComponent),
);

/** Switching widget or leaving the panel must not leave a menu behind. */
watch([inlineWidget, inlineWidgetOpen], () => {
  inlineMenuOpen.value = false;
});

const inlineRenaming = ref(false);
const inlineTitleDraft = ref("");
const inlineTitleInputEl = ref<HTMLInputElement | null>(null);

async function startInlineRename() {
  if (inlineRenaming.value || !inlineWidgetRenameable.value) return;
  inlineTitleDraft.value = inlineWidgetTitle.value;
  inlineRenaming.value = true;
  await nextTick();
  inlineTitleInputEl.value?.focus();
  inlineTitleInputEl.value?.select();
}

/** Persist the trimmed title; empty restores the extension's own name. */
function commitInlineRename() {
  if (!inlineRenaming.value) return;
  const target = inlineWidget.value;
  inlineRenaming.value = false;
  if (!target) return;
  const trimmed = inlineTitleDraft.value.trim();
  renameWidget?.(target.instanceId, trimmed.length > 0 ? trimmed : undefined);
}

function cancelInlineRename() {
  inlineRenaming.value = false;
}

/** Enter commits, Escape aborts — neither may reach the panel's own handlers. */
function onInlineTitleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    commitInlineRename();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    // Otherwise the panel would read it as "close the widget".
    event.stopPropagation();
    cancelInlineRename();
  }
}

/** An edit in progress does not survive the panel closing under it. */
watch(inlineWidgetOpen, (open) => {
  if (!open) inlineRenaming.value = false;
});

/** Back button label — a widget is a view of one thing, not an overview. */
const overviewBackLabel = computed(() =>
  inlineWidgetOpen.value
    ? `Close ${inlineWidgetTitle.value}`
    : `Close ${overviewHeaderTitle.value} overview`,
);

const searchPlaceholder = computed(() => {
  // Parameter chips already explain the selected action. Keep the search
  // affordance, but avoid repeating the long browse-context label beside them.
  if (showChips.value || showActionChips.value) return "Search…";
  if (widgetsOpen.value) return "Search in widgets";
  if (recentOpen.value) return "Search in recently opened";
  return "Search or run anything";
});

/** One step back: out of the widget first, then out of the browse view. */
function closeOverview() {
  if (inlineWidgetOpen.value) closeInlineWidget();
  else if (widgetsOpen.value) closeWidgetOverview();
  else closeRecentOverview();
}

/** Leave a scoped browse view and reveal the global matches for this query. */
function showAllSearchResults() {
  widgetsOpen.value = false;
  recentOpen.value = false;
  selectedIndex.value = 0;
  inputEl.value?.focus();
}

// Every query change resets the selection to the first (best) result.
watch(query, (next) => {
  paletteAi.reset();
  searchActionError.value = null;
  selectedIndex.value = 0;
  showHiddenApps.value = false;
  // Editing the query is a new search, not a search in the browsed folder.
  // The caret is already in the input, so don't move it.
  exitFolderScope(false);
  // The menu belonged to a row that is about to be replaced.
  closeRowMenu(false);
  // Typing in the search field is a new search, so the panel goes back to rows.
  // Keys typed inside the inline widget never reach the query, so this only
  // fires when the user deliberately returned to searching.
  inlineWidget.value = null;
  // Browse views deliberately retain their scope while the user types.
  // Step 1 completes when the demo term is typed — clear so step 2 starts clean.
  if (notifyPaletteQuery(next)) {
    query.value = "";
  }
  schedulePathCompletions(next);
});

/**
 * Debounced path autocomplete: when the query looks like `c:/dev` or `~/…`,
 * ask Rust for matching children under the parent directory.
 */
function schedulePathCompletions(next: string) {
  if (pathCompletionsTimer) clearTimeout(pathCompletionsTimer);
  if (!looksLikePathQuery(next)) {
    pathCompletionRows.value = [];
    return;
  }
  const seq = ++pathCompletionsSeq;
  pathCompletionsTimer = setTimeout(() => {
    void loadPathCompletions(next, seq);
  }, 60);
}

/** Resolve home once, parse query, invoke list_path_completions. */
async function loadPathCompletions(next: string, seq: number) {
  try {
    if (homePath.value == null && next.trim().startsWith("~")) {
      try {
        homePath.value = await homeDir();
      } catch {
        homePath.value = null;
      }
    }
    // Prefer known-folders home when already resolved.
    const home =
      homePath.value ??
      builtinFoldersIndex.value.find((f) => f.id === "home")?.path ??
      null;
    const parts = parsePathQuery(next, home);
    if (!parts) {
      if (seq === pathCompletionsSeq) pathCompletionRows.value = [];
      return;
    }
    const entries = await completePath(parts.dir, parts.prefix);
    if (seq !== pathCompletionsSeq) return;
    // Same row shape as a folder listing: every hit is a direct child of the
    // directory that was just typed, so naming it again would only echo the query.
    pathCompletionRows.value = fileEntriesToRows(entries, parts.dir);
  } catch {
    if (seq === pathCompletionsSeq) pathCompletionRows.value = [];
  }
}

/* ── Row action menu ────────────────────────────────────────────────────
 * The caret next to Open. It renders as a sibling of the results panel, not
 * inside the row: the panel clips its overflow, so a menu on the last row
 * would be cut off exactly where it needs to open.
 */

/** Id of the row whose menu is open; null when none is. */
const rowMenuRowId = ref<string | null>(null);
/** Offsets against the palette root, so the menu is not clipped by the list. */
const rowMenuPos = ref<{ top: number | null; bottom: number | null; right: number }>({
  top: null,
  bottom: null,
  right: 0,
});
const rowMenuEl = ref<HTMLElement | null>(null);
let rowMenuTriggerEl: HTMLElement | null = null;

/** Row the open menu belongs to; null once it disappears from the results. */
const rowMenuRow = computed(() => {
  const id = rowMenuRowId.value;
  if (!id) return null;
  const row = results.value.find((entry) => entry.id === id);
  return row && (row.kind === "folder" || row.kind === "path") ? row : null;
});

/** Guess before the menu exists — only decides which way it opens. */
const ROW_MENU_HEIGHT = 88;

function toggleRowMenu(row: PaletteRow, event: MouseEvent) {
  if (rowMenuRowId.value === row.id) {
    closeRowMenu();
    return;
  }
  const root = paletteRootEl.value;
  const trigger = event.currentTarget as HTMLElement | null;
  if (!root || !trigger) return;

  const rootRect = root.getBoundingClientRect();
  const rect = trigger.getBoundingClientRect();
  const flipUp = rect.bottom + ROW_MENU_HEIGHT > window.innerHeight;
  rowMenuPos.value = {
    top: flipUp ? null : rect.bottom - rootRect.top + 6,
    bottom: flipUp ? rootRect.bottom - rect.top + 6 : null,
    right: rootRect.right - rect.right,
  };
  rowMenuTriggerEl = trigger;
  rowMenuRowId.value = row.id;
  void nextTick(() => {
    // Focus the first item so the menu is keyboard-usable once it is open.
    rowMenuEl.value?.querySelector("button")?.focus();
  });
}

function closeRowMenu(refocus = true) {
  if (!rowMenuRowId.value) return;
  rowMenuRowId.value = null;
  rowMenuTriggerEl = null;
  if (refocus) focusSearchInput();
}

/** Close on any pointer outside the menu and its own caret. */
function onRowMenuOutsidePointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (rowMenuEl.value?.contains(target)) return;
  if (rowMenuTriggerEl?.contains(target)) return;
  closeRowMenu(false);
}

watch(rowMenuRowId, (id) => {
  if (id) {
    window.addEventListener("pointerdown", onRowMenuOutsidePointerDown, true);
  } else {
    window.removeEventListener("pointerdown", onRowMenuOutsidePointerDown, true);
  }
});

/** Arrow / Escape inside the menu; Enter is the button's own click. */
function onRowMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeRowMenu();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  event.stopPropagation();
  const items = [...(rowMenuEl.value?.querySelectorAll("button") ?? [])];
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const next = (current + delta + items.length) % items.length;
  items[next]?.focus();
}

/** Show a file/folder row in Explorer, selected inside its parent folder. */
async function revealRowInFileManager(
  row: Extract<PaletteRow, { kind: "folder" | "path" }>,
) {
  closeRowMenu(false);
  try {
    await revealInFileManager(row.path);
    afterPaletteAction();
    dismissAfterAction();
  } catch {
    // Keep the overlay open so another result can be tried.
  }
}

/** Open a folder row's path in a new terminal window (cwd = that directory). */
async function openFolderInTerminal(
  row: Extract<PaletteRow, { kind: "folder" | "path" }>,
) {
  if (row.kind === "path" && !row.isDir) return;
  closeRowMenu(false);
  try {
    await invoke("open_in_terminal", { path: row.path });
    afterPaletteAction();
    dismissAfterAction();
  } catch {
    // Keep overlay open so the user can try another result.
  }
}

/** Hide an app from normal search results (still available via Show more). */
function hideAppFromSearch(row: Extract<PaletteRow, { kind: "app" }>) {
  const next = hideApp(hiddenAppKeys.value, row.title, row.path);
  hiddenAppKeys.value = next;
  saveHiddenApps(next);
}

/** Put a previously hidden app back into normal search results. */
function unhideAppFromSearch(row: Extract<PaletteRow, { kind: "app" }>) {
  const next = unhideApp(hiddenAppKeys.value, row.title, row.path);
  hiddenAppKeys.value = next;
  saveHiddenApps(next);
}

/** Reveal hidden apps that match the current query. */
function expandHiddenApps() {
  showHiddenApps.value = true;
}

/** Persist a successful palette run at the front of the MRU list. */
function rememberRecentRun(entry: RecentPaletteRun) {
  const next = recordRecentPaletteRun(recentRuns.value, entry);
  if (next === recentRuns.value) return;
  recentRuns.value = next;
  saveRecentPaletteRuns(next);
}

/** One-time seed from app-launch history so ArrowDown isn’t empty after upgrade. */
function seedRecentFromLaunchHistoryIfEmpty() {
  if (recentRuns.value.length > 0) return;
  const apps = installedAppsIndex.value;
  if (apps.length === 0) return;
  const seeded = recentAppsFromLaunchHistory(appLaunchHistory.value.apps, apps);
  if (seeded.length === 0) return;
  recentRuns.value = seeded;
  saveRecentPaletteRuns(seeded);
}

// The list unmounts while a widget or AI answer holds the panel; re-attach the
// overlay thumb to the new <ul> when returning to search results.
watch([results, resizeListHeight, resizeWidth, enabledSearchActions, widgetShortcuts, showResultsList, inlineWidgetOpen, () => aiAnswer.value !== null], async () => {
  await nextTick();
  syncViewportListHeight();
  if (listEl.value && listOverlayRo) {
    listOverlayRo.observe(listEl.value);
  }
  syncListOverlay();
});

async function scrollSelectedIntoView() {
  await nextTick();
  const list = listEl.value;
  const selectedRow = list?.querySelector(`[data-index="${selectedIndex.value}"]`);
  selectedRow?.scrollIntoView({ block: "nearest" });

  // Section titles are outside the row's box. When the first row of a section
  // becomes active, keep its title in the same viewport as that row.
  if (widgetOverviewSectionTitles.value.has(selectedIndex.value)) {
    list
      ?.querySelector(`[data-section-index="${selectedIndex.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }
  syncListOverlay();
}

/** Sync the overlay thumb to the native list scroll position / overflow. */
function syncListOverlay() {
  const el = listEl.value;
  if (!el) {
    listOverlay.needed = false;
    return;
  }
  // Runs on every results/height change, so it is also where the rendered
  // height gets picked up for the drag handle.
  const rendered = Math.round(el.getBoundingClientRect().height);
  if (rendered > 0) listBoxHeight.value = rendered;
  const sh = el.scrollHeight;
  const ch = el.clientHeight;
  if (sh <= ch + 1) {
    listOverlay.needed = false;
    return;
  }
  const trackPad = 4;
  const track = Math.max(0, ch - trackPad * 2);
  const thumbH = Math.max(24, (ch / sh) * track);
  const maxScroll = sh - ch;
  const maxY = Math.max(0, track - thumbH);
  listOverlay.needed = true;
  listOverlay.thumbH = thumbH;
  listOverlay.thumbY =
    trackPad + (maxScroll > 0 ? (el.scrollTop / maxScroll) * maxY : 0);
}

function moveSelection(delta: number) {
  const count = results.value.length;
  if (count === 0) return;
  // Adding count makes modulo wrap around for negative deltas (ArrowUp at the start).
  selectedIndex.value = (selectedIndex.value + delta + count) % count;
  void scrollSelectedIntoView();
}

/**
 * Dismiss the cockpit session after a launch/search action.
 * Prefer closeCockpit over raw hide() so cockpitOpen stays in sync.
 */
function dismissAfterAction() {
  if (closeCockpit) {
    closeCockpit();
    return;
  }
  void getCurrentWindow().hide();
}

/**
 * Open Google or Windows Search for a parsed prefix match.
 * On failure, leave the window open and keep the query.
 */
async function runPrefixSearch(match: PrefixSearchMatch) {
  try {
    if (match.kind === "google") {
      await invoke("launch_path", { path: buildGoogleSearchUrl(match.term) });
    } else {
      await invoke("open_windows_search", { query: match.term });
    }
    afterPaletteAction();
    dismissAfterAction();
  } catch {
    // Keep overlay visible so the user can edit the query and retry.
  }
}

/** Create a new instance of a type and focus it (always create, even if one is Hidden). */
async function openNewType(typeId: string): Promise<boolean> {
  const instanceId = addWidget?.(typeId, { forceNew: true });
  if (instanceId) {
    await focusWidget?.(instanceId);
    return true;
  }
  return false;
}

/** Create a widget from a direct palette action and advance onboarding on success. */
async function openNewTypeAction(typeId: string) {
  if (await openNewType(typeId)) afterPaletteAction();
}

/** Smart-open a catalog type row (show / focus / create). */
async function runTypeRow(row: PaletteTypeRow, notifyAction = true) {
  let handled = false;
  if (row.smart === "create" || !row.targetInstanceId) {
    handled = await openNewType(row.typeId);
  } else if (focusWidget) {
    await focusWidget(row.targetInstanceId);
    handled = true;
  }
  if (!handled) return;
  rememberRecentRun({ kind: "type", typeId: row.typeId, title: row.title });
  if (notifyAction) afterPaletteAction();
}

/** Hide the type row’s visible target instance. */
function hideTypeTarget(row: PaletteTypeRow) {
  if (!row.canHide || !row.targetInstanceId || !toggleWidget) return;
  toggleWidget(row.targetInstanceId);
  afterPaletteAction();
}

/**
 * Primary action for an instance row: bring the widget forward.
 *
 * Enter used to hide it, which read as a punishment for finding the thing you
 * searched for. `onFocusWidget` reveals a soft-hidden card on its way, so the
 * same call serves both the Open and the Hidden case.
 */
async function focusWidgetRow(row: PaletteWidgetRow) {
  await focusWidget?.(row.instanceId);
  rememberRecentRun({ kind: "type", typeId: row.typeId, title: row.title });
  afterPaletteAction();
}

/** Soft-toggle show/hide for a palette instance row (Ctrl/Cmd+W or H). */
async function toggleWidgetRow(row: PaletteWidgetRow) {
  if (row.snippet || !toggleWidget) return;
  const before = widgetInstances?.find((item) => item.instanceId === row.instanceId);
  const wasHidden = before?.hidden === true;
  toggleWidget(row.instanceId);
  if (wasHidden) {
    await focusWidget?.(row.instanceId);
    rememberRecentRun({ kind: "type", typeId: row.typeId, title: row.title });
  }
  afterPaletteAction();
}

/** Delete an instance from the palette (all desks + dispose its content). */
function removeWidgetRow(row: PaletteWidgetRow) {
  if (row.snippet) return;
  removeWidget?.(row.instanceId, "everywhere");
}

/** Modifier chord label for action hints (Ctrl on Windows, ⌘ on macOS). */
/** Chord as separate keys, so each one gets its own cap. */
function modKeys(letter: string): string[] {
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return [mac ? "⌘" : "Ctrl", letter];
}

/**
 * Label of a catalog row's desk action, which is what Enter does.
 *
 * The row is still in the signature although the answer no longer depends on
 * it: every call site has one to hand, and the label going back to being
 * row-dependent is a likelier change than this staying a constant forever.
 */
function typePrimaryLabel(_row: PaletteTypeRow): string {
  return "Open";
}

/**
 * Title as shown in the list.
 *
 * A create row is titled with the bare type name — except right under its own
 * instances, where the same word twice reads as a third instance. There it says
 * "New Timer", and the verb is what tells the two rows apart.
 */
function rowDisplayTitle(row: PaletteRow): string {
  if (row.kind === "type" && row.attachedToGroup) return `New ${row.title}`;
  return row.title;
}

/** Run the selected command, or open the selected widget inside the palette. */
async function runResultAt(index: number) {
  if (settingsOpen.value) return;

  const row = results.value[index] as PaletteRow | undefined;
  if (!row) return;

  // With chips open the action owns Enter, whatever kind of row carries it.
  // Enter without chips keeps its old meaning (open the widget, run the command).
  const action = paletteRowAction(row);
  if (argMode.value && action) {
    const validated = validateActionArgs(argParams.value, argValues.value);
    if (!validated.ok) {
      // Silent: focus the offending chip instead of shouting at the user.
      focusParamChip(validated.invalidIndex);
      return;
    }
    await runAction(action, validated.args);
    return;
  }

  // A concrete instance is already on a desk, so Enter should bring that card
  // forward instead of creating a second view of it inside the palette.
  if (row.kind === "widget") {
    // Parked on another desk: Enter brings it over rather than focusing a card
    // that is not on screen.
    if (row.offDesk) {
      placeOffDeskRow(row);
      return;
    }
    await focusWidgetRow(row);
    return;
  }

  // A catalog row gives the widget a card: create it, or focus the one that is
  // already there. Enter used to open it inside the palette instead, which made
  // the two row kinds disagree — Enter on an instance row went to the desk, on
  // the catalog row right above it did not. Inline is Ctrl/Cmd+Enter for both.
  if (row.kind === "type") {
    await runTypeRow(row);
    return;
  }

  if (row.kind === "extensionAction") {
    const extensionAction = paletteRowAction(row);
    if (!extensionAction) return;
    // Required chips (Kill Port) open first, same as Set Volume. Optional
    // chips (Confetti intensity) still run on bare Enter with defaults.
    if (extensionAction.params.some((param) => param.required)) {
      enterArgMode();
      return;
    }
    await runAction(extensionAction, {});
    return;
  }

  if (row.kind === "app") {
    try {
      await invoke("launch_path", { path: row.path });
      const next = recordAppLaunch(
        appLaunchHistory.value,
        row.title,
        row.path,
        query.value,
      );
      if (next !== appLaunchHistory.value) {
        appLaunchHistory.value = next;
        saveAppLaunchHistory(next);
      }
      rememberRecentRun({ kind: "app", path: row.path, title: row.title });
      afterPaletteAction();
      dismissAfterAction();
    } catch {
      // Keep overlay open so the user can try another result.
    }
    return;
  }

  if (row.kind === "folder" || row.kind === "path") {
    try {
      await invoke("launch_path", { path: row.path });
      afterPaletteAction();
      dismissAfterAction();
    } catch {
      // Keep overlay open so the user can try another result.
    }
    return;
  }

  // OS command rows below.

  // A command that wants parameters opens its chips first; Enter then runs them.
  if (row.params.length > 0) {
    enterArgMode();
    return;
  }

  // Record after the action is accepted.
  const rememberCommand = () =>
    rememberRecentRun({
      kind: "command",
      commandId: row.commandId,
      title: row.title,
    });

  // Commands whose Rust side already exists (media transport).
  if (row.invokeCommand) {
    try {
      await invoke(row.invokeCommand);
      rememberCommand();
      afterPaletteAction();
      dismissAfterAction();
    } catch {
      // Keep overlay open so the user can try another result.
    }
    return;
  }

  if (row.commandId === "replay-onboarding") {
    rememberCommand();
    replay();
    continueTour();
    void emit("palette:show");
    query.value = "";
    selectedIndex.value = 0;
    return;
  }

  if (row.commandId === "open-settings") {
    rememberCommand();
    openSettings();
    return;
  }

  if (row.commandId === "settings-open-file") {
    rememberCommand();
    try {
      await invoke("settings_file_open");
    } catch {
      // No handler for .json, or the file could not be written — keep the
      // query so the user can pick Reveal Settings Folder instead.
      return;
    }
    afterPaletteAction();
    dismissAfterAction();
    return;
  }

  if (row.commandId === "settings-reveal-folder") {
    rememberCommand();
    try {
      await revealInFileManager(await invoke<string>("settings_file_path"));
    } catch {
      return;
    }
    afterPaletteAction();
    dismissAfterAction();
    return;
  }

  if (row.commandId.startsWith("open-settings-")) {
    rememberCommand();
    openSettingsSection(
      row.commandId.slice("open-settings-".length) as Parameters<typeof showSettingsSection>[0],
    );
    return;
  }

  if (row.commandId === "import-widget") {
    rememberCommand();
    void pickAndImport();
    return;
  }

  if (row.commandId === "open-gallery") {
    rememberCommand();
    openGallery();
    return;
  }

  if (row.commandId === "toggle-dark-mode") {
    rememberCommand();
    toggleColorMode();
    afterPaletteAction();
    return;
  }

  if (row.commandId === "search-google") {
    rememberCommand();
    await runPrefixSearch({
      kind: "google",
      term: resolveStaticSearchTerm(query.value, "google"),
    });
    return;
  }

  if (row.commandId === "search-files") {
    rememberCommand();
    await runPrefixSearch({
      kind: "files",
      term: resolveStaticSearchTerm(query.value, "files"),
    });
    return;
  }

  try {
    // Params-free commands only — parameterized ones ran via runAction above.
    await invoke("execute_action", { actionId: row.commandId, args: {} });
  } catch {
    // Rust rejected it (unsupported platform, unknown id) — keep the query.
    return;
  }
  rememberCommand();
  afterPaletteAction();
  dismissAfterAction();
}

/**
 * Run one extension action: resolve its target instance (visible → hidden →
 * create), then hand off to the extension's handler. Handlers write into the
 * per-instance state cache, so a freshly created widget picks the change up
 * when it mounts — no waiting for a mounted component here.
 */
async function runAction(action: PaletteRowAction, args: ActionArgs) {
  // OS command with parameters (set volume): straight to Rust.
  if (!action.extId) {
    try {
      if (action.invokeCommand) await invoke(action.invokeCommand);
      else await invoke("execute_action", { actionId: action.actionId, args });
    } catch {
      // Rust rejected it — keep the chips so the value can be corrected.
      return;
    }
    rememberRecentRun({ kind: "command", commandId: action.actionId, title: action.actionId });
    exitArgMode();
    afterPaletteAction();
    dismissAfterAction();
    return;
  }

  const extId = action.extId;
  const ext = getExtension(extId);
  let instanceId = "";

  if (action.needsInstance) {
    if (action.instanceId) {
      instanceId = action.instanceId;
      const target = (widgetInstances ?? []).find((item) => item.instanceId === instanceId);
      if (target?.hidden) toggleWidget?.(instanceId);
    } else {
      const target = resolveActionTarget(extId, widgetInstances ?? []);
      if (target.mode === "create") {
        instanceId = addWidget?.(extId) ?? "";
      } else {
        instanceId = target.instanceId ?? "";
        if (target.mode === "reveal" && instanceId) toggleWidget?.(instanceId);
      }
    }
    if (!instanceId) return;
  }

  const ok = await runExtensionAction(ext, action.actionId, { instanceId, args });
  if (!ok) return;
  // Draw the eye to what changed — same courtesy the type rows do on open.
  if (instanceId) await focusWidget?.(instanceId);
  exitArgMode(false);
  afterPaletteAction();
  // No dismiss: the cockpit stays open so the effect is visible — closing it
  // would hide the very widget the action just started.
}

/** Open Settings from palette command or chrome menu. */
function prepareSettingsOpen() {
  paletteMenuOpen.value = false;
  afterPaletteAction();
}

function openSettings() {
  prepareSettingsOpen();
  showSettings();
}

function openSettingsSection(section: Parameters<typeof showSettingsSection>[0]) {
  prepareSettingsOpen();
  showSettingsSection(section);
}

/** Smart-open the Widget Gallery desk widget (create / show / focus). */
async function openGallery() {
  const instances = widgetInstances ?? [];
  const { smart, targetInstanceId } = resolveTypeSmart(GALLERY_WIDGET_ID, instances);
  // Gallery mount notifies onboarding step 2 via the host.
  afterPaletteAction();
  await runTypeRow(
    {
      kind: "type",
      id: `type:${GALLERY_WIDGET_ID}`,
      title: "Widget Gallery",
      subtitle: "",
      keywords: [],
      typeId: GALLERY_WIDGET_ID,
      smart,
      targetInstanceId,
      canHide: smart === "focus",
    },
    false,
  );
}

/** Quit the app from the palette context menu. */
async function onExitApp() {
  paletteMenuOpen.value = false;
  await invoke("app_exit");
}

/** Toggle the palette context menu (Settings / Exit). */
function togglePaletteMenu() {
  paletteMenuAt.value = null;
  paletteMenuOpen.value = !paletteMenuOpen.value;
}

/**
 * Right-click in the palette opens its menu at the cursor, with Settings only.
 * The desk tabs handle their own right-click first.
 */
function onPaletteContextMenu(event: MouseEvent) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const root = paletteRootEl.value?.getBoundingClientRect();
  if (!root) return;
  paletteMenuAt.value = { x: event.clientX - root.left, y: event.clientY - root.top };
  paletteMenuOpen.value = true;
  closeOnboardingMenu();
}

/** Return keyboard focus to the search input from the host's Ctrl+Tab loop. */
/**
 * Host handed keyboard focus back to the search field.
 *
 * `detail.select` comes from Ctrl+Alt+S, which means "search for something" —
 * a leftover query should go on the first keystroke. Ctrl+Tab omits it: cycling
 * back to the palette is navigation, and it must not stage the query for
 * deletion.
 */
function onFocusPaletteEvent(event: Event) {
  const select = (event as CustomEvent<{ select?: boolean }>).detail?.select === true;
  void nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    el.focus();
    if (select) el.select();
  });
}

function onKeydown(event: KeyboardEvent) {
  // Prevent retained palette focus from navigating or running commands.
  if (settingsOpen.value) return;
  // The desk-name field is in this same capture tree; leave keys to it.
  if (renamingDeskId.value) return;
  if (event.isComposing) return;
  if (event.key === "Escape" && aiAnswer.value) {
    event.preventDefault();
    event.stopPropagation();
    closeAiAnswer();
    return;
  }

  const row = results.value[selectedIndex.value];
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (
    showWidgetShortcuts.value && !event.shiftKey && !mod && !event.altKey &&
    (event.key === "Tab" ||
      (event.key === "ArrowRight" && event.target === inputEl.value && query.value.length === 0))
  ) {
    event.preventDefault();
    event.stopPropagation();
    leftSearchViaTab = false;
    widgetShortcutsEl.value?.focusFirst();
    return;
  }

  // A widget fills the panel: the rows behind it are off screen, so every key
  // that acts on the selected row would fire blind. Escape, ArrowLeft and typing
  // still back out of the view; Tab is left to the browser, which walks focus
  // into the widget — where the user is heading anyway.
  if (inlineWidgetOpen.value) {
    if (mod && !event.altKey && key === "w") {
      event.preventDefault();
      event.stopPropagation();
      hidePaletteFromChrome();
      return;
    }
    // The pop-out control is also keyboard-first: move this exact inline
    // instance to the desk (or create it for a scratch preview).
    if (mod && !event.altKey && key === "o") {
      event.preventDefault();
      event.stopPropagation();
      void popOutInlineWidget();
      return;
    }
    const actsOnARow =
      event.key === "ArrowRight" ||
      event.key === "Enter" ||
      // The row chords below. Listed by key rather than "any modifier" so the
      // search field keeps Ctrl+A / Ctrl+V while the widget is up.
      (mod && !event.altKey && ["n", "h", "r", "p", "t"].includes(key));
    if (actsOnARow) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  // Type/widget actions: Enter primary; Ctrl/Cmd+N new; +W/+H hide; +R delete.
  // Never bare letters — they steal keystrokes while typing (e.g. "gra"+"n").
  if (row && (row.kind === "type" || row.kind === "widget") && mod && !event.altKey) {
    if (key === "n") {
      event.preventDefault();
      event.stopPropagation();
      void openNewTypeAction(row.typeId);
      return;
    }
    if (key === "w" || key === "h") {
      if (row.kind === "type" && row.canHide) {
        event.preventDefault();
        event.stopPropagation();
        hideTypeTarget(row);
        return;
      }
      if (row.kind === "widget" && !row.hidden && !row.snippet && !row.offDesk) {
        event.preventDefault();
        event.stopPropagation();
        void toggleWidgetRow(row);
        return;
      }
    }
    if (key === "r" && row.kind === "widget" && !row.snippet && !row.offDesk) {
      event.preventDefault();
      event.stopPropagation();
      removeWidgetRow(row);
      return;
    }
  }

  // Ctrl/Cmd+S inside a folder steps the sort order (the list is the only
  // thing on screen that has one, so the chord is unambiguous there).
  if (folderScopeActive.value && mod && !event.altKey && key === "s") {
    event.preventDefault();
    event.stopPropagation();
    cycleFileSort();
    return;
  }

  // The palette chrome is its own surface: pin with Ctrl/Cmd+P and hide it
  // with Ctrl/Cmd+W when no row-specific action consumed the chord above.
  if (!folderScopeActive.value && mod && !event.altKey) {
    if (key === "p") {
      event.preventDefault();
      event.stopPropagation();
      togglePalettePinned?.();
      return;
    }
    if (key === "w") {
      event.preventDefault();
      event.stopPropagation();
      hidePaletteFromChrome();
      return;
    }
  }

  // Ctrl/Cmd+T on a directory row — same condition the terminal button uses,
  // so the hint never advertises a chord the row cannot run (files have none).
  if (
    row &&
    (row.kind === "folder" || (row.kind === "path" && row.isDir)) &&
    mod &&
    !event.altKey &&
    key === "t"
  ) {
    event.preventDefault();
    event.stopPropagation();
    void openFolderInTerminal(row);
    return;
  }

  // Enum chips keep their suggestions inside the palette: arrows move the
  // active choice and Tab commits it before continuing to the next argument.
  if (argMode.value && enumSuggestions.value.length > 0) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const count = enumSuggestions.value.length;
      enumSuggestionIndex.value = (enumSuggestionIndex.value + direction + count) % count;
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      selectEnumSuggestion(enumSuggestionIndex.value, true);
      return;
    }
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      // Empty search: open last-12 used runs (or move within that list).
      if (
        !folderScopeActive.value &&
        query.value.trim().length === 0 &&
        !recentOpen.value &&
        !widgetsOpen.value
      ) {
        if (resolveRecentRows(recentRuns.value).length === 0) break;
        widgetsOpen.value = false;
        recentOpen.value = true;
        selectedIndex.value = 0;
        void scrollSelectedIntoView();
        break;
      }
      moveSelection(1);
      break;
    case "ArrowUp":
      event.preventDefault();
      // First row of recent list → close back to bare search.
      if (recentOpen.value && query.value.trim().length === 0 && selectedIndex.value === 0) {
        recentOpen.value = false;
        break;
      }
      moveSelection(-1);
      break;
    case "ArrowRight":
      // Like Tab, descend into the selected directory without leaving search.
      if (isBrowsableRow(row)) {
        event.preventDefault();
        event.stopPropagation();
        enterFolderScope(row.path);
      }
      break;
    case "ArrowLeft": {
      // At the start of a folder query, Left walks back one directory level.
      // Else the browser keeps ownership so the caret still moves normally.
      if (folderScopeActive.value) {
        const folderInput = folderScopeInputEl.value;
        if (
          folderInput &&
          event.target === folderInput &&
          folderInput.selectionStart === 0 &&
          folderInput.selectionEnd === 0
        ) {
          event.preventDefault();
          event.stopPropagation();
          leaveFolderScope();
        }
        break;
      }
      // In a browse view or the inline widget, Left at the search start mirrors
      // the header's Back button. A non-zero caret keeps the browser's edit.
      const searchInput = inputEl.value;
      if (
        (widgetsOpen.value || recentOpen.value || inlineWidgetOpen.value) &&
        searchInput &&
        event.target === searchInput &&
        searchInput.selectionStart === 0 &&
        searchInput.selectionEnd === 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeOverview();
        break;
      }
      // Empty search: browse the widgets already open on this desk.
      if (
        query.value.length === 0 &&
        !recentOpen.value &&
        !widgetsOpen.value
      ) {
        event.preventDefault();
        event.stopPropagation();
        widgetsOpen.value = true;
        selectedIndex.value = 0;
        void scrollSelectedIntoView();
      }
      break;
    }
    case "Escape":
      // Chips first: one Escape drops the arguments, a second closes the palette.
      if (argMode.value) {
        event.preventDefault();
        event.stopPropagation();
        exitArgMode();
        break;
      }
      if (actionChipMode.value) {
        event.preventDefault();
        event.stopPropagation();
        exitActionChipMode();
        break;
      }
      // The inline widget is the frontmost thing in the panel, so Escape backs
      // out of it before it can mean "close the palette".
      if (inlineWidgetOpen.value) {
        event.preventDefault();
        event.stopPropagation();
        closeInlineWidget();
        break;
      }
      // One Escape leaves the folder entirely (Shift+Tab is the step-by-step
      // way back), a second closes the palette.
      if (folderScopeActive.value) {
        event.preventDefault();
        event.stopPropagation();
        exitFolderScope();
        break;
      }
      if (recentOpen.value) {
        event.preventDefault();
        event.stopPropagation();
        recentOpen.value = false;
      }
      if (widgetsOpen.value) {
        event.preventDefault();
        event.stopPropagation();
        widgetsOpen.value = false;
      }
      break;
    case "Backspace":
      // Deleting past the start of the first chip returns to the search text.
      if (
        argMode.value &&
        activeParamIndex.value === 0 &&
        (argValues.value[0] ?? "").length === 0
      ) {
        event.preventDefault();
        exitArgMode();
        break;
      }
      // Same gesture one level down: an empty folder chip backs out of the
      // folder instead of deleting from the query behind it.
      if (folderScopeActive.value && folderScopeQuery.value.length === 0) {
        event.preventDefault();
        leaveFolderScope();
      }
      break;
    case "Tab": {
      if (showSearchActions.value && !event.shiftKey && !mod && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        searchActionsEl.value?.focusFirst();
        break;
      }
      if (argMode.value) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          const prev = previousParamIndex(activeParamIndex.value);
          if (prev < 0) exitArgMode();
          else focusParamChip(prev);
        } else {
          focusParamChip(nextParamIndex(activeParamIndex.value, argParams.value.length));
        }
        break;
      }
      // Cycling the action chips, once Tab has committed to them.
      if (actionChipMode.value) {
        event.preventDefault();
        event.stopPropagation();
        const count = rowActions.value.length;
        if (event.shiftKey) {
          // Stepping back off the first chip returns to plain search.
          if (activeActionChipIndex.value === 0) exitActionChipMode();
          else focusActionChip(activeActionChipIndex.value - 1);
        } else {
          focusActionChip((activeActionChipIndex.value + 1) % count);
        }
        break;
      }
      // A folder row hands Tab to its contents; from inside, Tab on a subfolder
      // descends and Shift+Tab climbs back out one level at a time.
      if (!event.shiftKey && isBrowsableRow(row)) {
        event.preventDefault();
        event.stopPropagation();
        enterFolderScope(row.path);
        break;
      }
      if (event.shiftKey && folderScopeActive.value) {
        event.preventDefault();
        event.stopPropagation();
        leaveFolderScope();
        break;
      }
      // Inside a folder with a file selected there is nothing to descend into.
      // Swallow Tab anyway — the browser's default would walk focus out of the
      // chip and quietly end the browse.
      if (folderScopeActive.value) {
        event.preventDefault();
        event.stopPropagation();
        break;
      }
      // A row with a parameterized action takes Tab for its chips; everything
      // else keeps the existing jump-into-widget behavior.
      if (!event.shiftKey && argParams.value.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        enterArgMode();
        break;
      }
      // An instance row offers its own state-dependent actions instead.
      if (!event.shiftKey && rowActions.value.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        enterActionChipMode();
        break;
      }
      // Shift+Tab return-to-search is handled by the document capture listener.
      if (event.shiftKey) break;
      // Jump to the previewed visible widget; keep palette/query open.
      const targetId = previewTargetId(row as PaletteRow | undefined);
      if (!targetId) break;
      event.preventDefault();
      event.stopPropagation();
      suppressPreviewInstanceId = targetId;
      leftSearchViaTab = true;
      previewWidget?.(null);
      // Leave the search field so widget key handlers (Snake, etc.) receive keys.
      inputEl.value?.blur();
      void focusWidget?.(targetId);
      break;
    }
    case "Enter":
      event.preventDefault();
      // Enter is the desk for both row kinds; the chord is the palette-local
      // view of the same widget.
      if (mod && !event.altKey && (row?.kind === "widget" || row?.kind === "type")) {
        event.stopPropagation();
        openInlineWidget(selectedIndex.value);
        break;
      }
      // Ctrl/Cmd+Enter on a filesystem row reveals it instead of opening it.
      if (mod && !event.altKey && (row?.kind === "folder" || row?.kind === "path")) {
        event.stopPropagation();
        void revealRowInFileManager(row);
        break;
      }
      // Action chips own Enter while they are live; the row keeps it otherwise.
      if (actionChipMode.value) {
        event.stopPropagation();
        runActiveActionChip();
        break;
      }
      // While chips are open the query is committed to one row — the g/f prefix
      // interceptor must not hijack Enter. Same inside a folder: the query is
      // the folder's, not a search term.
      if (!argMode.value && !folderScopeActive.value) {
        const prefix = parsePrefixSearch(query.value);
        if (prefix) {
          void runPrefixSearch(prefix);
          break;
        }
      }
      void runResultAt(selectedIndex.value);
      break;
  }
}

/**
 * Status-bar Widgets button: the same inventory that ArrowLeft opens on an
 * empty query. One surface, so the button and the keystroke cannot drift apart.
 */
function toggleWidgetsOverview() {
  if (widgetsOpen.value) {
    closeWidgetOverview();
    return;
  }
  // Whatever else owns the panel gives it up first — a folder listing, chips
  // or an inline widget would otherwise stay on screen under a "Widgets" title.
  if (inlineWidgetOpen.value) closeInlineWidget();
  exitArgMode(false);
  exitActionChipMode();
  exitFolderScope(false);
  closeRowMenu(false);
  recentOpen.value = false;
  query.value = "";
  widgetsOpen.value = true;
  selectedIndex.value = 0;
  inputEl.value?.focus();
  void scrollSelectedIntoView();
}

/**
 * Open the existing Widget Wizard from the palette footer's adjacent plus
 * button. The button is a shortcut to the wizard, not a request for another
 * wizard instance; create one only when this is the first use.
 */
async function openWidgetWizard() {
  const current = resolveActionTarget(WIDGET_WIZARD_ID, widgetInstances ?? []);
  if (current.instanceId) {
    await focusWidget?.(current.instanceId);
    afterPaletteAction();
    return;
  }
  if (await openNewType(WIDGET_WIZARD_ID)) afterPaletteAction();
}

/** Switch desk on single click (debounced so double-click can rename). */
function onDeskTabClick(deskId: string) {
  if (renamingDeskId.value) return;
  if (deskTabClickTimer) clearTimeout(deskTabClickTimer);
  deskTabClickTimer = setTimeout(() => {
    deskTabClickTimer = null;
    if (deskId === kavibayActiveDeskId?.value) return;
    kavibaySwitchDesk?.(deskId);
  }, 220);
}

/** Bind the one visible rename field — a string ref inside `v-for` is an array. */
function bindRenameInput(el: unknown) {
  renameInputEl.value = el instanceof HTMLInputElement ? el : null;
}

/** Leave rename mode and restore click-through / hit regions. */
function endDeskRename() {
  renamingDeskId.value = null;
  renameDraft.value = "";
  renameInputEl.value = null;
  setClickThroughPaused(false);
  scheduleRegionSync();
}

/** Open inline rename on double-click. */
function onDeskTabDblClick(desk: DeskTab) {
  if (deskTabClickTimer) {
    clearTimeout(deskTabClickTimer);
    deskTabClickTimer = null;
  }
  renamingDeskId.value = desk.id;
  renameDraft.value = desk.name;
  // The field replaces a button; pause click-through so the first keystroke
  // and the caret land on the input instead of the desktop behind it.
  setClickThroughPaused(true);
  void nextTick(() => {
    renameInputEl.value?.focus();
    renameInputEl.value?.select();
    scheduleRegionSync();
  });
}

/** Commit desk rename from inline editor (Enter or blur). */
function commitDeskRename() {
  const deskId = renamingDeskId.value;
  if (!deskId) return;
  const trimmed = renameDraft.value.trim();
  const original = kavibayDesks?.value.find((d) => d.id === deskId)?.name ?? "";
  if (trimmed && trimmed !== original) {
    kavibayRenameDesk?.(deskId, trimmed);
  }
  endDeskRename();
}

/** Cancel inline rename and restore the original label (Esc). */
function cancelDeskRename() {
  endDeskRename();
}

/** Create a new desk and switch to it. */
function onAddDesk() {
  const beforeIds = new Set(kavibayDesks?.value.map((d) => d.id) ?? []);
  kavibayAddDesk?.();
  const desks = kavibayDesks?.value ?? [];
  const added = desks.find((d) => !beforeIds.has(d.id)) ?? desks[desks.length - 1];
  if (added) kavibaySwitchDesk?.(added.id);
}

/** Open desk tab context menu (coords relative to palette root). */
function onDeskTabContextMenu(event: MouseEvent, deskId: string) {
  event.preventDefault();
  event.stopPropagation();
  const root = paletteRootEl.value?.getBoundingClientRect();
  if (!root) return;
  deskCtxMenu.value = {
    deskId,
    x: event.clientX - root.left,
    y: event.clientY - root.top,
    confirming: false,
  };
}

/** Dismiss the desk tab context menu. */
function closeDeskCtxMenu() {
  deskCtxMenu.value = null;
}

/** Center the command palette on screen (widgets stay put). */
function onMovePaletteToCenter() {
  const deskId = deskCtxMenu.value?.deskId;
  closeDeskCtxMenu();
  // Apply to the right-clicked desk (switch if needed), then center.
  if (deskId && deskId !== kavibayActiveDeskId?.value) {
    kavibaySwitchDesk?.(deskId);
  }
  kavibayCenterPalette?.();
}

/** First click: show in-menu confirm (window.confirm is unreliable in Tauri overlay). */
function onDeleteDeskFromMenu() {
  if (!deskCtxMenu.value || !canDeleteDesk.value) return;
  deskCtxMenu.value = { ...deskCtxMenu.value, confirming: true };
}

/** Confirmed delete from the in-menu prompt. */
function onConfirmDeleteDesk() {
  const deskId = deskCtxMenu.value?.deskId;
  closeDeskCtxMenu();
  if (!deskId || !canDeleteDesk.value) return;
  kavibayDeleteDesk?.(deskId);
}

/** Keyboard handling for the inline desk rename field. */
function onRenameKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    commitDeskRename();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelDeskRename();
  }
}

/** Start dragging the palette from the top drag strip. */
function onPaletteMovePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  paletteMovePointerdown?.(event);
}

/** Close palette menu / row menu / desk context when pointer lands outside. */
function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  const targetElement = target instanceof Element ? target : null;

  if (inlineMenuOpen.value) {
    const inMenu = Boolean(targetElement?.closest("[data-inline-widget-menu]"));
    const inTrigger = Boolean(inlineMenuTriggerEl.value?.contains(target));
    if (!inMenu && !inTrigger) {
      inlineMenuOpen.value = false;
    }
  }

  if (
    paletteMenuOpen.value &&
    paletteMenuEl.value &&
    !paletteMenuEl.value.contains(target) &&
    !paletteMenuTriggerEl.value?.contains(target)
  ) {
    paletteMenuOpen.value = false;
  }
  if (
    onboardingMenuOpen.value &&
    onboardingMenuEl.value &&
    !onboardingMenuEl.value.contains(target) &&
    onboardingTriggerEl.value &&
    !onboardingTriggerEl.value.contains(target)
  ) {
    onboardingMenuOpen.value = false;
  }
  if (deskCtxMenu.value && deskCtxEl.value && !deskCtxEl.value.contains(target)) {
    deskCtxMenu.value = null;
  }
}

/** Close overlays on Escape before the window-hide handler runs. */
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (inlineMenuOpen.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    inlineMenuOpen.value = false;
    return;
  }
  if (paletteMenuOpen.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    paletteMenuOpen.value = false;
    return;
  }
  if (onboardingMenuOpen.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    onboardingMenuOpen.value = false;
    return;
  }
  if (deskCtxMenu.value !== null) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDeskCtxMenu();
  }
}

/**
 * After Tab left search for a widget, Shift+Tab returns focus to the input.
 * Uses capture so it wins over widget-local Shift+Tab (e.g. todo outdent)
 * only for this round-trip.
 */
function onDocumentShiftTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || !event.shiftKey) return;
  if (!leftSearchViaTab) return;
  if (settingsOpen.value) return;
  // Argument chips own Shift+Tab while they are open — otherwise this capture
  // listener would swallow the step back from chip 2 to chip 1.
  if (argMode.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  leftSearchViaTab = false;
  suppressPreviewInstanceId = null;
  clearWidgetFocus?.();
  syncPreviewFromSelection();
  inputEl.value?.focus();
}

/** Only listen while a palette overlay needs outside dismiss. */
let docListening = false;

/** Attach/detach document listeners when an overlay opens/closes. */
function syncDocListeners() {
  const need =
    paletteMenuOpen.value ||
    onboardingMenuOpen.value ||
    deskCtxMenu.value !== null ||
    inlineMenuOpen.value;
  if (need === docListening) return;
  if (need) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeydown, true);
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeydown, true);
  }
  docListening = need;
}

watch(
  [
    paletteMenuOpen,
    onboardingMenuOpen,
    deskCtxMenu,
    inlineMenuOpen,
    paletteChromeVisible,
    // The row menu sits outside the results panel, so it needs its own
    // click-through region — without this it would be a hole in the overlay.
    rowMenuRowId,
  ],
  async () => {
  syncDocListeners();
  await nextTick();
  scheduleRegionSync();
});

let unlistenShow: UnlistenFn | undefined;

/** Prewarm pinned + habitual app icons once after the index loads. */
async function warmPaletteIcons() {
  const apps = await ensureInstalledAppsIndex();
  prewarmAppIcons(apps, appLaunchHistory.value);
}

onMounted(async () => {
  inputEl.value?.focus();
  refreshSearchAiModel();
  window.addEventListener("kavibay:focus-palette", onFocusPaletteEvent);
  window.addEventListener("resize", syncViewportListHeight);
  document.addEventListener("keydown", onDocumentShiftTab, true);
  listOverlayRo = new ResizeObserver(() => syncListOverlay());
  void nextTick().then(() => {
    if (listEl.value) listOverlayRo?.observe(listEl.value);
    syncViewportListHeight();
    syncListOverlay();
    scheduleRegionSync();
  });
  // Warm apps + well-known folders in the background once.
  void warmPaletteIcons().then(() => seedRecentFromLaunchHistoryIfEmpty());
  void ensureKnownFoldersIndex();
  void homeDir()
    .then((h) => {
      homePath.value = h;
    })
    .catch(() => {
      homePath.value = null;
    });
  unlistenShow = await listen("palette:show", () => {
    refreshSearchAiModel();
    paletteMenuOpen.value = false;
    onboardingMenuOpen.value = false;
    deskCtxMenu.value = null;
    endDeskRename();
    leftSearchViaTab = false;
    clearWidgetFocus?.();
    inputEl.value?.focus();
    // Spotlight-style reopen: keep the last query visible, but make fresh
    // typing replace it without requiring Backspace or a mouse selection.
    inputEl.value?.select();
  });
});

onUnmounted(() => {
  paletteAi.reset();
  window.removeEventListener("kavibay:focus-palette", onFocusPaletteEvent);
  window.removeEventListener("resize", syncViewportListHeight);
  listOverlayRo?.disconnect();
  listOverlayRo = undefined;
  if (deskTabClickTimer) {
    clearTimeout(deskTabClickTimer);
    deskTabClickTimer = null;
  }
  previewWidget?.(null);
  leftSearchViaTab = false;
  clearWidgetFocus?.();
  window.removeEventListener("pointerdown", onRowMenuOutsidePointerDown, true);
  document.removeEventListener("keydown", onDocumentShiftTab, true);
  if (docListening) {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeydown, true);
    docListening = false;
  }
  unlistenShow?.();
});
</script>

<template>
  <div
    ref="paletteRootEl"
    class="palette"
    :class="{ 'palette--drop-target': paletteDropActive }"
    :style="paletteChromePositionStyle"
    data-interactive
    @pointerenter="onPalettePointerMove"
    @pointermove="onPalettePointerMove"
    @pointerleave="paletteHeaderHovered = false"
    @pointerup="onPalettePointerUp"
    @contextmenu="onPaletteContextMenu"
  >
    <!-- Glass layer — keeps backdrop-filter from clipping the drag overhang. -->
    <div class="palette-surface" aria-hidden="true" />
    <ResizeEdges
      v-if="!inlineWidgetOpen"
      :width="resizeWidth"
      :height="resizeHandleHeight"
      :measure-el="showResultsList ? resultsPanelEl : paletteRootEl"
      :clamps="DEFAULT_PALETTE_CLAMPS"
      :edges="RESIZE_EDGES_NO_TOP"
      @resize="onPaletteResize"
      @resize-end="onPaletteResizeEnd"
    />
    <!--
      Always mounted like widget cards: click-through must know the 6px overhang
      before hover. Highlight only while chrome is visible.
    -->
    <div
      class="palette-drag"
      data-interactive
      role="button"
      aria-label="Move palette"
      @pointerdown.stop="onPaletteMovePointerDown"
    />
    <div
      v-if="paletteChromeVisible"
      class="palette-card-chrome"
      data-interactive
      @pointerdown.stop
      @focusin="paletteChromeFocused = true"
      @focusout="paletteChromeFocused = false"
    >
      <button
        type="button"
        class="palette-card-chrome-btn"
        :class="{ 'palette-card-chrome-btn--pin-on': palettePinned }"
        v-tip="shortcutHintVisible ? pinShortcutTip : 'Pin'"
        aria-label="Toggle palette pin"
        :aria-pressed="palettePinned"
        @click.stop="togglePalettePinned?.()"
      >
        <PinIcon :active="palettePinned" />
        <span v-if="shortcutHintVisible" class="palette-shortcut-hint" aria-hidden="true">
          <span>Pin</span>
          <span>{{ shortcutModifier }}+P</span>
        </span>
      </button>
      <button
        ref="paletteMenuTriggerEl"
        type="button"
        class="palette-card-chrome-btn"
        v-tip="'Palette menu'"
        aria-label="Palette menu"
        aria-haspopup="menu"
        :aria-expanded="paletteMenuOpen"
        @click.stop="togglePaletteMenu"
      >
        ⋯
      </button>
      <button
        type="button"
        class="palette-card-chrome-btn"
        v-tip="shortcutHintVisible ? hidePaletteShortcutTip : 'Hide'"
        aria-label="Hide palette"
        @click.stop="hidePaletteFromChrome"
      >
        <span v-if="shortcutHintVisible" class="palette-shortcut-hint" aria-hidden="true">
          <span>Hide</span>
          <span>{{ shortcutModifier }}+W</span>
        </span>
        <svg class="palette-card-chrome-icon" viewBox="0 0 24 24" aria-hidden="true">
          <g>
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
      </button>
    </div>
    <div
      v-if="paletteMenuOpen"
      ref="paletteMenuEl"
      class="palette-context-menu"
      :style="
        paletteMenuAt
          ? { top: `${paletteMenuAt.y}px`, left: `${paletteMenuAt.x}px`, right: 'auto' }
          : undefined
      "
      data-interactive
      role="menu"
      @pointerdown.stop
    >
      <button
        type="button"
        role="menuitem"
        class="palette-context-menu-item"
        @click="openSettings"
      >
        <svg class="palette-context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
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
      <button
        v-if="!paletteMenuAt"
        type="button"
        role="menuitem"
        class="palette-context-menu-item"
        @click="onExitApp"
      >
        <svg class="palette-context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"
          />
        </svg>
        Exit
      </button>
    </div>
    <div
      class="palette-input-row"
      :class="{
        'palette-input-row--enum-open': enumSuggestions.length > 0,
        'palette-input-row--search-actions': showSearchActions || showWidgetShortcuts,
      }"
    >
      <!-- With chips present the input hugs its text (field-sizing), so the
           first chip sits right after what was typed instead of screen-far. -->
      <input
        ref="inputEl"
        v-model="query"
        class="palette-input"
        :class="{
          'palette-input--sized': showChips || showActionChips || Boolean(folderChipEntry),
        }"
        data-onboarding-target="palette-search"
        type="text"
        :placeholder="searchPlaceholder"
        autocomplete="off"
        spellcheck="false"
        @keydown.capture="onKeydown"
      />
      <!-- Shown as a dim hint as soon as a parameterized row is selected; Tab
           (or a click) makes them live. -->
      <template v-for="(param, index) in argParams" :key="param.name">
        <div v-show="showChips" class="palette-arg-control">
          <input
            :ref="(el) => setArgInputEl(el, index)"
            v-model="argValues[index]"
            class="palette-arg-chip"
            :class="{
              'palette-arg-chip--preview': !argMode,
              'palette-arg-chip--active': argMode && index === activeParamIndex,
            }"
            :style="{ minWidth: `${paramPlaceholder(param).length + 2}ch` }"
            type="text"
            :placeholder="paramPlaceholder(param)"
            :aria-label="param.name"
            :readonly="!argMode"
            :tabindex="argMode ? 0 : -1"
            autocomplete="off"
            spellcheck="false"
            @mousedown.prevent="enterArgModeAt(index)"
            @keydown.capture="onKeydown"
          />
          <div
            v-if="
              param.options?.length &&
              argMode &&
              index === activeParamIndex &&
              enumSuggestions.length > 0
            "
            class="palette-enum-menu"
            role="listbox"
            :aria-label="`${param.name} suggestions`"
          >
            <button
              v-for="(option, optionIndex) in enumSuggestions"
              :key="option"
              type="button"
              class="palette-enum-option"
              :class="{ 'palette-enum-option--active': optionIndex === enumSuggestionIndex }"
              role="option"
              :aria-selected="optionIndex === enumSuggestionIndex"
              @mousedown.prevent
              @click="selectEnumSuggestion(optionIndex, true)"
            >
              {{ option }}
            </button>
          </div>
        </div>
      </template>
      <!-- Folder chip: dim while it only names the selected folder row, live
           once Tab entered that folder. Typing in it searches inside. -->
      <input
        v-if="folderChipEntry"
        ref="folderScopeInputEl"
        v-model="folderScopeQuery"
        class="palette-arg-chip palette-folder-chip"
        :class="{
          'palette-arg-chip--preview': !folderScopeActive,
          'palette-arg-chip--active': folderScopeActive,
        }"
        :style="{ minWidth: `${scopePlaceholder(folderChipEntry).length + 2}ch` }"
        type="text"
        :placeholder="scopePlaceholder(folderChipEntry)"
        :aria-label="scopePlaceholder(folderChipEntry)"
        :readonly="!folderScopeActive"
        :tabindex="folderScopeActive ? 0 : -1"
        autocomplete="off"
        spellcheck="false"
        @mousedown.prevent="enterFolderScopeFromChip"
        @keydown.capture="onKeydown"
      />
      <!-- State-dependent extension actions for the selected instance. Dim
           until Tab commits to them, mirroring the argument chips above. -->
      <template v-for="(action, index) in rowActions" :key="action.id">
        <!-- Takes a value: a real field, same behaviour as the argument chips. -->
        <input
          v-if="action.param"
          :ref="(el) => setActionChipInputEl(el, index)"
          v-model="actionChipValues[index]"
          class="palette-action-chip palette-action-chip--input"
          :class="{
            'palette-action-chip--preview': !actionChipMode,
            'palette-action-chip--active':
              actionChipMode && index === activeActionChipIndex,
          }"
          :style="{ minWidth: `${(action.param.placeholder ?? action.title).length + 2}ch` }"
          type="text"
          :placeholder="action.param.placeholder ?? action.title"
          :aria-label="action.title"
          :readonly="!actionChipMode"
          :tabindex="-1"
          autocomplete="off"
          spellcheck="false"
          @mousedown.prevent="enterActionChipMode(index)"
          @keydown.capture="onKeydown"
        />
        <button
          v-else
          type="button"
          class="palette-action-chip"
          :class="{
            'palette-action-chip--preview': !actionChipMode,
            'palette-action-chip--active':
              actionChipMode && index === activeActionChipIndex,
          }"
          :tabindex="-1"
          @mousedown.prevent="enterActionChipMode(index)"
          @click="onActionChipClick(action, index)"
        >
          {{ action.title }}
        </button>
      </template>
      <PaletteSearchActions
        v-if="showSearchActions"
        ref="searchActionsEl"
        :model="searchAiModel"
        :actions="enabledSearchActions"
        @select="runSearchAction"
        @back="focusSearchInput"
      />
      <PaletteWidgetShortcuts
        v-else-if="showWidgetShortcuts"
        ref="widgetShortcutsEl"
        :widgets="widgetShortcuts"
        :active-id="inlineShortcutId"
        @select="openWidgetShortcut"
        @enter="enterWidgetShortcut"
        @back="leaveWidgetShortcuts"
      />
    </div>

    <div class="palette-statusbar">
      <div class="palette-statusbar-left">
        <div v-if="addWidget" class="palette-widgets-group">
          <button
            type="button"
            class="palette-bar-btn palette-bar-btn--widgets"
            data-onboarding-target="widgets-button"
            v-tip:below="widgetsButtonTitle"
            aria-label="Browse widgets"
            :aria-pressed="widgetsOpen"
            @pointerdown.stop
            @click.stop="toggleWidgetsOverview"
          >
          <svg class="palette-bar-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect
              x="3"
              y="3"
              width="7"
              height="7"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
            <rect
              x="14"
              y="3"
              width="7"
              height="7"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
            <rect
              x="3"
              y="14"
              width="7"
              height="7"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
            <!-- Bottom-right: plus instead of a fourth tile. -->
            <path
              d="M17.5 14v7M14 17.5h7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
            <span class="palette-bar-btn-label">Widgets</span>
          </button>
          <button
            type="button"
            class="palette-add-hit-area palette-wizard-add-hit"
            v-tip:below="'Open Widget Wizard'"
            aria-label="Open Widget Wizard"
            @pointerdown.stop
            @click.stop="openWidgetWizard"
          >
            +
          </button>
        </div>
      </div>
      <div
        v-if="kavibayDesks"
        class="palette-statusbar-center"
        :class="{ 'palette-statusbar-center--shortcut-hints': shortcutHintVisible }"
      >
        <div class="palette-desk-tab-group">
          <!--
            Input and button are siblings on purpose. An <input> inside a
            <button> is invalid HTML: the browser refuses the caret, blur
            fires immediately, and the rename never sticks.
          -->
          <template v-for="(desk, deskIndex) in kavibayDesks" :key="desk.id">
            <input
              v-if="renamingDeskId === desk.id"
              :ref="bindRenameInput"
              v-model="renameDraft"
              class="palette-desk-tab palette-desk-rename"
              type="text"
              :size="Math.max(4, renameDraft.length + 1)"
              spellcheck="false"
              aria-label="Desk name"
              @pointerdown.stop
              @click.stop
              @keydown="onRenameKeydown"
              @blur="commitDeskRename"
            />
            <button
              v-else
              type="button"
              class="palette-desk-tab"
              v-tip="shortcutHintVisible ? deskShortcutTip(deskIndex) : undefined"
              :class="{ 'palette-desk-tab--active': desk.id === kavibayActiveDeskId }"
              @pointerdown.stop
              @click.stop="onDeskTabClick(desk.id)"
              @dblclick.stop="onDeskTabDblClick(desk)"
              @contextmenu="onDeskTabContextMenu($event, desk.id)"
            >
              <span class="palette-desk-tab-label">{{ desk.name }}</span>
              <span
                v-if="shortcutHintVisible && deskShortcutLabel(deskIndex)"
                class="palette-desk-shortcut-tip"
                aria-hidden="true"
              >
                <span>{{ deskShortcutLabel(deskIndex) }}</span>
              </span>
            </button>
          </template>
          <button
            type="button"
            class="palette-add-hit-area palette-desk-add-hit"
            v-tip:below="'Add desk'"
            aria-label="Add desk"
            @pointerdown.stop
            @click.stop="onAddDesk"
          >
            +
          </button>
        </div>
      </div>
      <div class="palette-statusbar-right">
        <button
          v-if="onboardingProgress"
          ref="onboardingTriggerEl"
          type="button"
          class="palette-onboarding"
          :class="{ 'palette-onboarding--open': onboardingMenuOpen }"
          v-tip:below="onboardingLabel ?? 'Tour'"
          :aria-label="onboardingLabel ?? 'Tour'"
          aria-haspopup="menu"
          :aria-expanded="onboardingMenuOpen"
          @pointerdown.stop
          @click.stop="toggleOnboardingMenu"
        >
          <svg
            class="palette-onboarding-arc"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <circle
              class="palette-onboarding-arc-track"
              cx="10"
              cy="10"
              r="7"
              fill="none"
              stroke-width="2.5"
            />
            <circle
              class="palette-onboarding-arc-progress"
              cx="10"
              cy="10"
              r="7"
              fill="none"
              stroke-width="2.5"
              stroke-linecap="round"
              :stroke-dasharray="ONBOARDING_ARC_CIRCUMFERENCE"
              :stroke-dashoffset="
                ONBOARDING_ARC_CIRCUMFERENCE * (1 - onboardingProgress.ratio)
              "
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span class="palette-onboarding-label" aria-live="polite">{{
            onboardingLabel
          }}</span>
        </button>
        <div
          v-if="onboardingMenuOpen && onboardingProgress"
          ref="onboardingMenuEl"
          class="palette-onboarding-menu"
          data-interactive
          role="menu"
          @pointerdown.stop
        >
          <button
            type="button"
            role="menuitem"
            class="palette-context-menu-item"
            @click="continueOnboarding"
          >
            Continue
          </button>
          <button
            type="button"
            role="menuitem"
            class="palette-context-menu-item"
            @click="restartOnboarding"
          >
            Restart
          </button>
          <button
            type="button"
            role="menuitem"
            class="palette-context-menu-item"
            @click="quitOnboarding"
          >
            Quit
          </button>
        </div>
      </div>
    </div>

    <!-- Row actions past Open. Anchored to the caret but living outside the
         results panel, which clips its own overflow. -->
    <div
      v-if="rowMenuRow"
      ref="rowMenuEl"
      class="palette-context-menu palette-row-menu"
      :style="{
        top: rowMenuPos.top === null ? undefined : `${rowMenuPos.top}px`,
        bottom: rowMenuPos.bottom === null ? undefined : `${rowMenuPos.bottom}px`,
        right: `${rowMenuPos.right}px`,
      }"
      role="menu"
      data-interactive
      @keydown="onRowMenuKeydown"
    >
      <button
        type="button"
        role="menuitem"
        class="palette-context-menu-item"
        @click="revealRowInFileManager(rowMenuRow)"
      >
        <svg class="palette-context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
        <span>Show in Explorer</span>
        <KbdHint class="palette-row-menu-kbd" :keys="modKeys('enter')" />
      </button>
      <button
        v-if="rowMenuRow.kind === 'folder' || rowMenuRow.isDir"
        type="button"
        role="menuitem"
        class="palette-context-menu-item"
        @click="openFolderInTerminal(rowMenuRow)"
      >
        <svg class="palette-context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 5h16v14H4z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M7 9l3 3-3 3M13 15h4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>Open in terminal</span>
        <KbdHint class="palette-row-menu-kbd" :keys="modKeys('T')" />
      </button>
    </div>

    <!-- Results hang below fixed chrome so center-transform does not lift the input. -->
    <div
      v-if="showResultsList"
      ref="resultsPanelEl"
      class="palette-results"
      :class="{ 'palette-results--inline-menu-open': inlineWidgetOpen && inlineMenuOpen }"
      data-interactive
    >
      <div v-if="calcDisplay !== null" class="palette-calc" aria-live="polite">
        <span class="palette-calc-eq">=</span>
        <span class="palette-calc-value">{{ calcDisplay }}</span>
      </div>
      <!-- Which folder the list belongs to. The chip names only the leaf, and
           after two levels down that stops being enough to place yourself. -->
      <div v-if="folderScopeActive" class="palette-scope-bar">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linejoin="round"
          />
        </svg>
        <span class="palette-scope-path">{{ folderScopePath }}</span>
        <button
          type="button"
          class="palette-scope-exit"
          v-tip="'Change sort order'"
          @click="cycleFileSort"
        >
          <KbdHint :keys="modKeys('S')" />
          <span>{{ fileSortLabel }}</span>
        </button>
        <button
          type="button"
          class="palette-scope-exit"
          v-tip="'Back out of this folder'"
          @click="leaveFolderScope"
        >
          <KbdHint :keys="['Shift', 'tab']" />
          <span>Back</span>
        </button>
      </div>
      <!-- Fixed above the panel body: the empty-query browse views are
           inventories, and the inline widget names itself here. -->
      <div
        v-if="overviewHeaderTitle"
        class="palette-widget-overview-header"
      >
        <button
          type="button"
          class="palette-widget-overview-back"
          :aria-label="overviewBackLabel"
          v-tip="inlineWidgetOpen ? 'Back to results (Alt+Left)' : 'Back to search'"
          @click="closeOverview"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </button>
        <input
          v-if="inlineRenaming"
          ref="inlineTitleInputEl"
          v-model="inlineTitleDraft"
          class="palette-widget-overview-title-input"
          type="text"
          spellcheck="false"
          aria-label="Widget title"
          @keydown="onInlineTitleKeydown"
          @blur="commitInlineRename"
        />
        <span
          v-else
          class="palette-widget-overview-title"
          :class="{ 'palette-widget-overview-title--renameable': inlineWidgetRenameable }"
          v-tip="inlineWidgetRenameable ? 'Double-click to rename' : undefined"
          @dblclick.stop="startInlineRename"
          >{{ overviewHeaderTitle }}</span
        >
        <!-- The widget's own items, rendered by InlineWidgetBody (provide tree). -->
        <button
          v-if="inlineWidgetOpen && inlineWidgetHasMenu"
          ref="inlineMenuTriggerEl"
          type="button"
          class="palette-widget-overview-popout"
          v-tip:below="'Widget menu'"
          :aria-label="`${inlineWidgetTitle} menu`"
          aria-haspopup="menu"
          :aria-expanded="inlineMenuOpen"
          @click="inlineMenuOpen = !inlineMenuOpen"
        >
          ⋯
        </button>
        <!-- Only the inline widget has somewhere to go; the browse views do not. -->
        <button
          v-if="inlineWidgetOpen"
          type="button"
          class="palette-widget-overview-popout"
          :aria-label="`Open ${inlineWidgetTitle} on the desk`"
          v-tip="'Open on the desk (Ctrl+O)'"
          data-icon-motion
          @click="popOutInlineWidget"
        >
          <SquareArrowOutUpRightIcon :size="16" animated />
        </button>
      </div>
      <PaletteAnswerPanel
        v-if="aiAnswer"
        ref="answerPanelEl"
        :answer="aiAnswer"
        :messages="aiMessages"
        :busy="aiBusy"
        :style="{ height: `${renderedListHeight}px` }"
        @back="closeAiAnswer"
        @stop="paletteAi.stop"
        @retry="paletteAi.retry"
        @follow-up="paletteAi.followUp"
        @settings="showSettingsSection('ai')"
      />
      <!-- Inline height is per widget type; only this lower edge can resize it,
           so the search panel never widens or grows upward. -->
      <div
        v-else-if="inlineWidgetOpen"
        class="palette-inline-widget"
        :class="{ 'palette-inline-widget--menu-open': inlineMenuOpen }"
        :style="{ height: `${inlineWidgetHeight}px` }"
        @keydown="onInlineWidgetKeydown"
      >
        <ResizeEdges
          :width="resizeWidth"
          :height="inlineWidgetHeight"
          :measure-el="resultsPanelEl"
          :clamps="DEFAULT_PALETTE_CLAMPS"
          :edges="['s']"
          @resize="onInlineWidgetResize"
        />
        <InlineWidgetBody
          ref="inlineWidgetBodyEl"
          :key="inlineWidgetInstance!.instanceId"
          :instance="inlineWidgetInstance!"
          :def="inlineWidgetDef!"
          :content-scale="inlineWidgetScale"
          :menu-open="inlineMenuOpen"
          :auto-focus="inlineShortcutId === null"
          @update:content-scale="onInlineZoom"
          @update:menu-open="inlineMenuOpen = $event"
        />
      </div>
      <!-- Reserve room for seven standard results; the drag handle persists a
           different height per desk when the user resizes this panel. -->
      <div
        v-else-if="calcDisplay === null"
        ref="listShellEl"
        class="palette-list-shell"
        :style="{ height: `${renderedListHeight}px` }"
      >
      <ul
        ref="listEl"
        class="palette-list"
        @scroll="syncListOverlay"
      >
        <template
          v-for="(row, index) in results"
          :key="row.id"
        >
        <li
          v-if="widgetOverviewSectionTitles.get(index)"
          class="palette-section-heading"
          :data-section-index="index"
          role="presentation"
        >{{ widgetOverviewSectionTitles.get(index) }}</li>
        <li
          :data-index="index"
          class="palette-item"
          :class="{
            'palette-item--selected': index === selectedIndex,
            'palette-item--note-finding': row.kind === 'widget' && Boolean(row.snippet),
            'palette-item--type': row.kind === 'type',
            'palette-item--create-attached': row.kind === 'type' && row.attachedToGroup === true,
          }"
          :data-icon-motion="index === selectedIndex ? 'on' : null"
          @mouseenter="selectedIndex = index"
          @click="runResultAt(index)"
        >
          <!-- App rows: shell icon. Folder rows: folder mark. Widget rows: extension mark. -->
          <span
            v-if="row.kind === 'app'"
            class="palette-item-icon"
            aria-hidden="true"
          >
            <img
              v-if="installedAppIcons[row.path]"
              :src="installedAppIcons[row.path]"
              alt=""
            />
          </span>
          <span
            v-else-if="row.kind === 'folder' || row.kind === 'path'"
            class="palette-item-icon"
            :class="{ 'palette-item-icon--folder': !rowFileTypeIcon(row) }"
            aria-hidden="true"
          >
            <!-- The shell's own icon for this file type, once it has arrived;
                 until then (and on non-Windows) the drawn mark below stands in. -->
            <img v-if="rowFileTypeIcon(row)" :src="rowFileTypeIcon(row)!" alt="" />
            <svg
              v-else-if="row.kind === 'folder' || row.isDir"
              viewBox="0 0 24 24"
              width="18"
              height="18"
            >
              <path
                d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linejoin="round"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M8 3h6l4 4v14H8V3z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linejoin="round"
              />
              <path
                d="M14 3v4h4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <!-- Create row under its own instances: a plus, not the extension
               mark — the icon is what made it read as another instance. -->
          <span
            v-else-if="row.kind === 'type' && row.attachedToGroup"
            class="palette-item-icon palette-item-icon--create"
            aria-hidden="true"
          >
            <svg viewBox="0 0 20 20" width="14" height="14">
              <path
                d="M10 4v12M4 10h12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span
            v-else-if="row.kind === 'type' || row.kind === 'widget' || row.kind === 'extensionAction'"
            class="palette-item-icon palette-item-icon--widget"
            aria-hidden="true"
          >
            <!-- First-party extensions can ship a real component (animatable);
                 everything else keeps the masked icon.svg. -->
            <component
              :is="extensionIconComponent(resultExtensionId(row) ?? '')"
              v-if="resultExtensionId(row) && extensionIconComponent(resultExtensionId(row) ?? '')"
              class="palette-ext-icon-svg"
              :size="16"
              animated
            />
            <span
              v-else-if="extensionIconUrl(row)"
              class="palette-ext-icon"
              :style="{ '--ext-icon': `url(${JSON.stringify(extensionIconUrl(row))})` }"
            />
            <svg v-else viewBox="0 0 20 20" width="18" height="18">
              <rect
                x="3"
                y="3"
                width="14"
                height="14"
                rx="3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              />
              <path
                d="M7 8h6M7 12h4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <div class="palette-item-main">
            <span class="palette-item-title-line">
              <span class="palette-item-title">{{ rowDisplayTitle(row) }}</span>
              <span
                v-if="row.kind === 'widget'"
                class="palette-item-widget-status"
                :class="row.hidden ? 'palette-item-widget-status--hidden' : 'palette-item-widget-status--open'"
              >{{ row.hidden ? "Hidden" : "Open" }}</span>
              <span
                v-if="row.kind === 'widget' && kavibayDesks && kavibayDesks.length > 1 && row.onDesks"
                class="palette-item-widget-desk"
              >{{ row.onDesks }}</span>
            </span>
            <span v-if="row.kind === 'folder'" class="palette-item-kind">Folder</span>
            <!-- Size, then where it sits. The folder mark replaces a separator
                 dot: it says "folder" instead of only saying "and". -->
            <span
              v-else-if="row.kind === 'path' && (row.subtitle || row.parentLabel)"
              class="palette-item-desks palette-item-fileline"
            >
              <span v-if="row.subtitle">{{ row.subtitle }}</span>
              <span v-if="row.parentLabel" class="palette-item-in-folder">
                <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                  <path
                    d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                  />
                </svg>
                {{ row.parentLabel }}
              </span>
            </span>
            <!-- The attached create row skips the kind line: one line instead of
                 two is what separates it from the instances above it. -->
            <!--
              An extension that declares an action says what its row does; the
              rest say what kind of thing it is. "WIDGET" under every row is a
              category the icon and the Open button already give away, and it
              was spending the one descriptive line a row has on it.

              Not uppercased in that case: the label is a category word, the
              subtitle is a sentence, and small caps with letter-spacing across
              a sentence is a header treatment applied to prose.
            -->
            <span
              v-else-if="row.kind === 'type' && !row.attachedToGroup"
              class="palette-item-kind"
              :class="{ 'palette-item-kind--said': Boolean(row.action?.subtitle) }"
              >{{ row.action?.subtitle || "Widget" }}</span
            >
            <span
              v-if="row.kind === 'widget' && row.snippet"
              class="palette-item-snippet"
              >{{ row.snippet }}</span
            >
            <span
              v-else-if="row.kind === 'widget' && row.notePreview"
              class="palette-item-note-preview"
              >{{ row.notePreview }}</span
            >
            <span
              v-if="row.kind === 'widget' && inlineViews.get(row.instanceId)?.placement === 'detail'"
              class="palette-item-inline-detail"
              >{{ inlineViews.get(row.instanceId)?.value }}<template v-if="inlineViews.get(row.instanceId)?.label"> · {{ inlineViews.get(row.instanceId)?.label }}</template></span
            >
          </div>
          <!-- Extension-provided glance. Reading the extension's reactive state
               happens in this render pass, so a running countdown ticks here. -->
          <div
            v-if="row.kind === 'widget' && inlineViews.get(row.instanceId) && inlineViews.get(row.instanceId)?.placement !== 'detail'"
            class="palette-item-inline"
          >
            <span
              v-if="inlineViews.get(row.instanceId)?.value"
              class="palette-item-inline-value"
              :class="`palette-item-inline-value--${inlineViews.get(row.instanceId)?.tone ?? 'neutral'}`"
              >{{ inlineViews.get(row.instanceId)?.value }}</span
            >
            <span v-if="inlineViews.get(row.instanceId)?.label" class="palette-item-inline-label">{{
              inlineViews.get(row.instanceId)?.label
            }}</span>
          </div>
          <!-- Whatever the list is sorted by, on the row itself. Outside the
               action chain below so it renders alongside the buttons. -->
          <span v-if="rowMetaLabel(row)" class="palette-item-meta">{{
            rowMetaLabel(row)
          }}</span>
          <div
            v-if="row.kind === 'app'"
            class="palette-item-actions"
            @click.stop
            @pointerdown.stop
          >
            <button
              type="button"
              class="palette-item-action"
              @click="runResultAt(index)"
            >
              <KbdHint :keys="['enter']" />
              <span>Open</span>
            </button>
            <button
              v-if="row.fromHiddenSearch"
              type="button"
              class="palette-item-action"
              v-tip="'Show in search'"
              @click="unhideAppFromSearch(row)"
            >
              <span>Show</span>
            </button>
            <button
              v-else
              type="button"
              class="palette-item-action"
              v-tip="'Hide from search'"
              @click="hideAppFromSearch(row)"
            >
              <span>Hide</span>
            </button>
          </div>
          <div
            v-else-if="row.kind === 'folder' || row.kind === 'path'"
            class="palette-item-actions"
            @click.stop
            @pointerdown.stop
          >
            <button
              type="button"
              class="palette-item-action"
              @click="runResultAt(index)"
            >
              <KbdHint :keys="['enter']" />
              <span>Open</span>
            </button>
            <!-- Everything past Open lives behind the caret: the row is a list
                 entry, not a toolbar, and the labels were eating it. -->
            <button
              type="button"
              class="palette-item-action palette-item-caret"
              :aria-expanded="rowMenuRowId === row.id"
              aria-haspopup="menu"
              aria-label="More actions"
              v-tip="'More actions'"
              @click="toggleRowMenu(row, $event)"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <!-- Tab or Right Arrow enters a folder without leaving the palette. -->
            <button
              v-if="row.kind === 'folder' || row.isDir"
              type="button"
              class="palette-item-action"
              v-tip="'Search inside this folder (Tab or Right Arrow)'"
              @click="enterFolderScope(row.path)"
            >
              <KbdHint :keys="['tab']" />
              <span>Browse</span>
            </button>
          </div>
          <div
            v-else-if="row.kind === 'type'"
            class="palette-item-actions"
            @click.stop
            @pointerdown.stop
          >
            <button
              type="button"
              class="palette-item-action"
              v-tip="
                row.smart !== 'create' && row.targetInstanceId
                  ? 'Jump to its card'
                  : 'Give it a card on the desk'
              "
              @click="runTypeRow(row)"
            >
              <KbdHint :keys="['enter']" />
              <span>{{
                row.smart !== "create" && row.targetInstanceId ? "Focus" : typePrimaryLabel(row)
              }}</span>
            </button>
            <button
              type="button"
              class="palette-item-action"
              v-tip="'Open inside the palette'"
              @click="openInlineWidget(index)"
            >
              <KbdHint :keys="modKeys('enter')" />
              <span>Inline</span>
            </button>
            <button
              v-if="row.canHide"
              type="button"
              class="palette-item-action"
              @click="hideTypeTarget(row)"
            >
              <KbdHint :keys="modKeys('W')" />
              <span>Hide</span>
            </button>
            <!-- Ctrl/Cmd+N New when an instance already exists; bare Enter creates when none. -->
            <button
              v-if="row.smart !== 'create'"
              type="button"
              class="palette-item-action"
              @click="openNewTypeAction(row.typeId)"
            >
              <KbdHint :keys="modKeys('N')" />
              <span>New</span>
            </button>
          </div>
          <div
            v-else-if="row.kind === 'widget' && !row.snippet"
            class="palette-item-actions"
            @click.stop
            @pointerdown.stop
          >
            <button
              type="button"
              class="palette-item-action"
              v-tip="row.hidden ? 'Put its card back on the desk' : 'Jump to its card'"
              @click="focusWidgetRow(row)"
            >
              <KbdHint :keys="['enter']" />
              <span>{{ row.hidden ? "Show" : "Focus" }}</span>
            </button>
            <button
              type="button"
              class="palette-item-action"
              v-tip="'Open inside the palette'"
              @click="openInlineWidget(index)"
            >
              <KbdHint :keys="modKeys('enter')" />
              <span>Inline</span>
            </button>
            <!-- Hidden rows have nothing to hide; Enter already reveals them. -->
            <button
              v-if="!row.hidden"
              type="button"
              class="palette-item-action"
              @click="toggleWidgetRow(row)"
            >
              <KbdHint :keys="modKeys('W')" />
              <span>Hide</span>
            </button>
            <button
              type="button"
              class="palette-item-action palette-item-action--danger"
              @click="removeWidgetRow(row)"
            >
              <KbdHint :keys="modKeys('R')" />
              <span>Delete</span>
            </button>
          </div>
          <!-- Parameterized commands advertise Tab; nobody discovers it otherwise. -->
          <div
            v-else-if="
              (row.kind === 'command' || row.kind === 'extensionAction') && row.params.length > 0
            "
            class="palette-item-actions"
            @click.stop
            @pointerdown.stop
          >
            <button
              type="button"
              class="palette-item-action"
              v-tip="'Enter arguments'"
              @click="enterArgModeFor(index)"
            >
              <KbdHint :keys="['tab']" />
              <span>Arguments</span>
            </button>
          </div>
          <span
            v-else-if="row.subtitle"
            class="palette-item-subtitle"
            >{{
              row.kind === "widget" && row.snippet ? "Open note" : row.subtitle
            }}</span
          >
        </li>
        </template>
        <li
          v-if="
            results.length === 0 &&
            (folderScopeActive || (query.trim().length > 0 && hiddenAppMatchCount === 0))
          "
          class="palette-empty"
        >
          <span v-if="searchActionError" role="alert">{{ searchActionError }}</span>
          <template v-else>{{ folderScopeActive ? folderScopeEmptyLabel : "No matches" }}</template>
        </li>
        <li
          v-if="scopedSearchHasOtherResults"
          class="palette-show-more"
        >
          <button
            type="button"
            class="palette-show-more-btn"
            @click="showAllSearchResults"
          >
            Show all results
          </button>
        </li>
        <!-- Hidden apps answer the query behind the folder, not the folder. -->
        <li
          v-if="hiddenAppMatchCount > 0 && !showHiddenApps && !folderScopeActive"
          class="palette-show-more"
        >
          <button
            type="button"
            class="palette-show-more-btn"
            @click="expandHiddenApps"
          >
            Show hidden ({{ hiddenAppMatchCount }})
          </button>
        </li>
      </ul>
      <div
        v-show="listOverlay.needed"
        class="palette-list-overlay-scroll"
        aria-hidden="true"
      >
        <div
          class="palette-list-overlay-thumb"
          :style="{
            height: `${listOverlay.thumbH}px`,
            transform: `translateY(${listOverlay.thumbY}px)`,
          }"
        />
      </div>
      </div>
    </div>

    <div
      v-if="deskCtxMenu"
      ref="deskCtxEl"
      class="palette-desk-ctx"
      data-interactive
      :style="{ left: `${deskCtxMenu.x}px`, top: `${deskCtxMenu.y}px` }"
      @pointerdown.stop
    >
      <template v-if="deskCtxMenu.confirming">
        <p class="palette-desk-ctx-msg">
          Widgets that live only here will be deleted.
        </p>
        <button type="button" class="palette-desk-ctx-item" @click="closeDeskCtxMenu">
          Cancel
        </button>
        <button
          type="button"
          class="palette-desk-ctx-item palette-desk-ctx-item--danger"
          @click="onConfirmDeleteDesk"
        >
          Delete Desk
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="palette-desk-ctx-item"
          @click="onMovePaletteToCenter"
        >
          Move to Center
        </button>
        <button
          v-if="canDeleteDesk"
          type="button"
          class="palette-desk-ctx-item palette-desk-ctx-item--danger"
          @click="onDeleteDeskFromMenu"
        >
          Delete Desk
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.palette {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  overflow: visible;
}

/* A card is being dragged over us and will land in the panel on release. The
   ring is on the root, not the surface layer, so it also frames the results. */
.palette--drop-target::after {
  content: "";
  position: absolute;
  inset: -4px;
  z-index: 6;
  pointer-events: none;
  border: 2px solid rgba(120, 180, 255, 0.75);
  border-radius: calc(var(--surface-radius, 16px) + 4px);
  corner-shape: var(--surface-corner-shape, round);
  box-shadow: 0 0 0 6px rgba(120, 180, 255, 0.14);
}

.palette-surface {
  position: absolute;
  inset: 0;
  z-index: -1;
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

/* 12px strip (6px outside + 6px inside) — invisible hit target, grab cursor only. */
.palette-drag {
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  z-index: 3;
  height: 12px;
  border-radius: var(--surface-radius, 16px) var(--surface-radius, 16px) 0 0;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  cursor: grab;
  touch-action: none;
}

.palette-drag:active {
  cursor: grabbing;
}

/* Outside controls, with an 8px hover bridge included in the interactive rect. */
.palette-card-chrome {
  position: absolute;
  top: var(--card-chrome-top, -40px);
  right: 0;
  z-index: 3;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 10px;
  border-radius: 999px;
}

.palette-card-chrome::before {
  content: "";
  position: absolute;
  inset: 0 0 8px;
  z-index: -1;
  border-radius: inherit;
  background: rgba(var(--surface-bg-rgb), 0.85);
}

/* Same control as .palette-bar-btn, so same shape — leaving these square while
   the bar went round would just move the inconsistency to the other corner. */
.palette-card-chrome-btn {
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Keyboard chord hint shown above the palette's pin/hide controls. */
.palette-shortcut-hint {
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

/* The shared hover/focus tooltip owns the label when the pointer is already
   on the control; this prevents a duplicate bubble during the Ctrl hold. */
.palette-card-chrome-btn:hover .palette-shortcut-hint,
.palette-card-chrome-btn:focus-visible .palette-shortcut-hint {
  display: none;
}

.palette-card-chrome-icon {
  display: block;
  width: 12px;
  height: 12px;
}

.palette-card-chrome-btn:hover {
  background: var(--fill);
  color: var(--text);
}

.palette-card-chrome-btn--pin-on {
  color: rgba(var(--fg-rgb), 0.85);
}

.palette-context-menu {
  position: absolute;
  top: calc(var(--card-chrome-top, -40px) + 44px);
  right: 0;
  z-index: 20;
  min-width: 140px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 12px 32px rgba(var(--shadow-rgb), calc(0.45 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Anchored per row, so top/right come from the caret instead of the chrome. */
.palette-row-menu {
  top: auto;
  right: auto;
  min-width: 168px;
  z-index: 25;
}

/*
 * The chord here rather than on the row: a menu is where you go to find out
 * what is possible, so it is the one place the hint pays for its width.
 */
.palette-row-menu-kbd {
  margin-left: auto;
  padding-left: 12px;
  opacity: 0.75;
}

.palette-context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.palette-context-menu-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.palette-context-menu-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Carries the chrome the input used to own, so argument chips can sit next to
   the query on the same baseline. */
.palette-input-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0 20px;
  box-shadow: rgba(0, 0, 0, 0.02) 1px 1px 3px 1px inset;
  border-bottom: 1px solid var(--border);
  border-radius: var(--surface-radius, 16px) var(--surface-radius, 16px) 0 0;
  corner-shape: var(--surface-corner-shape, round);
}

/* Search actions can wrap while keeping the query field usable. */
.palette-input-row--search-actions { flex-wrap: wrap; row-gap: 0; }

/* `font-family: inherit` is not optional here: form controls default to the UA
   font (Arial on Windows), so without it the query renders in a different
   typeface than the argument chips sitting next to it — and Arial's lopsided
   ascent/descent left the placeholder ~1px above the row's center. */
.palette-input {
  flex: 1 1 auto;
  min-width: 0;
  
  padding: 24px 0;
  border: none;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 15px;
  font-family: inherit;
  outline: none;
}

.palette-input::placeholder {
  color: var(--text-faint);
}

/* Keep a usable query field when many search actions wrap onto another line. */
.palette-input-row--search-actions .palette-input { flex: 1 1 140px; }

/* Only while chips are on screen: hug the typed text so the first chip sits
   next to it. Alone, the input keeps filling the bar (bigger click target). */
.palette-input--sized {
  flex: 0 1 auto;
  min-width: 2ch;
  max-width: 100%;
  field-sizing: content;
}

.palette-arg-chip {
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 15px;
  font-family: inherit;
  outline: none;
  field-sizing: content;
}

/* Raise this otherwise ordinary input row only while an enum menu is open.
   Keeping it below the card chrome at rest leaves Pin and ⋯ clickable. */
.palette-input-row--enum-open {
  z-index: 7;
}

.palette-arg-control {
  position: relative;
  flex: 0 0 auto;
}

/* Deliberately not a native select/datalist: those controls escape the
   palette's surface and use the operating-system menu styling. */
.palette-enum-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  display: grid;
  min-width: max(100%, 190px);
  max-width: min(280px, calc(100vw - 32px));
  padding: 4px;
  overflow: hidden;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  box-shadow: 0 12px 28px rgba(var(--shadow-rgb), calc(0.3 * var(--shadow-scale, 1)));
}

.palette-enum-option {
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.82);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.palette-enum-option:hover,
.palette-enum-option--active {
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.98);
}

.palette-arg-chip::placeholder {
  color: rgba(var(--fg-rgb), 0.45);
}

/* Hint state: readable, but clearly not where the caret is. */
.palette-arg-chip--preview {
  opacity: 0.55;
  cursor: pointer;
}

.palette-arg-chip--active {
  border-color: rgba(var(--fg-rgb), 0.25);
  background: rgba(var(--fg-rgb), 0.13);
}

/* Folder chip: same chip language, one step brighter than an argument chip —
   while it is live the list below stops answering the query behind it. */
.palette-folder-chip.palette-arg-chip--active {
  border-color: rgba(var(--fg-rgb), 0.4);
  background: rgba(var(--fg-rgb), 0.18);
}

/* Sort value on the row (date or size). Tabular figures so the column reads as
   a column even though every row has a different number in it. */
.palette-item-meta {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 10px;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Breadcrumb strip above the folder's contents. */
.palette-scope-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.62);
  font-size: 12px;
}

.palette-scope-path {
  flex: 1 1 auto;
  overflow: hidden;
  /* Deep paths lose their head, not their tail: the folder you are in is the
     end of the string and the part worth reading. */
  direction: rtl;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-scope-exit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.palette-scope-exit:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
}

/* Same chip language as the argument chips; a button, not a text field. */
.palette-action-chip {
  flex: 0 0 auto;
  margin: 0;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 15px;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  outline: none;
}

/* Input variant: no field chrome of its own, the chip already is the frame. */
.palette-action-chip--input {
  field-sizing: content;
}

.palette-action-chip--input::placeholder {
  color: rgba(var(--fg-rgb), 0.45);
}

.palette-action-chip--preview {
  opacity: 0.55;
}

.palette-action-chip--preview:hover {
  opacity: 0.8;
}

/* Live and highlighted: this is what Enter runs. */
.palette-action-chip--active {
  border-color: rgba(120, 180, 255, 0.55);
  background: rgba(80, 140, 255, 0.16);
}

/* Dropdown below the chrome — out of flow so the centered shell stays put. */
.palette-results {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  background:
    var(--surface-sheen, linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0))),
    rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72));
  border: 1px solid var(--surface-border, var(--border));
  box-shadow: var(--surface-box-shadow), var(--surface-inner-highlight, 0 0 transparent);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  overflow: hidden;
}

/* Let an inline widget's settings popover escape the fixed results frame. */
.palette-results--inline-menu-open {
  overflow: visible;
}

/* Host for overlay thumb — list stays full width; bar paints on top of rows. */
.palette-list-shell {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}

.palette-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  /* Hide native bar; custom overlay thumb is used instead. */
  scrollbar-width: none;
}

.palette-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.palette-widget-overview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 42px;
  /* Align the back glyph's center with the 20px icon column in list rows. */
  padding: 0 12px 0 15px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.82);
  font-size: 13px;
  font-weight: 600;
}

/* A widget title can be anything the user renamed it to — one line, clipped.
   It hugs its text so a tooltip anchors over the words instead of over an
   invisible full-width box; the auto margin still pushes the pop-out to the edge. */
.palette-widget-overview-title {
  flex: 0 1 auto;
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Only a renameable title advertises the edit; a type name is not editable. */
.palette-widget-overview-title--renameable {
  cursor: text;
}

/* Sits in the title's place without moving the row: same metrics, no chrome. */
.palette-widget-overview-title-input {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 2px 6px;
  border: 1px solid rgba(var(--fg-rgb), 0.25);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.95);
  font: inherit;
}

.palette-widget-overview-title-input:focus {
  outline: none;
  border-color: rgba(120, 180, 255, 0.55);
}

/* Mirrors the Back control on the opposite edge: same box, same hover. */
.palette-widget-overview-popout {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
  cursor: pointer;
}

.palette-widget-overview-popout:hover,
.palette-widget-overview-popout:focus-visible {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.95);
  outline: none;
}

/* The inline frame only clips. Widgets that genuinely need a list own the one
   scroll surface themselves; letting this frame scroll too creates twin rails. */
.palette-inline-widget {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
}

.palette-inline-widget--menu-open {
  overflow: visible;
}

.palette-widget-overview-back {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.palette-widget-overview-back:hover,
.palette-widget-overview-back:focus-visible {
  background: rgba(var(--fg-rgb), 0.1);
  outline: none;
}

/* Full-bleed bar so these read as section labels, not extra list rows.
   Negative X-margin cancels .palette-list's 8px padding; 20px X-padding
   keeps the label aligned with the row icon column (list 8px + item 12px).
   The first heading keeps the list's 8px top inset under the Widgets chrome;
   later headings add a section-break above and sit a bit closer to their rows. */
.palette-section-heading {
  list-style: none;
  margin: 0 -8px 6px;
  padding: 11px 20px 7px;
  background: var(--fill);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.palette-section-heading:not(:first-child) {
  margin-top: 8px;
}

.palette-list-overlay-scroll {
  position: absolute;
  top: 0;
  right: 6px;
  bottom: 0;
  z-index: 2;
  width: 8px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.palette-list-shell:hover .palette-list-overlay-scroll {
  opacity: 1;
}

.palette-list-overlay-thumb {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.22);
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 30px;
  corner-shape: var(--surface-corner-shape, round);
  cursor: pointer;
}

/* WebKit draws circular corners, so the squircle radius would make rows pill-shaped. */
@supports not (corner-shape: squircle) {
  .palette-item {
    border-radius: 10px;
  }
}

.palette-item--selected {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

/* Fixed slot so missing icons keep title alignment (no letter fallback). */
.palette-item-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
}

.palette-item-icon img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 4px;
}

.palette-item-icon--widget,
.palette-item-icon--folder {
  color: rgba(var(--fg-rgb), 0.72);
  background: rgba(var(--fg-rgb), 0.08);
  border-radius: 6px;
}

/* Inline component icons already stroke in currentColor; they only need to
   match the masked variant's box so the two never shift the row. */
.palette-ext-icon-svg {
  display: block;
  width: 16px;
  height: 16px;
}

/* Extension icon via CSS mask so mono SVGs pick up currentColor. */
.palette-ext-icon {
  display: block;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--ext-icon) center / contain no-repeat;
  mask: var(--ext-icon) center / contain no-repeat;
}

.palette-ext-icon--fallback {
  display: grid;
  place-items: center;
  background: transparent;
  -webkit-mask: none;
  mask: none;
  color: rgba(var(--fg-rgb), 0.55);
}

.palette-item--type .palette-item-title {
  font-weight: 600;
  letter-spacing: 0.01em;
}

/*
 * The create row under existing instances is an action, not another widget.
 * Shorter, indented, unbolded and un-tiled so the eye groups it with the rows
 * above instead of counting it as one of them.
 */
/*
 * 36px puts the plus's left stroke on the 42px title column of the instance
 * rows above (36 + 3px slot inset + 2.8px viewBox inset). Tighter gap than the
 * row default: plus and label are one unit, not icon + separate content.
 */
.palette-item--create-attached {
  padding-top: 5px;
  padding-bottom: 5px;
  padding-left: 36px;
  gap: 5px;
}

.palette-item--create-attached .palette-item-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.55);
}

.palette-item--create-attached:hover .palette-item-title,
.palette-item--create-attached.palette-item--selected .palette-item-title {
  color: rgba(var(--fg-rgb), 0.9);
}

.palette-item-icon--create {
  color: rgba(var(--fg-rgb), 0.42);
}

.palette-item--create-attached:hover .palette-item-icon--create,
.palette-item--create-attached.palette-item--selected .palette-item-icon--create {
  color: rgba(var(--fg-rgb), 0.8);
}

.palette-item-kind {
  font-size: 11px;
  line-height: 1.2;
  color: rgba(var(--fg-rgb), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* A sentence, so it is set as one — and it can be longer than the row. */
.palette-item-kind--said {
  text-transform: none;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.palette-item-title {
  font-size: 14px;
  color: rgba(var(--fg-rgb), 0.95);
}

.palette-item-title-line {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.palette-item-widget-status {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.62);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1.2;
  text-transform: uppercase;
}

.palette-item-widget-status--hidden {
  opacity: 0.58;
}

.palette-item-widget-desk {
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 11px;
  line-height: 1.2;
}

.palette-item-desks {
  font-size: 11px;
  line-height: 1.2;
  color: rgba(var(--fg-rgb), 0.45);
}

/* Size and location on one line; the gap does the separating. */
.palette-item-fileline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.palette-item-in-folder {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The glyph is a label, not an illustration — dimmer than the name it marks. */
.palette-item-in-folder svg {
  flex-shrink: 0;
  opacity: 0.75;
}

.palette-item-snippet,
.palette-item-note-preview,
.palette-item-inline-detail {
  font-size: 12px;
  line-height: 1.35;
  color: rgba(var(--fg-rgb), 0.62);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Secondary widget summaries read like content, not a live status signal. */
.palette-item-inline-detail {
  color: rgba(var(--fg-rgb), 0.48);
}

.palette-item--note-finding .palette-item-snippet {
  color: rgba(165, 243, 252, 0.85);
}

/*
 * Only the selected row shows its actions — the shortcuts act on the selection,
 * so repeating them down the list states them for rows they do not apply to.
 * Hover selects, so a mouse reveals the same buttons it is about to click.
 *
 * Hidden rather than removed: the glance column ("09:52 Paused") sits to the
 * left of this block and would slide right on every arrow keypress otherwise.
 */
.palette-item-actions {
  flex-shrink: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  visibility: hidden;
}

.palette-item--selected .palette-item-actions {
  visibility: visible;
}

.palette-item-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  /*
   * Concentric radii: the keycap inside is 6px, the padding around it is 4px,
   * so the outer shape is 10px — that is what keeps the two curves parallel
   * instead of the cap looking crammed into a corner. It also gets the shape
   * above the ~8px floor where `corner-shape: squircle` starts being visible;
   * at the old 6px the inherited setting had nothing to show.
   */
  padding: 4px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.palette-item-action:hover {
  background: var(--action-hover-bg);
  box-shadow: var(--action-hover-rim);
  color: var(--text);
}

.palette-item--selected .palette-item-action {
  color: rgba(var(--fg-rgb), 0.72);
}

.palette-item-action--danger:hover {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
}

/*
 * Split button: Open and its caret are two halves of one shape. They share a
 * surface, square off the corners where they meet, and are separated by a
 * hairline instead of by space — the gesture is "open, or pick a variant of
 * opening", and two detached buttons said "two unrelated actions".
 *
 * Each half still lights up on its own hover, which is what tells you the
 * caret is clickable without splitting the shape apart again.
 */
.palette-item-action:has(+ .palette-item-caret),
.palette-item-caret {
  background: var(--action-rest-bg);
}

.palette-item-action:has(+ .palette-item-caret) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.palette-item-caret {
  /* Cancels the row's action gap so the two halves actually touch. */
  margin-left: -6px;
  padding-left: 5px;
  padding-right: 5px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  /* Inset shadow, not a border: a border would add a pixel to the height. */
  box-shadow: inset 1px 0 0 rgba(var(--fg-rgb), 0.18);
  /*
   * Match the other half's height. Open is as tall as the 18px keycap it
   * contains, the caret only as tall as a 12px glyph, and the row centers
   * them — so the two halves of one shape came out different sizes. Stretch
   * takes the height from the tallest button in the row instead of pinning a
   * number here that the keycap could outgrow.
   */
  align-self: stretch;
}

.palette-item-action:has(+ .palette-item-caret):hover,
.palette-item-caret:hover,
.palette-item-caret[aria-expanded="true"] {
  background: var(--action-hover-bg);
}

/*
 * The hover rim belongs to a standalone chip. Here it would trace each half
 * separately — a seam straight down the middle of a shape whose whole point is
 * to read as one — and on the caret it would out-specify the divider above.
 * So: no rim on the left half, and the caret keeps its divider.
 */
.palette-item-action:has(+ .palette-item-caret):hover {
  box-shadow: none;
}

.palette-item-caret:hover,
.palette-item-caret[aria-expanded="true"] {
  box-shadow: inset 1px 0 0 rgba(var(--fg-rgb), 0.18);
}

/* Right-aligned glance column; never competes with the row's own actions. */
.palette-item-inline {
  display: inline-flex;
  align-items: baseline;
  flex-shrink: 0;
  gap: 6px;
  margin-left: auto;
  padding-left: 10px;
}

.palette-item-inline-value {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.9);
}

.palette-item-inline-value--active {
  color: #7dd3a0;
}

.palette-item-inline-value--warn {
  color: #e8b573;
}

.palette-item-inline-value--done {
  color: #f87171;
}

.palette-item-inline-label {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.palette-item-subtitle {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
}

.palette-show-more {
  list-style: none;
  margin: 0;
  padding: 2px 12px 10px;
  display: flex;
  justify-content: center;
}

.palette-show-more-btn {
  margin: 0;
  padding: 4px 10px;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.38);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
}

.palette-show-more-btn:hover,
.palette-show-more-btn:focus-visible {
  color: rgba(var(--fg-rgb), 0.7);
  background: rgba(var(--fg-rgb), 0.06);
}

.palette-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px 12px;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.5);
  text-align: center;
}

.palette-statusbar {
  position: relative;
  /* Above .palette-results so status-bar popovers overlay the search list. */
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  /* 8px here + the button's own 12px lands the Widgets icon on the same left
     edge as the query text above it (the input row insets by 20px). */
  padding: 10px 10px;
  /* border-top: 1px solid var(--border); */
  border-radius: 0 0 var(--surface-radius, 16px) var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  /* Direction of the tint is itself mode-dependent, not just its strength —
     light mode lifts the footer, dark mode sinks it (see styles.css). */
  background: var(--bar-bg);
  box-shadow: var(--bar-top-highlight, 0 0 transparent);
}

.palette-statusbar-left {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  min-height: 28px;
  flex-shrink: 0;
}

.palette-widgets-group,
.palette-desk-tab-group {
  display: inline-flex;
  align-items: center;
}

.palette-desk-tab-group {
  gap: 8px;
}

/*
 * Keep the visual plus at button size, but give its surrounding gesture a
 * little breathing room. The parent reveals it when its related control is
 * hovered; focus-within keeps the same affordance usable from the keyboard.
 */
.palette-add-hit-area {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  margin: -4px 0;
  padding: 4px;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  color: transparent;
  font-size: 0;
  line-height: 1;
  /* The hit area is intentionally larger than the visible plus; don't expose
     that invisible box as a browser focus frame after a mouse click. */
  outline: none;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

/* Keep browser focus/pressed styles off the invisible hit area itself. */
.palette-add-hit-area:focus,
.palette-add-hit-area:focus-visible,
.palette-add-hit-area:active {
  border: 0;
  outline: 0 !important;
  box-shadow: none;
}

.palette-add-hit-area::before {
  content: "+";
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
}

.palette-widgets-group:hover .palette-add-hit-area,
.palette-widgets-group:focus-within .palette-add-hit-area,
.palette-desk-tab-group:hover .palette-add-hit-area,
.palette-desk-tab-group:focus-within .palette-add-hit-area {
  opacity: 1;
  pointer-events: auto;
}

.palette-add-hit-area:hover::before,
.palette-add-hit-area:focus-visible::before {
  background: var(--fill);
  color: var(--text);
}

.palette-statusbar-right {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 28px;
  margin-left: auto;
  flex-shrink: 0;
}

.palette-onboarding {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 6px;
  border: 0;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
}

.palette-onboarding:hover,
.palette-onboarding--open {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.06);
}

/* Opens upward from the status bar so it stays inside the palette chrome. */
.palette-onboarding-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 30;
  min-width: 132px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 12px 32px rgba(var(--shadow-rgb), calc(0.45 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-onboarding-arc {
  display: block;
  flex-shrink: 0;
}

.palette-onboarding-arc-track {
  stroke: rgba(52, 211, 153, 0.22);
}

.palette-onboarding-arc-progress {
  stroke: #34d399;
  transition: stroke-dashoffset 0.2s ease;
}

.palette-onboarding-label {
  font-size: 11px;
  white-space: nowrap;
}

.palette-statusbar-center {
  /* True visual center — ignore the wider Widgets control on the left. */
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 220px);
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow-x: auto;
  padding: 0 6px;
  overflow-y: hidden;
  scrollbar-width: none;
}

/* Let the temporary desk tooltip bubbles extend below the status bar. */
.palette-statusbar-center--shortcut-hints {
  overflow: visible;
}

.palette-statusbar-center::-webkit-scrollbar {
  display: none;
}

/*
 * Same control as .palette-bar-btn: 28px tall, 13px/500, capsule, transparent
 * until pointed at. Everything in this bar is now one chip.
 */
.palette-desk-tab {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  max-width: 120px;
}

/*
 * Active has to stay louder than hover, or you lose track of which desk you are
 * on while pointing at another one: stronger fill, and full-strength text
 * against the muted rest state.
 */
.palette-desk-tab--active {
  background: var(--fill-hover);
  color: var(--text);
}

.palette-desk-tab:hover:not(.palette-desk-tab--active) {
  background: var(--fill);
  color: var(--text);
}

.palette-desk-tab-label {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Ctrl-hold tooltip shown for every desk with a Ctrl+Shift+1…9 chord. */
.palette-desk-shortcut-tip {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: max-content;
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

/* While hovering one desk, its shared body-level tooltip owns that tab. */
.palette-desk-tab:hover .palette-desk-shortcut-tip,
.palette-desk-tab:focus-visible .palette-desk-shortcut-tip {
  display: none;
}

.palette-desk-rename {
  box-sizing: border-box;
  width: auto;
  min-width: 48px;
  max-width: 160px;
  cursor: text;
  border: 1px solid var(--border-strong);
  background: var(--fill-hover);
  color: var(--text);
  font-family: inherit;
}

.palette-desk-ctx {
  position: absolute;
  z-index: 100;
  min-width: 180px;
  max-width: 240px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 8px 24px rgba(var(--shadow-rgb), calc(0.4 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
}

.palette-desk-ctx-msg {
  margin: 0;
  padding: 6px 10px 8px;
  color: rgba(var(--fg-rgb), 0.7);
  font-size: 11px;
  line-height: 1.35;
}

.palette-desk-ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.palette-desk-ctx-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.palette-desk-ctx-item--danger {
  color: #f87171;
}

.palette-desk-ctx-item--danger:hover {
  background: rgba(248, 113, 113, 0.12);
}

.palette-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  /*
   * Fully round, which for a 28px square button means a circle — the same rule
   * that shapes the desk tabs and the add button, so the whole bar has one
   * chip language. A fixed 8px was the one hard corner left in it, and it also
   * drifted out of relation whenever the surface radius setting changed.
   */
  border-radius: 999px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  /* Tokenized rather than a fixed alpha: 0.55 grey reads as "secondary" on a
     dark panel and as "disabled" on a light one. */
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

/* 12px, not 8px: on a capsule the first 8px of the edge is still curving, so
   the old padding let the icon sit visually inside the corner. */
.palette-bar-btn--widgets {
  width: auto;
  gap: 9px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
}

/* Sized off the label's cap height rather than its font size — at 14px the
   glyph sat visibly smaller than the word next to it. Full opacity for the
   same reason: icon and label are one control, not label plus decoration. */
.palette-bar-btn-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.palette-bar-btn-label {
  line-height: 1;
}

.palette-bar-btn:hover,
.palette-bar-btn[aria-expanded="true"],
.palette-bar-btn[aria-pressed="true"] {
  color: var(--text);
  background: var(--fill);
}

.palette-calc {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 20px 12px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.1);
}

.palette-calc-eq {
  font-size: 14px;
  color: rgba(var(--fg-rgb), 0.45);
}

.palette-calc-value {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.95);
}
</style>
