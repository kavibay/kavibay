<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { isValidImageUrl } from "./imageLogic";
import type { ImageModel } from "./widgets/image";

const props = defineProps<{ model: ImageModel }>();
const { state, error, setError, setFile, setUrl, clear } = props.model;

const menuOpen = ref(false);
const urlMode = ref(false);
const urlDraft = ref("");
const urlError = ref<string | null>(null);
const loadError = ref(false);
const dragOver = ref(false);
const rootEl = ref<HTMLElement | null>(null);

/** Keep local overlay state; the host observes the `data-interactive` surface. */
let overlayPausedHere = false;

/** Pause OS click-through while the image menu needs reliable pointer events. */
function setOverlayClickThrough(paused: boolean) {
  if (paused === overlayPausedHere) return;
  overlayPausedHere = paused;
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

const displaySrc = computed(() => {
  if (state.value.source === "file" && state.value.path) {
    return props.model.imageUrl(state.value.path);
  }
  if (state.value.source === "url" && state.value.url) {
    return state.value.url;
  }
  return null;
});

const isFilled = computed(() => displaySrc.value != null);

/** Fill the host card when sized; otherwise use persisted widget state. */
const rootStyle = computed(() =>
  ({ width: "100%", height: "100%" }),
);

/** Open/close the + / Change popover. */
function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) {
    urlMode.value = false;
    urlDraft.value = "";
    urlError.value = null;
  }
}

/** Show URL input inside the popover. */
function startUrl() {
  urlMode.value = true;
  urlDraft.value = state.value.source === "url" ? state.value.url ?? "" : "";
  urlError.value = null;
}

/** Import a local path into app data and display it. */
async function importPath(sourcePath: string) {
  try {
    const dest = await props.model.importPath(sourcePath);
    setFile(dest);
    loadError.value = false;
    setError(null);
  } catch (e) {
    setError(errorMessage(e, "Import failed"));
  }
}

/** Pick a local image and import into app data. */
async function pickUpload() {
  menuOpen.value = false;
  urlMode.value = false;
  try {
    const sourcePath = await props.model.pick();
    if (!sourcePath) return;
    await importPath(sourcePath);
  } catch (e) {
    setError(errorMessage(e, "Could not open image dialog"));
  }
}

/** Confirm URL from draft. */
async function confirmUrl() {
  if (!isValidImageUrl(urlDraft.value)) {
    urlError.value = "Invalid URL";
    return;
  }
  const url = urlDraft.value.trim();
  if (state.value.source === "file") {
    try {
      await props.model.clearFile();
    } catch {
      /* still switch to URL */
    }
  }
  setUrl(url);
  loadError.value = false;
  menuOpen.value = false;
  urlMode.value = false;
  urlDraft.value = "";
  urlError.value = null;
}

/** Clear image and delete local file if any. */
async function onRemove() {
  if (state.value.source === "file") {
    try {
      await props.model.clearFile();
    } catch (e) {
      setError(errorMessage(e, "Delete failed"));
    }
  }
  clear();
  loadError.value = false;
  menuOpen.value = false;
}

function onImgError() {
  loadError.value = true;
}

function onImgLoad() {
  loadError.value = false;
}

function onDocPointerDown(e: PointerEvent) {
  const t = e.target as Node | null;
  if (rootEl.value && t && !rootEl.value.contains(t)) {
    menuOpen.value = false;
    urlMode.value = false;
  }
}

/** Only listen while the menu/url form needs outside-click dismissal. */
let docListening = false;

/** Attach/detach document pointerdown when image overlays open/close. */
function syncDocListeners() {
  const need = menuOpen.value || urlMode.value;
  if (need === docListening) return;
  if (need) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
  }
  docListening = need;
}

// Keep click-through paused while the popover is open; re-report interactive rects.
watch([menuOpen, urlMode], async () => {
  setOverlayClickThrough(menuOpen.value || urlMode.value);
  syncDocListeners();
  await nextTick();
});

onUnmounted(() => {
  setOverlayClickThrough(false);
  if (docListening) {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    docListening = false;
  }
});
</script>

<template>
  <div
    ref="rootEl"
    class="image-widget"
    :class="{
      'image-widget--drop': dragOver,
      'image-widget--framed': state.variant === 'framed',
    }"
    :style="rootStyle"
    data-interactive
  >
    <p v-if="error" class="image-error">{{ error }}</p>

    <!-- Empty: only the + stops drag; the rest of the area moves the widget -->
    <div v-if="!isFilled" class="image-empty">
      <button
        type="button"
        class="image-plus"
        aria-label="Add image"
        @pointerdown.stop
        @click="toggleMenu"
      >
        +
      </button>
    </div>

    <!-- Filled: drag on the image; stop only on action buttons -->
    <div v-else class="image-frame">
      <img
        v-if="!loadError"
        class="image-img"
        :src="displaySrc!"
        alt=""
        draggable="false"
        @error="onImgError"
        @load="onImgLoad"
      />
      <div v-else class="image-broken">
        <span>Image failed to load</span>
      </div>
      <div class="image-hover">
        <button
          type="button"
          class="image-hover-btn"
          @pointerdown.stop
          @click="toggleMenu"
        >
          Change
        </button>
        <button
          type="button"
          class="image-hover-btn image-hover-btn--danger"
          @pointerdown.stop
          @click="onRemove"
        >
          Remove
        </button>
      </div>
    </div>

    <!-- Popover -->
    <div v-if="menuOpen" class="image-menu" data-interactive @pointerdown.stop>
      <template v-if="!urlMode">
        <button type="button" class="image-menu-item" @click="pickUpload">Upload…</button>
        <button type="button" class="image-menu-item" @click="startUrl">URL…</button>
      </template>
      <template v-else>
        <input
          v-model="urlDraft"
          class="image-url-input"
          type="url"
          placeholder="https://…"
          aria-label="Image URL"
          @keydown.enter.prevent="confirmUrl"
        />
        <p v-if="urlError" class="image-url-error">{{ urlError }}</p>
        <div class="image-url-actions">
          <button type="button" class="image-menu-item" @click="confirmUrl">OK</button>
          <button
            type="button"
            class="image-menu-item"
            @click="urlMode = false; urlError = null"
          >
            Cancel
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.image-widget {
  position: relative;
  box-sizing: border-box;
  min-width: 120px;
  min-height: 80px;
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
  overflow: hidden;
}

/*
 * Flush media reaches the card edge and otherwise paints over the host's
 * surface border. Own the edge here so all four corners use the same curve.
 * The framed variant already has its own inset frame and stays unchanged.
 */
.image-widget:not(.image-widget--framed) {
  border: 1px solid var(--surface-border, var(--border));
  border-radius: var(--surface-radius, 16px);
  corner-shape: var(--surface-corner-shape, round);
}

.image-widget:not(.image-widget--framed) .image-frame,
.image-widget:not(.image-widget--framed) .image-img {
  border-radius: calc(var(--surface-radius, 16px) - 1px);
  corner-shape: var(--surface-corner-shape, round);
}

.image-widget--drop {
  outline: 2px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -2px;
}

.image-widget--framed {
  padding: 10px;
  background: rgb(var(--surface-bg-rgb));
}

.image-widget--framed .image-frame,
.image-widget--framed .image-empty {
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: calc(var(--surface-radius, 16px) - 8px);
  corner-shape: inherit;
}

.image-widget--framed .image-frame {
  box-shadow: 0 4px 14px rgba(var(--shadow-rgb), 0.24);
}

.image-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border: 1px dashed rgba(var(--fg-rgb), 0.22);
  background: rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  cursor: grab;
}

.image-plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin: 0;
  padding: 0;
  border: 1px dashed rgba(var(--fg-rgb), 0.28);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(var(--fg-rgb), 0.65);
  font-size: 36px;
  line-height: 1;
  cursor: pointer;
}

.image-plus:hover {
  border-color: rgba(var(--fg-rgb), 0.45);
  color: rgba(var(--fg-rgb), 0.9);
}

.image-frame {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  corner-shape: inherit;
  overflow: hidden;
  background: transparent;
  cursor: grab;
}

.image-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  corner-shape: inherit;
  user-select: none;
}

.image-broken {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 12px;
  line-height: 1.3;
}

.image-hover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
  opacity: 0;
  z-index: 2;
  transition: opacity 0.15s ease;
}

.image-frame:hover .image-hover {
  opacity: 1;
}

.image-hover-btn {
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(var(--surface-bg-rgb), 0.9);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 12px;
  cursor: pointer;
}

.image-hover-btn--danger {
  color: #f87171;
}

.image-menu {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(var(--surface-bg-rgb), 0.95);
  box-shadow: 0 8px 24px rgba(var(--shadow-rgb), calc(0.4 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  line-height: normal;
}

.image-menu-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.image-menu-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.image-url-input {
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.15);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 13px;
  outline: none;
}

.image-url-error {
  margin: 0 0 6px;
  font-size: 11px;
  color: #f87171;
}

.image-url-actions {
  display: flex;
  gap: 4px;
}

.image-error {
  position: absolute;
  left: 8px;
  right: 24px;
  top: 8px;
  z-index: 3;
  margin: 0;
  font-size: 11px;
  line-height: 1.3;
  color: #f87171;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
</style>
