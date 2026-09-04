<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  type Component,
} from "vue";
import {
  BlocksIcon,
  FolderIcon,
  KeyRoundIcon,
  MousePointerClickIcon,
  PaletteIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
} from "@sdk/icons";
import ResizeEdges from "../host/ResizeEdges.vue";
import { RESIZE_EDGES_NO_TOP } from "../host/resizeLogic";
import {
  setClickThroughPaused,
  syncInteractiveRegions,
} from "../system/clickThrough";
import AiPanel from "./ai/AiPanel.vue";
import AppearancePanel from "./AppearancePanel.vue";
import BehaviorPanel from "./BehaviorPanel.vue";
import CredentialsPanel from "./credentials/CredentialsPanel.vue";
import ExtensionsPanel from "./ExtensionsPanel.vue";
import FilesFoldersPanel from "./FilesFoldersPanel.vue";
import McpServerPanel from "./McpServerPanel.vue";
import {
  filterSettingsNav,
  flattenNavGroups,
  SETTINGS_NAV_GROUPS,
  stepNavSelection,
} from "./settingsNav";
import {
  clampSettingsGeometry,
  DEFAULT_SETTINGS_CLAMPS,
  resolveSettingsGeometry,
  saveSettingsGeometry,
  type SettingsGeometry,
} from "./settingsGeometry";
import { useSettingsModal, type SettingsSectionId } from "./useSettingsModal";

const { open, section: activeSection, hide } = useSettingsModal();
const searchInputEl = ref<HTMLInputElement | null>(null);
const modalEl = ref<HTMLElement | null>(null);

/** Nav filter text. Never persisted — every visit starts on the full list. */
const navQuery = ref("");

/** Icons live here, not in the nav data, so the data file stays runnable by tsx. */
const sectionIcons: Record<SettingsSectionId, Component> = {
  appearance: PaletteIcon,
  behavior: MousePointerClickIcon,
  files: FolderIcon,
  extensions: BlocksIcon,
  ai: SparklesIcon,
  credentials: KeyRoundIcon,
  mcp: ServerIcon,
};

const navGroups = computed(() => filterSettingsNav(SETTINGS_NAV_GROUPS, navQuery.value));

const geo = reactive<SettingsGeometry>(resolveSettingsGeometry());
/** Center at resize pointer-down — deltaOffset is relative to this baseline. */
let resizeStartCenter: { cx: number; cy: number } | null = null;

/** Center-anchored position + size for the dialog shell. */
const modalStyle = computed(() => ({
  left: `${geo.cx}px`,
  top: `${geo.cy}px`,
  width: `${geo.width}px`,
  height: `${geo.height}px`,
}));

/** Switch left-nav section. */
function setSection(id: SettingsSectionId) {
  activeSection.value = id;
}

/**
 * Arrows walk the filtered nav and Enter opens the top hit, so a section can be
 * reached without the hand leaving the search field.
 */
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = stepNavSelection(
      navGroups.value,
      activeSection.value,
      event.key === "ArrowDown" ? 1 : -1,
    );
    if (next) setSection(next.id);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const first = flattenNavGroups(navGroups.value)[0];
    if (first) setSection(first.id);
  }
}

/** Persist clamped geometry after move/resize. */
function persistGeometry() {
  const next = clampSettingsGeometry({ ...geo });
  geo.cx = next.cx;
  geo.cy = next.cy;
  geo.width = next.width;
  geo.height = next.height;
  saveSettingsGeometry(next);
  void nextTick().then(() => syncInteractiveRegions());
}

/** Close when pointer hits the backdrop (not the panel). */
function onBackdropPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) hide();
}

/** Drag the dialog from the top strip (center-anchored). */
function onMovePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const originCx = geo.cx;
  const originCy = geo.cy;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);

  /** Follow the pointer; clamp live so the dialog stays on-screen. */
  function onMove(ev: PointerEvent) {
    const next = clampSettingsGeometry({
      ...geo,
      cx: originCx + (ev.clientX - startX),
      cy: originCy + (ev.clientY - startY),
    });
    geo.cx = next.cx;
    geo.cy = next.cy;
  }

  /** Persist and release capture. */
  function onUp(ev: PointerEvent) {
    target.releasePointerCapture(ev.pointerId);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
    persistGeometry();
  }

  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

/** Live resize via shared edge handles (center offset keeps opposite edge fixed). */
function onResize(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
}) {
  if (!resizeStartCenter) {
    resizeStartCenter = { cx: geo.cx, cy: geo.cy };
  }
  const next = clampSettingsGeometry({
    cx: resizeStartCenter.cx + payload.deltaOffset.x,
    cy: resizeStartCenter.cy + payload.deltaOffset.y,
    width: payload.width,
    height: payload.height,
  });
  geo.cx = next.cx;
  geo.cy = next.cy;
  geo.width = next.width;
  geo.height = next.height;
}

/** Persist size after a resize gesture. */
function onResizeEnd() {
  resizeStartCenter = null;
  persistGeometry();
}

/** Esc closes settings before App.vue hides the window. */
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  // One step back per press: a typed filter first, then the dialog. Closing
  // straight from a filtered nav loses the search with no way to see it again.
  if (navQuery.value.length > 0) {
    navQuery.value = "";
    return;
  }
  hide();
}

/** Re-clamp when the Kavibay window size changes. */
function onWindowResize() {
  if (!open.value) return;
  const next = clampSettingsGeometry({ ...geo });
  geo.cx = next.cx;
  geo.cy = next.cy;
  geo.width = next.width;
  geo.height = next.height;
}

watch(open, async (isOpen) => {
  setClickThroughPaused(isOpen);
  if (isOpen) {
    navQuery.value = "";
    const next = resolveSettingsGeometry();
    geo.cx = next.cx;
    geo.cy = next.cy;
    geo.width = next.width;
    geo.height = next.height;
  }
  await nextTick();
  // Move keyboard focus out of the command palette when settings opens — into
  // the search field, which is what the first keystroke is most likely for.
  if (isOpen) searchInputEl.value?.focus();
  syncInteractiveRegions();
});

onMounted(() => {
  document.addEventListener("keydown", onDocumentKeydown, true);
  window.addEventListener("resize", onWindowResize);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true);
  window.removeEventListener("resize", onWindowResize);
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div
    v-if="open"
    class="settings-backdrop"
    data-interactive
    @pointerdown="onBackdropPointerDown"
  >
    <div
      ref="modalEl"
      class="settings-modal"
      data-interactive
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      :style="modalStyle"
      @pointerdown.stop
    >
      <ResizeEdges
        :width="geo.width"
        :height="geo.height"
        :measure-el="modalEl"
        :clamps="DEFAULT_SETTINGS_CLAMPS"
        :edges="RESIZE_EDGES_NO_TOP"
        @resize="onResize"
        @resize-end="onResizeEnd"
      />
      <!-- 12px strip (6px outside + 6px inside) — same pattern as palette/widgets. -->
      <div
        class="settings-drag"
        data-interactive
        role="button"
        aria-label="Move settings"
        @pointerdown="onMovePointerDown"
      />
      <div class="settings-modal-inner">
        <aside class="settings-nav">
          <div class="settings-search">
            <SearchIcon class="settings-search-icon" :size="14" />
            <input
              ref="searchInputEl"
              v-model="navQuery"
              class="settings-search-input"
              type="text"
              placeholder="Search settings…"
              autocomplete="off"
              spellcheck="false"
              aria-label="Search settings"
              @keydown="onSearchKeydown"
            />
          </div>
          <template v-for="group in navGroups" :key="group.label">
            <div class="settings-nav-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="settings-nav-item"
              :class="{ 'settings-nav-item--active': activeSection === item.id }"
              data-icon-motion
              @click="setSection(item.id)"
            >
              <component
                :is="sectionIcons[item.id]"
                class="settings-nav-icon"
                :size="16"
                animated
              />
              {{ item.label }}
            </button>
          </template>
          <p v-if="navGroups.length === 0" class="settings-nav-empty">
            Nothing matches “{{ navQuery }}”.
          </p>
        </aside>
        <section class="settings-content">
          <button
            type="button"
            class="settings-close"
            aria-label="Close settings"
            @click="hide"
          >
            ×
          </button>
          <div class="settings-body">
            <AppearancePanel v-if="activeSection === 'appearance'" />
            <BehaviorPanel v-else-if="activeSection === 'behavior'" />
            <FilesFoldersPanel v-else-if="activeSection === 'files'" />
            <ExtensionsPanel v-else-if="activeSection === 'extensions'" />
            <AiPanel v-else-if="activeSection === 'ai'" />
            <CredentialsPanel v-else-if="activeSection === 'credentials'" />
            <McpServerPanel v-else-if="activeSection === 'mcp'" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.35);
}

.settings-modal {
  position: absolute;
  /* Center-anchored so ResizeEdges deltaOffset matches widgets/palette. */
  transform: translate(-50%, -50%);
  z-index: 1;
  pointer-events: auto;
  /* Handles sit a few px outside — do not clip them. */
  overflow: visible;
}

.settings-modal-inner {
  display: flex;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  /* Opaque on purpose: Settings is a reading surface, and the widgets it
     configures sit right behind it. No backdrop-filter — nothing to blur. */
  background: rgb(var(--surface-bg-rgb));
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: var(--surface-box-shadow);
  overflow: hidden;
}

.settings-drag {
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  z-index: 7;
  height: 12px;
  border-radius: 16px 16px 0 0;
  background: transparent;
  cursor: grab;
  touch-action: none;
}

.settings-drag:active {
  cursor: grabbing;
}

.settings-nav {
  width: 220px;
  flex-shrink: 0;
  padding: 16px 10px;
  border-right: 1px solid rgba(var(--fg-rgb), 0.1);
  background: rgba(0, 0, 0, 0.18);
  overflow-y: auto;
}

.settings-search {
  position: relative;
  margin-bottom: 4px;
}

.settings-search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: rgba(var(--fg-rgb), 0.4);
  pointer-events: none;
}

.settings-search-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 10px 8px 30px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 13px;
  outline: none;
}

.settings-search-input::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.settings-search-input:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.settings-nav-empty {
  margin: 0;
  padding: 8px 10px;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 12px;
}

.settings-nav-label {
  padding: 4px 10px 6px;
  margin-top: 14px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

/* The heading under the search box sits close to it; the rest need the gap. */
.settings-search + .settings-nav-label {
  margin-top: 6px;
}

.settings-nav-group-label {
  padding: 4px 10px 6px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.35);
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 30px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.75);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.settings-nav-icon {
  flex: none;
}

.settings-nav-item--nested {
  padding-left: 18px;
}

/* Same lift the palette uses for the current result row. */
.settings-nav-item--active,
.settings-nav-item:hover,
.settings-nav-item:focus-visible {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  color: rgba(var(--fg-rgb), 0.95);
}

.settings-nav-item:focus-visible {
  outline: none;
}

/* One sheen at a time: hovering (or focusing) another row takes the lift off
   the open section, the way the palette follows the pointer. */
.settings-nav:has(.settings-nav-item:hover, .settings-nav-item:focus-visible)
  .settings-nav-item--active:not(:hover):not(:focus-visible) {
  background: transparent;
  box-shadow: none;
  color: rgba(var(--fg-rgb), 0.75);
}

.settings-content {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.settings-body {
  flex: 1;
  min-height: 0;
  padding: 24px 16px 24px 28px;
  overflow-y: auto;
}

.settings-close {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 2;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.settings-close:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
