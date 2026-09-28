<script setup lang="ts">
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import {
  CATEGORY_ICONS,
  EMOJI_CATEGORIES,
  SKIN_TONES,
  applySkinTone,
  filterEmojis,
  searchAllEmojis,
  type CategoryFilter,
  type EmojiEntry,
} from "./emojiPickerLogic";
import type { EmojiPickerModel } from "./widgets/emojiPicker";

const props = defineProps<{ model: EmojiPickerModel }>();

const instanceId = props.model.instanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const {
  recent,
  search: query,
  searchFocusRequest,
  remember,
} = props.model;

/** Immediate input value (keeps the field responsive). */
/** Debounced query used for filtering (avoids work on every keystroke). */
const debouncedQuery = ref("");
const category = ref<CategoryFilter>("smileys");
const copiedGlyph = ref<string | null>(null);
const toneTarget = ref<EmojiEntry | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let longPressFired = false;

/** Focus the input when the palette opens or selects this widget. */
async function focusSearch() {
  await nextTick();
  const input = searchInput.value;
  if (input && document.activeElement !== input) input.focus();
}

function onKavibayFocusWidget(event: Event) {
  // Surface check keeps the desk card from stealing the caret from the inline view.
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  void focusSearch();
}

watch(
  query,
  (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    // Clear immediately when emptied so browse mode returns without delay.
    if (!value.trim()) {
      debouncedQuery.value = "";
      return;
    }
    searchTimer = setTimeout(() => {
      debouncedQuery.value = value;
    }, 120);
  },
  // Palette actions can set the shared value before this widget mounts.
  { immediate: true },
);

watch(
  searchFocusRequest,
  (request) => {
    if (!request) return;
    // Wait for the palette-triggered widget to be mounted and painted first.
    void focusSearch();
  },
  { immediate: true },
);

/** Visible rows: search-all when typing, else category (or recent). */
const visible = computed((): EmojiEntry[] => {
  const q = debouncedQuery.value.trim();
  if (q) return searchAllEmojis(q);
  return filterEmojis(category.value, "", recent.value);
});

const showRecentRow = computed(
  () => !debouncedQuery.value.trim() && category.value !== "recent" && recent.value.length > 0,
);

/** Copy glyph to clipboard, flash feedback, and remember it. */
async function copyGlyph(glyph: string) {
  try {
    await navigator.clipboard.writeText(glyph);
    copiedGlyph.value = glyph;
    remember(glyph);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedGlyph.value = null;
    }, 900);
  } catch {
    /* clipboard may fail without permission — ignore */
  }
}

/** Close the skin-tone strip. */
function closeTones() {
  toneTarget.value = null;
}

/** Pick a tone for the open skinnable emoji and copy it. */
function pickTone(modifier: string) {
  const entry = toneTarget.value;
  if (!entry) return;
  const glyph = applySkinTone(entry.glyph, modifier);
  closeTones();
  void copyGlyph(glyph);
}

/** Start long-press detection for skinnable emoji. */
function onCellPointerDown(entry: EmojiEntry) {
  longPressFired = false;
  if (longPressTimer) clearTimeout(longPressTimer);
  if (!entry.skinnable) return;

  longPressTimer = setTimeout(() => {
    longPressFired = true;
    toneTarget.value = entry;
  }, 420);
}

/** Cancel long-press timer; copy on short press. */
function onCellPointerUp(entry: EmojiEntry) {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  if (toneTarget.value) return;
  void copyGlyph(entry.glyph);
}

/** Cancel pending long-press when pointer leaves the cell. */
function onCellPointerCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
}

/** Switch category chip (clears tone popover). */
function selectCategory(id: CategoryFilter) {
  category.value = id;
  closeTones();
}

onMounted(() => {
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
});

onUnmounted(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  if (copiedTimer) clearTimeout(copiedTimer);
  if (longPressTimer) clearTimeout(longPressTimer);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="emoji" @pointerdown.stop>
    <input
      ref="searchInput"
      v-model="query"
      class="emoji-search"
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search emoji…"
      aria-label="Search emoji"
      @pointerdown.stop
    />

    <div class="emoji-cats" role="tablist" aria-label="Categories">
      <button
        type="button"
        class="emoji-cat"
        :class="{ 'emoji-cat--active': !debouncedQuery.trim() && category === 'recent' }"
        :disabled="recent.length === 0"
        v-tip="'Recent'"
        @click="selectCategory('recent')"
      >
        {{ CATEGORY_ICONS.recent }}
      </button>
      <button
        v-for="cat in EMOJI_CATEGORIES"
        :key="cat.id"
        type="button"
        class="emoji-cat"
        :class="{ 'emoji-cat--active': !debouncedQuery.trim() && category === cat.id }"
        v-tip="cat.label"
        @click="selectCategory(cat.id)"
      >
        {{ CATEGORY_ICONS[cat.id] }}
      </button>
    </div>

    <div v-if="showRecentRow" class="emoji-section">
      <p class="emoji-section-label">Recent</p>
      <div class="emoji-grid emoji-grid--recent">
        <button
          v-for="glyph in recent.slice(0, 8)"
          :key="'r-' + glyph"
          type="button"
          class="emoji-cell"
          :class="{ 'emoji-cell--copied': copiedGlyph === glyph }"
          :title="glyph"
          @click="copyGlyph(glyph)"
        >
          {{ glyph }}
        </button>
      </div>
    </div>

    <div class="emoji-grid" role="listbox" aria-label="Emoji">
      <button
        v-for="entry in visible"
        :key="entry.glyph + entry.name"
        type="button"
        class="emoji-cell"
        :class="{ 'emoji-cell--copied': copiedGlyph === entry.glyph }"
        :title="entry.name"
        @pointerdown="onCellPointerDown(entry)"
        @pointerup="onCellPointerUp(entry)"
        @pointerleave="onCellPointerCancel"
        @pointercancel="onCellPointerCancel"
      >
        {{ entry.glyph }}
      </button>
      <p v-if="visible.length === 0" class="emoji-empty">No matches</p>
    </div>

    <p v-if="copiedGlyph" class="emoji-status">Copied {{ copiedGlyph }}</p>
    <p v-else class="emoji-hint">Tap to copy · hold for skin tone</p>

    <div
      v-if="toneTarget"
      class="emoji-tones"
      role="dialog"
      aria-label="Skin tone"
    >
      <button
        v-for="tone in SKIN_TONES"
        :key="tone.id"
        type="button"
        class="emoji-tone"
        v-tip="tone.id === 'default' ? 'Default' : 'Skin tone'"
        @click="pickTone(tone.modifier)"
      >
        {{ applySkinTone(toneTarget.glyph, tone.modifier) }}
      </button>
      <DialogCloseButton label="Close skin tones" @click="closeTones" />
    </div>
  </div>
</template>

<style scoped>
.emoji {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Fill the host-sized card body — a fixed px width overflows padding and
   * gets clipped by WidgetCard's overflow:hidden (skin-tone strip included). */
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.emoji-search {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 13px;
  outline: none;
}

.emoji-search:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.emoji-search::placeholder {
  color: rgba(var(--fg-rgb), 0.35);
}

.emoji-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.emoji-cat {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.emoji-cat:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.06);
}

.emoji-cat--active {
  color: #fff;
  background: rgba(var(--fg-rgb), 0.12);
  border-color: rgba(var(--fg-rgb), 0.14);
}

.emoji-cat:disabled {
  opacity: 0.3;
  cursor: default;
}

.emoji-section-label {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.emoji-grid--recent {
  max-height: none;
  overflow: visible;
  margin-bottom: 2px;
}

.emoji-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
}

.emoji-cell:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.emoji-cell--copied {
  background: rgba(var(--fg-rgb), 0.14);
}

.emoji-empty {
  grid-column: 1 / -1;
  margin: 12px 0;
  text-align: center;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.4);
}

.emoji-status,
.emoji-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.4);
  min-height: 14px;
}

.emoji-status {
  color: rgba(var(--fg-rgb), 0.75);
}

.emoji-tones {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 28px;
  box-sizing: border-box;
  display: flex;
  gap: 4px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(20, 20, 24, 0.95);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  /* Above grid/hint; stays inside .emoji so the card does not clip it. */
  z-index: 5;
}

.emoji-tone {
  flex: 1 1 0;
  min-width: 0;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
}

.emoji-tone:hover {
  background: rgba(var(--fg-rgb), 0.1);
}
</style>
