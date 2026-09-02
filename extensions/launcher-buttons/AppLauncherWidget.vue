<script setup lang="ts">
import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  nextTick,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import { FolderIcon } from "@sdk/icons";
import {
  type GifAnimateMode,
  type LauncherApp,
  detectKind,
  displayName,
  displayNameForUrl,
  hasPath,
  ICON_EXTRACT_GEN,
  ICON_FACE_PX,
  ICON_SIZE_PX,
  isGifIconDataUrl,
  newAppId,
  normalizeUrl,
  shouldRefreshExtractedIcon,
} from "./appLauncherLogic";

/** Row from Rust `list_installed_apps`. */
interface InstalledAppRow {
  name: string;
  path: string;
  /** Start menu “Pinned” grid entry. */
  pinned?: boolean;
}

/** Concurrent icon fetches for the installed-apps list. */
const INSTALLED_ICON_WORKERS = 8;
import {
  LAUNCHER_KEYS,
  type LauncherKeyDef,
  keyPath,
  parseKeyId,
} from "./appLauncherKeys";
import AppLauncherKeyIcon from "./AppLauncherKeyIcon.vue";
import type { LauncherModel } from "./widgets/launcherButtons";

const props = defineProps<{ model: LauncherModel }>();
const model = props.model;

const {
  apps,
  width,
  hideAddButton,
  iconSize,
  openAddSignal,
  error,
  setError,
  addEntries,
  remove,
  reorder,
  mute,
  clearMute,
  updateApp,
  requestOpenAddMenu,
  pick,
  listInstalled,
  extractIcon,
  loadIcon,
  fetchUrlIcon,
  launch: launchPath,
  sendKey,
} = model;

/** True when WidgetCard ResizeEdges owns width (height hugs content). */
const hostSized = inject<ComputedRef<boolean>>("widgetHostSized", computed(() => false));

/** Active dock icon button edge length in px. */
const iconPx = computed(() => ICON_SIZE_PX[iconSize.value]);

/**
 * Icon CSS vars + width sizing.
 * Height always hugs the icon row (manifest hugHeight) — never force a tall box.
 */
const launcherBoxStyle = computed(() => {
  const px = iconPx.value;
  const face = ICON_FACE_PX[iconSize.value];
  const key = Math.round(face * 0.875);
  const radius = Math.max(8, Math.round(px * 0.25));
  const sizeVars = {
    "--launcher-icon": `${px}px`,
    "--launcher-face": `${face}px`,
    "--launcher-key": `${key}px`,
    "--launcher-radius": `${radius}px`,
    "--launcher-add-font": `${Math.round(px * 0.45)}px`,
  };
  if (hostSized.value) {
    return { ...sizeVars, width: "100%" };
  }
  return {
    ...sizeVars,
    width: `${width.value}px`,
  };
});

/** Sections in the Add modal (replaces the old + popover). */
type AddModalSection = "apps" | "files" | "folders" | "url" | "key";

const addModalOpen = ref(false);
const addModalSection = ref<AddModalSection>("apps");
const installedBusy = ref(false);
const installedAdding = ref(false);
const installedQuery = ref("");
const installedList = ref<InstalledAppRow[]>([]);
const installedSelected = ref<Set<string>>(new Set());
/** path → icon data URL (filled asynchronously after the list loads). */
const installedIcons = ref<Record<string, string>>({});
const installedSearchEl = ref<HTMLInputElement | null>(null);
const installedPanelEl = ref<HTMLElement | null>(null);
/** Bumped to cancel in-flight icon workers when the panel closes / reloads. */
let installedIconGen = 0;
const urlDraft = ref("");
const urlBusy = ref(false);
const urlInputEl = ref<HTMLInputElement | null>(null);
const ctx = ref<{ id: string; x: number; y: number } | null>(null);
/** Index being reordered via press-and-move (null when idle). */
const dragFrom = ref<number | null>(null);
/** Index currently under the pointer during a reorder drag. */
const dragOver = ref<number | null>(null);
const rootEl = ref<HTMLElement | null>(null);

/** Active pointer press that may become a reorder drag. */
let iconPress: {
  index: number;
  x: number;
  y: number;
  pointerId: number;
  el: HTMLElement;
} | null = null;
/** True once movement passed the drag threshold (suppresses click-to-launch). */
let iconDidDrag = false;
const ICON_DRAG_THRESHOLD_PX = 6;

/** App id currently hovered (for GIF animate-on-hover). */
const hoveredIconId = ref<string | null>(null);
/** First-frame PNG data URLs keyed by GIF data URL (freeze cache). */
const frozenGifBySrc = ref<Record<string, string>>({});
/** In-flight freeze jobs so the same GIF is only decoded once. */
const freezeJobs = new Map<string, Promise<string>>();

const keyCatalog = LAUNCHER_KEYS;

/** Normalize dialog return into a path list. */
function asPaths(selected: string | string[] | null): string[] {
  if (selected == null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Build launcher entries for selected paths (extract icons when possible). */
async function ingestPaths(paths: string[], isDirectory: boolean) {
  const entries: LauncherApp[] = [];
  for (const path of paths) {
    const kind = detectKind(path, isDirectory);
    let iconDataUrl: string | undefined;
    try {
      iconDataUrl = await extractIcon(path);
    } catch {
      // fallback glyph in template when missing
    }
    entries.push({
      id: newAppId(),
      path,
      kind,
      name: displayName(path),
      ...(iconDataUrl
        ? { iconDataUrl, iconExtractGen: ICON_EXTRACT_GEN }
        : {}),
    });
  }
  addEntries(entries);
  setError(null);
}

/** Open multi file picker for .exe / .lnk (from the Add modal Files section). */
async function pickFiles() {
  const paths = asPaths(await pick("file"));
  if (paths.length === 0) return;
  await ingestPaths(paths, false);
  closeAddModal();
}

/** Open multi folder picker (from the Add modal Folders section). */
async function pickFolders() {
  const paths = asPaths(await pick("folder"));
  if (paths.length === 0) return;
  await ingestPaths(paths, true);
  closeAddModal();
}

/** Filtered installed-apps rows (live search by name; pin order preserved). */
const installedFiltered = computed(() => {
  const q = installedQuery.value.trim().toLowerCase();
  const list = installedList.value;
  if (!q) return list;
  return list.filter((a) => a.name.toLowerCase().includes(q));
});

/** Pinned Start apps (already at the front of the filtered list). */
const installedPinnedFiltered = computed(() =>
  installedFiltered.value.filter((a) => a.pinned),
);

/** Non-pinned apps after the Pinned section. */
const installedOtherFiltered = computed(() =>
  installedFiltered.value.filter((a) => !a.pinned),
);

/** How many apps are currently checked in the modal. */
const installedSelectedCount = computed(() => installedSelected.value.size);

/** Backdrop click (outside the dialog) dismisses the Add modal. */
function onAddModalBackdrop(e: PointerEvent) {
  if (e.target !== e.currentTarget || installedAdding.value || urlBusy.value) return;
  closeAddModal();
}

/** Open the Add modal on a section (default: Apps). */
async function openAddModal(section: AddModalSection = "apps") {
  addModalOpen.value = true;
  await selectAddModalSection(section);
}

/** Switch Add modal section and prepare its content. */
async function selectAddModalSection(section: AddModalSection) {
  addModalSection.value = section;
  if (section === "apps") {
    await reloadInstalledApps();
    await nextTick();
    installedSearchEl.value?.focus();
    return;
  }
  if (section === "url") {
    urlDraft.value = "";
    urlBusy.value = false;
    await nextTick();
    urlInputEl.value?.focus();
  }
}

/** Fetch / refresh the system installed-apps catalog for the Apps section. */
async function reloadInstalledApps() {
  installedQuery.value = "";
  installedSelected.value = new Set();
  installedIcons.value = {};
  installedBusy.value = true;
  setError(null);
  try {
    installedList.value = await listInstalled<InstalledAppRow[]>();
    void loadInstalledIcons(installedList.value);
  } catch {
    installedList.value = [];
    setError("Installed apps unavailable");
  } finally {
    installedBusy.value = false;
  }
}

/** Close the Add modal without requiring a confirm action. */
function closeAddModal() {
  installedIconGen += 1;
  addModalOpen.value = false;
  installedQuery.value = "";
  installedSelected.value = new Set();
  installedBusy.value = false;
  installedAdding.value = false;
  urlDraft.value = "";
  urlBusy.value = false;
}

/** Fetch shell icons for list rows (concurrent; cancelled when the panel closes). */
async function loadInstalledIcons(list: InstalledAppRow[]) {
  const gen = ++installedIconGen;
  const queue = list.map((a) => a.path);
  async function worker() {
    while (queue.length > 0) {
      if (gen !== installedIconGen) return;
      const path = queue.shift();
      if (!path || installedIcons.value[path]) continue;
      try {
        const iconDataUrl = await extractIcon(path);
        if (gen !== installedIconGen) return;
        installedIcons.value = { ...installedIcons.value, [path]: iconDataUrl };
      } catch {
        // letter fallback in the row
      }
    }
  }
  await Promise.all(
    Array.from({ length: INSTALLED_ICON_WORKERS }, () => worker()),
  );
}

/** Toggle selection for one installed app (skip if already on the dock). */
function toggleInstalled(path: string) {
  if (hasPath(apps.value, path)) return;
  const next = new Set(installedSelected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  installedSelected.value = next;
}

/** Confirm selection using list names + any icons already loaded. */
async function confirmInstalledPicker() {
  if (installedAdding.value) return;
  const selected = installedList.value.filter(
    (a) => installedSelected.value.has(a.path) && !hasPath(apps.value, a.path),
  );
  if (selected.length === 0) {
    closeAddModal();
    return;
  }
  installedAdding.value = true;
  setError(null);
  try {
    const entries: LauncherApp[] = [];
    for (const app of selected) {
      let iconDataUrl = installedIcons.value[app.path];
      if (!iconDataUrl) {
        try {
          iconDataUrl = await extractIcon(app.path);
        } catch {
          // letter fallback
        }
      }
      const isDirectory = false;
      entries.push({
        id: newAppId(),
        path: app.path,
        kind: detectKind(app.path, isDirectory),
        name: app.name,
        ...(iconDataUrl
          ? { iconDataUrl, iconExtractGen: ICON_EXTRACT_GEN }
          : {}),
      });
    }
    addEntries(entries);
    closeAddModal();
  } finally {
    installedAdding.value = false;
  }
}

/** Add one catalog key to the dock (skip if already present). */
function addKey(def: LauncherKeyDef) {
  addEntries([
    {
      id: newAppId(),
      path: keyPath(def.id),
      kind: "key",
      name: def.label,
    },
  ]);
  setError(null);
  closeAddModal();
}

/** Normalize URL, add dock entry immediately, fetch icon in the background. */
async function submitUrl() {
  if (urlBusy.value) return;
  const normalized = normalizeUrl(urlDraft.value);
  if (!normalized) {
    setError("Invalid URL");
    return;
  }

  const id = newAppId();
  addEntries([
    {
      id,
      path: normalized,
      kind: "url",
      name: displayNameForUrl(normalized),
    },
  ]);
  setError(null);
  closeAddModal();

  // Don't block the modal on HTML scrape / favicon download.
  void (async () => {
    try {
      const iconDataUrl = await fetchUrlIcon(normalized);
      updateApp(id, { iconDataUrl });
    } catch {
      // Letter fallback stays until a custom icon is uploaded.
    }
  })();
}

/** Letter fallback for non-key entries without an extracted icon. */
function faceText(app: LauncherApp): string {
  return app.name.slice(0, 1).toUpperCase();
}

/** Catalog id for a key entry, or null. */
function keyIdOf(app: LauncherApp): string | null {
  return app.kind === "key" ? parseKeyId(app.path) : null;
}

/** Launch path/URL or send a virtual key; mute icon on failure. */
async function launch(app: LauncherApp) {
  setError(null);
  try {
    if (app.kind === "key") {
      const keyId = parseKeyId(app.path);
      if (!keyId) throw "Unknown key";
      await sendKey(keyId);
    } else {
      await launchPath(app.path);
    }
    clearMute(app.id);
  } catch (e) {
    mute(app.id);
    setError(typeof e === "string" ? e : "Launch failed");
  }
}

function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  e.stopPropagation();
  // Viewport coords — menu teleports to body so WidgetHost transforms / overflow
  // on the dock cannot clip it (position:fixed is correct outside the transform).
  ctx.value = {
    id,
    x: e.clientX,
    y: e.clientY,
  };
}

/** App currently targeted by the icon context menu. */
const ctxApp = computed(() =>
  ctx.value ? apps.value.find((a) => a.id === ctx.value!.id) ?? null : null,
);

/** Close context menu after an action. */
function closeCtx() {
  ctx.value = null;
}

/** Pick a local image and store it as the item's icon data URL. */
async function onUploadIconCtx() {
  if (!ctx.value) return;
  const id = ctx.value.id;
  closeCtx();
  const path = (await pick("image"))[0];
  if (!path) return;
  try {
    const iconDataUrl = await loadIcon(path);
    // New GIF icons stay frozen until the user picks an animate mode.
    updateApp(id, {
      iconDataUrl,
      iconGifAnimate: undefined,
      iconCustom: true,
      iconExtractGen: undefined,
    });
    if (isGifIconDataUrl(iconDataUrl)) void ensureFrozenGif(iconDataUrl);
    setError(null);
  } catch {
    setError("Could not load icon");
  }
}

/**
 * Re-extract shell icons for path-based dock entries (skips custom / GIF / keys / URLs).
 * Runs once per `ICON_EXTRACT_GEN` bump so existing docks pick up sharper icons.
 */
async function refreshExtractedIcons() {
  const targets = apps.value.filter(shouldRefreshExtractedIcon);
  if (targets.length === 0) return;

  const queue = [...targets];
  const workers = Math.min(4, queue.length);

  async function worker() {
    while (queue.length > 0) {
      const app = queue.shift();
      if (!app) return;
      try {
        const iconDataUrl = await extractIcon(app.path);
        updateApp(app.id, {
          iconDataUrl,
          iconExtractGen: ICON_EXTRACT_GEN,
        });
      } catch {
        // Keep the previous icon; mark gen so we do not hammer a broken path every load.
        updateApp(app.id, { iconExtractGen: ICON_EXTRACT_GEN });
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/** Toggle edge-to-edge icon rendering for the targeted item. */
function onTogglePaddingCtx() {
  if (!ctxApp.value) return;
  const id = ctxApp.value.id;
  const next = !ctxApp.value.iconNoPadding;
  updateApp(id, { iconNoPadding: next });
  closeCtx();
}

/**
 * Set GIF animate mode for the targeted item.
 * Clicking the already-active mode turns animation off (frozen).
 */
function onSetGifAnimateCtx(mode: GifAnimateMode) {
  if (!ctxApp.value || !isGifIconDataUrl(ctxApp.value.iconDataUrl)) return;
  const id = ctxApp.value.id;
  const src = ctxApp.value.iconDataUrl!;
  const next = ctxApp.value.iconGifAnimate === mode ? undefined : mode;
  updateApp(id, { iconGifAnimate: next });
  void ensureFrozenGif(src);
  closeCtx();
}

/** Open the add menu from an item context menu. */
function onAddFromCtx() {
  closeCtx();
  requestOpenAddMenu();
}

/** Open the Add modal (from + or widget / item context menu). */
function openAddMenu() {
  ctx.value = null;
  void openAddModal("apps");
}

function onRemoveCtx() {
  if (!ctx.value) return;
  remove(ctx.value.id);
  closeCtx();
}

/** Snapshot a GIF's first frame to a PNG data URL (browsers cannot pause GIF playback). */
function freezeGifToPng(gifDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const c = canvas.getContext("2d");
      if (!c) {
        reject(new Error("canvas unsupported"));
        return;
      }
      c.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("gif decode failed"));
    img.src = gifDataUrl;
  });
}

/** Ensure a frozen frame exists for this GIF src (cached). */
function ensureFrozenGif(gifDataUrl: string): Promise<string> {
  const cached = frozenGifBySrc.value[gifDataUrl];
  if (cached) return Promise.resolve(cached);
  let job = freezeJobs.get(gifDataUrl);
  if (!job) {
    job = freezeGifToPng(gifDataUrl)
      .then((png) => {
        frozenGifBySrc.value = { ...frozenGifBySrc.value, [gifDataUrl]: png };
        freezeJobs.delete(gifDataUrl);
        return png;
      })
      .catch((err) => {
        freezeJobs.delete(gifDataUrl);
        throw err;
      });
    freezeJobs.set(gifDataUrl, job);
  }
  return job;
}

/** Icon `src` for an app: GIF plays per mode, otherwise the frozen first frame. */
function iconDisplaySrc(app: LauncherApp): string {
  const url = app.iconDataUrl!;
  if (!isGifIconDataUrl(url)) return url;
  const mode = app.iconGifAnimate;
  const play =
    mode === "always" ||
    (mode === "hover" && hoveredIconId.value === app.id);
  if (play) return url;
  // Prefer the still frame; avoid falling back to the live GIF (would animate).
  return frozenGifBySrc.value[url] ?? "";
}

/** Prefetch frozen frames for every GIF currently in the dock. */
watch(
  apps,
  (list) => {
    for (const app of list) {
      if (isGifIconDataUrl(app.iconDataUrl)) {
        void ensureFrozenGif(app.iconDataUrl!);
      }
    }
  },
  { immediate: true, deep: true },
);

/** Start tracking a press on an icon (widget drag stays blocked via stop). */
function onIconPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  iconPress = {
    index,
    x: e.clientX,
    y: e.clientY,
    pointerId: e.pointerId,
    el,
  };
  iconDidDrag = false;
  el.setPointerCapture(e.pointerId);
}

/** After a small move, enter reorder mode and track the drop target under the cursor. */
function onIconPointerMove(e: PointerEvent) {
  if (!iconPress || e.pointerId !== iconPress.pointerId) return;
  const dx = e.clientX - iconPress.x;
  const dy = e.clientY - iconPress.y;
  if (dragFrom.value == null) {
    if (dx * dx + dy * dy < ICON_DRAG_THRESHOLD_PX * ICON_DRAG_THRESHOLD_PX) {
      return;
    }
    iconDidDrag = true;
    dragFrom.value = iconPress.index;
    dragOver.value = iconPress.index;
    ctx.value = null;
  }

  const over = launcherIndexAtPoint(e.clientX, e.clientY);
  if (over != null) dragOver.value = over;
}

/** Resolve which icon index is under the cursor (works under pointer capture). */
function launcherIndexAtPoint(x: number, y: number): number | null {
  const buttons = rootEl.value?.querySelectorAll<HTMLElement>("[data-launcher-index]");
  if (!buttons) return null;
  for (const btn of buttons) {
    const r = btn.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return Number(btn.dataset.launcherIndex);
    }
  }
  return null;
}

/** Commit reorder on release, or let the following click launch if it was a tap. */
function onIconPointerUp(e: PointerEvent) {
  if (!iconPress || e.pointerId !== iconPress.pointerId) return;
  const from = dragFrom.value;
  const to = dragOver.value;
  try {
    iconPress.el.releasePointerCapture(e.pointerId);
  } catch {
    // already released
  }
  iconPress = null;

  if (from != null) {
    if (to != null && from !== to) {
      reorder(from, to);
    }
    dragFrom.value = null;
    dragOver.value = null;
  }
}

/** Launch only when the press was not a reorder drag. */
function onIconClick(app: LauncherApp) {
  if (iconDidDrag) {
    iconDidDrag = false;
    return;
  }
  void launch(app);
}

/** True when any launcher overlay is open. */
function anyOverlayOpen(): boolean {
  return addModalOpen.value || ctx.value !== null;
}

/** Close overlays when pointer lands outside them (same idea as WidgetCard). */
function onDocPointerDown(e: PointerEvent) {
  const target = e.target as Node;

  if (
    addModalOpen.value &&
    !installedAdding.value &&
    !urlBusy.value &&
    !installedPanelEl.value?.contains(target)
  ) {
    // Backdrop handler also closes; this covers clicks that miss the teleported tree.
    const el = e.target as HTMLElement | null;
    if (!el?.closest?.(".installed-backdrop")) closeAddModal();
  }

  if (ctx.value) {
    const el = e.target as HTMLElement | null;
    if (!el?.closest?.("[data-app-ctx]")) ctx.value = null;
  }
}

/** Escape closes the Add modal / icon context menu. */
function onDocKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!installedAdding.value && !urlBusy.value) closeAddModal();
  ctx.value = null;
}

/** Keep local overlay state; the host observes the `data-interactive` surface. */
let overlayPausedHere = false;

/** Pause OS click-through while menus / URL form need outside clicks. */
function setOverlayClickThrough(paused: boolean) {
  if (paused === overlayPausedHere) return;
  overlayPausedHere = paused;
}

/** Only pay capture-phase cost while an overlay needs outside dismiss. */
let docListening = false;

/** Attach/detach document listeners when launcher overlays open/close. */
function syncDocListeners() {
  const need = anyOverlayOpen();
  if (need === docListening) return;
  if (need) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
  }
  docListening = need;
}

/** Widget ⋯ “Add” bumps this signal — open the dock add menu. */
watch(openAddSignal, () => {
  openAddMenu();
});

// Track outside-dismiss listeners while overlays are open.
watch([addModalOpen, ctx], async () => {
  setOverlayClickThrough(addModalOpen.value || ctx.value !== null);
  syncDocListeners();
  await nextTick();
});

onMounted(() => {
  void refreshExtractedIcons();
});
onUnmounted(() => {
  iconPress = null;
  setOverlayClickThrough(false);
  if (docListening) {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
    docListening = false;
  }
});
</script>

<template>
  <div
    ref="rootEl"
    class="launcher"
    data-interactive
    :style="launcherBoxStyle"
  >
    <p v-if="error" class="launcher-error">{{ error }}</p>

    <div class="launcher-row">
      <button
        v-for="(app, index) in apps"
        :key="app.id"
        type="button"
        class="launcher-icon"
        :class="{
          'launcher-icon--muted': app.muted,
          'launcher-icon--flush': app.iconNoPadding,
          'launcher-icon--dragging': dragFrom === index,
          'launcher-icon--drop': dragOver === index && dragFrom !== null && dragFrom !== index,
        }"
        :data-launcher-index="index"
        :title="app.name"
        @pointerdown="onIconPointerDown($event, index)"
        @pointermove="onIconPointerMove"
        @pointerup="onIconPointerUp"
        @pointercancel="onIconPointerUp"
        @click="onIconClick(app)"
        @pointerenter="hoveredIconId = app.id"
        @pointerleave="hoveredIconId = null"
        @contextmenu="onContextMenu($event, app.id)"
      >
        <FolderIcon v-if="app.kind === 'folder'" class="launcher-folder-face" :size="32" />
        <img
          v-else-if="app.iconDataUrl && iconDisplaySrc(app)"
          :key="`${app.id}:${iconDisplaySrc(app) === app.iconDataUrl ? 'live' : 'still'}`"
          :src="iconDisplaySrc(app)"
          alt=""
          class="launcher-img"
          :class="{ 'launcher-img--flush': app.iconNoPadding }"
        />
        <span v-else-if="app.kind === 'key' && keyIdOf(app)" class="launcher-key-face">
          <AppLauncherKeyIcon :key-id="keyIdOf(app) || ''" />
        </span>
        <span v-else class="launcher-fallback">{{ faceText(app) }}</span>
      </button>

        <button
          v-if="!hideAddButton"
          type="button"
          class="launcher-add"
          v-tip="'Add'"
          aria-label="Add"
          @pointerdown.stop
          @click.stop="openAddModal('apps')"
        >
          +
        </button>
      </div>

    <!-- Add modal: Apps / Files / Folders / URL / Key -->
    <Teleport to="body">
      <div
        v-if="addModalOpen"
        class="installed-backdrop"
        data-interactive
        @pointerdown="onAddModalBackdrop"
      >
        <div
          ref="installedPanelEl"
          class="installed-modal"
          data-interactive
          role="dialog"
          aria-modal="true"
          aria-label="Add to dock"
          @pointerdown.stop
        >
          <aside class="installed-modal-nav">
            <div class="installed-modal-nav-label">Add</div>
            <button
              type="button"
              class="installed-modal-nav-item"
              :class="{ 'installed-modal-nav-item--active': addModalSection === 'apps' }"
              @click="selectAddModalSection('apps')"
            >
              Apps
            </button>
            <button
              type="button"
              class="installed-modal-nav-item"
              :class="{ 'installed-modal-nav-item--active': addModalSection === 'files' }"
              @click="selectAddModalSection('files')"
            >
              Files
            </button>
            <button
              type="button"
              class="installed-modal-nav-item"
              :class="{ 'installed-modal-nav-item--active': addModalSection === 'folders' }"
              @click="selectAddModalSection('folders')"
            >
              Folders
            </button>
            <button
              type="button"
              class="installed-modal-nav-item"
              :class="{ 'installed-modal-nav-item--active': addModalSection === 'url' }"
              @click="selectAddModalSection('url')"
            >
              URL
            </button>
            <button
              type="button"
              class="installed-modal-nav-item"
              :class="{ 'installed-modal-nav-item--active': addModalSection === 'key' }"
              @click="selectAddModalSection('key')"
            >
              Key
            </button>
          </aside>

          <div class="installed-modal-main">
            <header class="installed-modal-header">
              <div class="installed-modal-heading">
                <h2 class="installed-modal-title">
                  {{
                    addModalSection === "apps"
                      ? "Apps"
                      : addModalSection === "files"
                        ? "Files"
                        : addModalSection === "folders"
                          ? "Folders"
                          : addModalSection === "url"
                            ? "URL"
                            : "Key"
                  }}
                </h2>
                <p class="installed-modal-sub">
                  <template v-if="addModalSection === 'apps'">
                    {{
                      installedBusy
                        ? "Loading installed apps…"
                        : `${installedFiltered.length} shown${installedSelectedCount ? ` · ${installedSelectedCount} selected` : ""}`
                    }}
                  </template>
                  <template v-else-if="addModalSection === 'files'">
                    Choose .exe or .lnk files from disk
                  </template>
                  <template v-else-if="addModalSection === 'folders'">
                    Choose folders to open from the dock
                  </template>
                  <template v-else-if="addModalSection === 'url'">
                    Add a website as a dock icon
                  </template>
                  <template v-else>
                    Add a media or system key
                  </template>
                </p>
              </div>
              <button
                type="button"
                class="installed-modal-close"
                aria-label="Close"
                :disabled="installedAdding || urlBusy"
                @click="closeAddModal"
              >
                ×
              </button>
            </header>

            <!-- Apps -->
            <div v-if="addModalSection === 'apps'" class="installed-modal-apps">
              <div class="installed-modal-search-wrap">
                <input
                  ref="installedSearchEl"
                  v-model="installedQuery"
                  class="installed-modal-search"
                  type="search"
                  placeholder="Search apps…"
                  :disabled="installedBusy || installedAdding"
                  aria-label="Search installed apps"
                  @keydown.escape.prevent="closeAddModal"
                />
              </div>

              <p v-if="installedBusy" class="installed-modal-status">Loading…</p>
              <p v-else-if="installedFiltered.length === 0" class="installed-modal-status">
                No apps found
              </p>
              <div v-else class="installed-modal-list">
                <template v-if="installedPinnedFiltered.length">
                  <div class="installed-modal-section">Pinned</div>
                  <label
                    v-for="app in installedPinnedFiltered"
                    :key="'pin-' + app.path"
                    class="installed-modal-row"
                    :class="{
                      'installed-modal-row--on-dock': hasPath(apps, app.path),
                      'installed-modal-row--selected': installedSelected.has(app.path),
                    }"
                  >
                    <input
                      type="checkbox"
                      class="installed-modal-check"
                      :checked="installedSelected.has(app.path)"
                      :disabled="hasPath(apps, app.path) || installedAdding"
                      @change="toggleInstalled(app.path)"
                    />
                    <img
                      v-if="installedIcons[app.path]"
                      :src="installedIcons[app.path]"
                      alt=""
                      class="installed-modal-icon"
                    />
                    <span v-else class="installed-modal-glyph">{{ app.name.slice(0, 1).toUpperCase() }}</span>
                    <span class="installed-modal-name">{{ app.name }}</span>
                    <span v-if="hasPath(apps, app.path)" class="installed-modal-badge">On dock</span>
                  </label>
                </template>
                <template v-if="installedOtherFiltered.length">
                  <div
                    class="installed-modal-section"
                    :class="{ 'installed-modal-section--spaced': installedPinnedFiltered.length > 0 }"
                  >
                    All apps
                  </div>
                  <label
                    v-for="app in installedOtherFiltered"
                    :key="'all-' + app.path"
                    class="installed-modal-row"
                    :class="{
                      'installed-modal-row--on-dock': hasPath(apps, app.path),
                      'installed-modal-row--selected': installedSelected.has(app.path),
                    }"
                  >
                    <input
                      type="checkbox"
                      class="installed-modal-check"
                      :checked="installedSelected.has(app.path)"
                      :disabled="hasPath(apps, app.path) || installedAdding"
                      @change="toggleInstalled(app.path)"
                    />
                    <img
                      v-if="installedIcons[app.path]"
                      :src="installedIcons[app.path]"
                      alt=""
                      class="installed-modal-icon"
                    />
                    <span v-else class="installed-modal-glyph">{{ app.name.slice(0, 1).toUpperCase() }}</span>
                    <span class="installed-modal-name">{{ app.name }}</span>
                    <span v-if="hasPath(apps, app.path)" class="installed-modal-badge">On dock</span>
                  </label>
                </template>
              </div>

              <footer class="installed-modal-footer">
                <button
                  type="button"
                  class="installed-modal-btn"
                  :disabled="installedAdding"
                  @click="closeAddModal"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="installed-modal-btn installed-modal-btn--primary"
                  :disabled="installedSelectedCount === 0 || installedBusy || installedAdding"
                  @click="confirmInstalledPicker"
                >
                  {{
                    installedAdding
                      ? "Adding…"
                      : installedSelectedCount
                        ? `Add ${installedSelectedCount}`
                        : "Add"
                  }}
                </button>
              </footer>
            </div>

            <!-- Files -->
            <div v-else-if="addModalSection === 'files'" class="installed-modal-panel">
              <div class="installed-modal-hero">
                <div class="installed-modal-hero-mark" aria-hidden="true">EXE</div>
                <h3 class="installed-modal-hero-title">Add files</h3>
                <p class="installed-modal-hero-text">
                  Pick one or more <strong>.exe</strong> or <strong>.lnk</strong> files from your computer.
                </p>
                <button type="button" class="installed-modal-btn installed-modal-btn--primary" @click="pickFiles">
                  Choose files…
                </button>
              </div>
            </div>

            <!-- Folders -->
            <div v-else-if="addModalSection === 'folders'" class="installed-modal-panel">
              <div class="installed-modal-hero">
                <div class="installed-modal-hero-mark" aria-hidden="true">DIR</div>
                <h3 class="installed-modal-hero-title">Add folders</h3>
                <p class="installed-modal-hero-text">
                  Pick folders to open in Explorer from the dock.
                </p>
                <button type="button" class="installed-modal-btn installed-modal-btn--primary" @click="pickFolders">
                  Choose folders…
                </button>
              </div>
            </div>

            <!-- URL -->
            <div v-else-if="addModalSection === 'url'" class="installed-modal-panel">
              <div class="installed-modal-url" @keyup.enter="submitUrl">
                <label class="installed-modal-url-label" for="launcher-add-url">Website URL</label>
                <input
                  id="launcher-add-url"
                  ref="urlInputEl"
                  v-model="urlDraft"
                  class="installed-modal-search"
                  type="url"
                  placeholder="https://…"
                  :disabled="urlBusy"
                  @keydown.escape.prevent="closeAddModal"
                />
                <div class="installed-modal-url-actions">
                  <button type="button" class="installed-modal-btn" :disabled="urlBusy" @click="closeAddModal">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="installed-modal-btn installed-modal-btn--primary"
                    :disabled="urlBusy || !urlDraft.trim()"
                  >
                    {{ urlBusy ? "Adding…" : "Add URL" }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Key -->
            <div v-else class="installed-modal-panel installed-modal-panel--keys">
              <p class="installed-modal-keys-hint">Click a key to add it to the dock.</p>
              <div class="installed-modal-keys">
                <button
                  v-for="def in keyCatalog"
                  :key="def.id"
                  type="button"
                  class="installed-modal-key"
                  @click="addKey(def)"
                >
                  <span class="installed-modal-key-face">
                    <AppLauncherKeyIcon :key-id="def.id" />
                  </span>
                  <span class="installed-modal-key-label">{{ def.label }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="ctx"
        class="launcher-ctx"
        data-app-ctx
        data-interactive
        :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
        @pointerdown.stop
      >
        <button type="button" class="launcher-menu-item" @click="onAddFromCtx">
          Add
        </button>
        <button type="button" class="launcher-menu-item" @click="onUploadIconCtx">
          Upload Icon Image
        </button>
        <button type="button" class="launcher-menu-item" @click="onTogglePaddingCtx">
          {{ ctxApp?.iconNoPadding ? "Restore padding" : "Remove padding" }}
        </button>
        <template v-if="ctxApp && isGifIconDataUrl(ctxApp.iconDataUrl)">
          <button
            type="button"
            class="launcher-menu-item"
            @click="onSetGifAnimateCtx('hover')"
          >
            {{ ctxApp.iconGifAnimate === "hover" ? "✓ " : "" }}Animate when hovered
          </button>
          <button
            type="button"
            class="launcher-menu-item"
            @click="onSetGifAnimateCtx('always')"
          >
            {{ ctxApp.iconGifAnimate === "always" ? "✓ " : "" }}Animate all the time
          </button>
        </template>
        <div class="launcher-menu-sep" role="separator" />
        <button type="button" class="launcher-menu-item launcher-menu-item--danger" @click="onRemoveCtx">
          Remove
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.launcher {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.launcher-error {
  margin: 0 0 8px;
  font-size: 11px;
  color: #f0a0a0;
}

.launcher-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.launcher-icon {
  flex-shrink: 0;
  width: var(--launcher-icon, 48px);
  height: var(--launcher-icon, 48px);
  padding: 0;
  border: none;
  border-radius: var(--launcher-radius, 12px);
  background: rgba(var(--fg-rgb), 0.06);
  cursor: grab;
  display: grid;
  place-items: center;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.launcher-icon:hover {
  background: rgba(var(--fg-rgb), 0.12);
}

.launcher-icon--muted {
  opacity: 0.4;
}

.launcher-icon--dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.launcher-icon--drop {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: 2px;
}

.launcher-img {
  width: var(--launcher-face, 32px);
  height: var(--launcher-face, 32px);
  object-fit: contain;
  pointer-events: none;
}

.launcher-img--flush {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.launcher-icon--flush .launcher-key-face {
  width: 100%;
  height: 100%;
}

.launcher-key-face {
  display: grid;
  place-items: center;
  width: var(--launcher-key, 28px);
  height: var(--launcher-key, 28px);
  color: rgba(var(--fg-rgb), 0.92);
  pointer-events: none;
}

.launcher-folder-face {
  width: var(--launcher-face, 32px);
  height: var(--launcher-face, 32px);
  color: rgba(var(--fg-rgb), 0.92);
  pointer-events: none;
}

.launcher-fallback {
  font-size: calc(var(--launcher-face, 32px) * 0.55);
  font-weight: 700;
  color: rgba(var(--fg-rgb), 0.75);
}

.launcher-add {
  flex-shrink: 0;
  width: var(--launcher-icon, 48px);
  height: var(--launcher-icon, 48px);
  border-radius: var(--launcher-radius, 12px);
  border: 1.5px dashed rgba(var(--fg-rgb), 0.35);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: var(--launcher-add-font, 22px);
  line-height: 1;
  cursor: pointer;
}

.launcher-add:hover {
  border-color: rgba(var(--fg-rgb), 0.55);
  color: rgba(var(--fg-rgb), 0.85);
}

.launcher-menu-item {
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

.launcher-menu-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.launcher-menu-item--danger {
  color: #f0a0a0;
}

/* Full-screen picker — mirrors SettingsModal chrome, sized for browsing. */
.installed-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.45);
}

.installed-modal {
  display: flex;
  flex-direction: row;
  width: min(720px, calc(100vw - 48px));
  height: min(640px, calc(100vh - 48px));
  border-radius: 18px;
  background:
    linear-gradient(165deg, rgba(46, 46, 52, 0.97) 0%, rgba(24, 24, 28, 0.97) 48%, rgba(18, 18, 22, 0.98) 100%);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow:
    0 1px 0 rgba(var(--fg-rgb), 0.06) inset,
    0 28px 80px rgba(var(--shadow-rgb), calc(0.55 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  overflow: hidden;
  pointer-events: auto;
}

.installed-modal-nav {
  width: 168px;
  flex-shrink: 0;
  padding: 18px 10px;
  border-right: 1px solid rgba(var(--fg-rgb), 0.08);
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.installed-modal-nav-label {
  padding: 4px 10px 12px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.38);
}

.installed-modal-nav-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.72);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.installed-modal-nav-item:hover {
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
}

.installed-modal-nav-item--active {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.96);
}

.installed-modal-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.installed-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 22px 0;
}

.installed-modal-heading {
  min-width: 0;
}

.installed-modal-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: rgba(var(--fg-rgb), 0.96);
}

.installed-modal-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.installed-modal-close {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.installed-modal-close:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.92);
}

.installed-modal-apps {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.installed-modal-search-wrap {
  padding: 16px 22px 12px;
}

.installed-modal-search {
  box-sizing: border-box;
  width: 100%;
  padding: 11px 14px;
  border-radius: 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(0, 0, 0, 0.32);
  color: rgba(var(--fg-rgb), 0.94);
  font-size: 14px;
  outline: none;
}

.installed-modal-search::placeholder {
  color: rgba(var(--fg-rgb), 0.35);
}

.installed-modal-search:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(0, 0, 0, 0.4);
}

.installed-modal-status {
  margin: 0;
  padding: 28px 22px;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.5);
  text-align: center;
}

.installed-modal-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--fg-rgb), 0.2) transparent;
}

.installed-modal-section {
  padding: 8px 12px 6px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.installed-modal-section--spaced {
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.installed-modal-list::-webkit-scrollbar {
  width: 8px;
}

.installed-modal-list::-webkit-scrollbar-track {
  background: transparent;
}

.installed-modal-list::-webkit-scrollbar-thumb {
  background: rgba(var(--fg-rgb), 0.16);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.installed-modal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  transition: background 0.12s ease;
}

.installed-modal-row:hover {
  background: rgba(var(--fg-rgb), 0.06);
}

.installed-modal-row--on-dock {
  opacity: 0.45;
  cursor: default;
}

.installed-modal-row--selected {
  background: rgba(var(--fg-rgb), 0.1);
}

.installed-modal-row--selected:hover {
  background: rgba(var(--fg-rgb), 0.12);
}

.installed-modal-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: rgba(220, 220, 230, 0.95);
  cursor: inherit;
}

.installed-modal-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.04);
}

.installed-modal-glyph {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.07);
  font-size: 13px;
  font-weight: 700;
  color: rgba(var(--fg-rgb), 0.72);
}

.installed-modal-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.installed-modal-badge {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.installed-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px 18px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.installed-modal-btn {
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.88);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.installed-modal-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.installed-modal-btn--primary {
  border-color: transparent;
  background: rgba(var(--fg-rgb), 0.14);
  color: rgba(var(--fg-rgb), 0.96);
}

.installed-modal-btn--primary:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.22);
}

.installed-modal-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 22px 22px;
  overflow: auto;
}

.installed-modal-panel--keys {
  padding-top: 4px;
}

.installed-modal-hero {
  margin: auto;
  max-width: 320px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 8px;
}

.installed-modal-hero-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: rgba(var(--fg-rgb), 0.07);
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(var(--fg-rgb), 0.7);
}

.installed-modal-hero-title {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: rgba(var(--fg-rgb), 0.95);
}

.installed-modal-hero-text {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.5);
}

.installed-modal-hero-text strong {
  color: rgba(var(--fg-rgb), 0.78);
  font-weight: 600;
}

.installed-modal-url {
  margin: auto;
  width: min(100%, 380px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px 0;
}

.installed-modal-url-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.55);
}

.installed-modal-url-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.installed-modal-keys-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.installed-modal-keys {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}

.installed-modal-key {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.08);
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.9);
  cursor: pointer;
}

.installed-modal-key:hover {
  background: rgba(var(--fg-rgb), 0.09);
  border-color: rgba(var(--fg-rgb), 0.14);
}

.installed-modal-key-face {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: rgba(var(--fg-rgb), 0.92);
}

.installed-modal-key-label {
  font-size: 11px;
  text-align: center;
  color: rgba(var(--fg-rgb), 0.65);
  line-height: 1.3;
}

.launcher-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(var(--fg-rgb), 0.12);
}

.launcher-ctx {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(24, 24, 28, 0.96);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 8px 20px rgba(var(--shadow-rgb), calc(0.4 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
}
</style>
