<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import PaletteSearchActionIcon from "../palette/PaletteSearchActionIcon.vue";
import { SEARCH_ACTIONS } from "../palette/searchActions";
import { getQuickActionModelDefinition } from "./ai/aiApi";
import { useSearchPrefs } from "./useSearchPrefs";
import PaletteWidgetIcon from "../palette/PaletteWidgetIcon.vue";
import { mergePaletteCatalog } from "../palette/paletteResults";
import { useRuntimeExtensions } from "../runtime/useRuntimeExtensions";
import { useExtensionsPrefs } from "./useExtensionsPrefs";
import { usePaletteWidgetPrefs } from "./usePaletteWidgetPrefs";
import { useSettingsModal } from "./useSettingsModal";

const { prefs, enabledActions, setEnabled, move } = useSearchPrefs();
const aiProvider = ref<string>();
const rows = computed(() => prefs.value.map((pref) => ({
  ...SEARCH_ACTIONS.find((action) => action.id === pref.id)!, ...pref,
})));
const { enabledExtensions, isEnabled } = useExtensionsPrefs();
const { enabledHostRefs } = useRuntimeExtensions();
const { selectedIds, setEnabled: setWidgetEnabled, move: moveWidget } = usePaletteWidgetPrefs();
const widgetCatalog = computed(() => mergePaletteCatalog(enabledExtensions.value, enabledHostRefs.value, isEnabled));
const selectedWidgets = computed(() => selectedIds.value.map((id) => ({
  ...(widgetCatalog.value.find((widget) => widget.id === id) ?? { id, title: id }),
  available: widgetCatalog.value.some((widget) => widget.id === id),
})));
const widgetFilter = ref("");
const widgetRows = computed(() => [
  ...selectedWidgets.value.map((widget, index) => ({ ...widget, enabled: true, index })),
  ...widgetCatalog.value.filter((widget) => !selectedIds.value.includes(widget.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((widget) => ({ ...widget, available: true, enabled: false, index: -1 })),
].filter((widget) => `${widget.title} ${widget.id}`.toLowerCase().includes(widgetFilter.value.trim().toLowerCase())));
const { searchPart } = useSettingsModal();
const widgetSection = ref<HTMLElement | null>(null);
const widgetFilterInput = ref<HTMLInputElement | null>(null);

/** Opened from the palette's shortcut row: land on the shortcut list. */
watch(searchPart, async (part) => {
  if (part !== "widgets") return;
  searchPart.value = null;
  await nextTick();
  widgetSection.value?.scrollIntoView({ block: "start" });
  widgetFilterInput.value?.focus({ preventScroll: true });
}, { immediate: true });

onMounted(async () => {
  try { aiProvider.value = (await getQuickActionModelDefinition())?.credentialType; }
  catch { /* The generic AI icon remains usable before a provider is configured. */ }
});
</script>

<template>
  <div class="search-settings">
    <Teleport to=".settings-sticky">
    <header>
      <h2>Search</h2>
      <p class="lead">Choose shortcuts for an empty search and actions when there are no matches.</p>
      <!-- The palette with no matches, in the live glass: its search actions in order. -->
      <div class="glass-stage" aria-hidden="true">
        <!-- Mirrors CommandPalette's input row and status bar; sizes follow its styles. -->
        <div class="mini-palette">
          <div class="mini-input-row">
            <span class="mini-query">hello wo<span class="mini-caret" /></span>
            <span class="mini-actions">
              <span v-for="id in enabledActions" :key="id" class="mini-action">
                <PaletteSearchActionIcon :action="id" :ai-provider="aiProvider" />
              </span>
            </span>
          </div>
          <div class="mini-statusbar">
            <span class="mini-bar-btn">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <path d="M17.5 14v7M14 17.5h7" stroke-linecap="round" />
              </svg>
              Widgets
            </span>
            <span class="mini-desk-tab">Home</span>
          </div>
        </div>
      </div>
    </header>
    </Teleport>
    <section aria-labelledby="search-actions-heading">
      <h3 id="search-actions-heading">Search actions</h3>
      <p class="hint">Show the actions you use. Move them up or down to set their order from left to right.</p>
      <ol class="action-list" aria-label="Search actions">
        <li v-for="(row, index) in rows" :key="row.id" class="action-row">
          <PaletteSearchActionIcon :action="row.id" :ai-provider="aiProvider" />
          <label class="action-toggle">
            <span class="action-copy">
              <span class="action-name">{{ row.label }} <span class="destination">{{ row.id === 'ai' ? 'API' : 'Browser' }}</span></span>
              <span class="hint">{{ row.description }}</span>
            </span>
            <span class="switch">
              <input type="checkbox" :aria-label="`Show ${row.label}`" :checked="row.enabled" @change="setEnabled(row.id, ($event.target as HTMLInputElement).checked)" />
              <span class="switch-ui" />
            </span>
          </label>
          <div class="reorder">
            <button type="button" :aria-label="`Move ${row.label} up`" :title="`Move ${row.label} left`" :disabled="index === 0" @click="move(row.id, -1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
            </button>
            <button type="button" :aria-label="`Move ${row.label} down`" :title="`Move ${row.label} right`" :disabled="index === rows.length - 1" @click="move(row.id, 1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </li>
      </ol>
      <p class="hint">Tab selects the first visible action, then the next. Enter runs it.</p>
    </section>
    <section ref="widgetSection" aria-labelledby="widget-shortcuts-heading">
      <h3 id="widget-shortcuts-heading">Widget shortcuts</h3>
      <p class="hint">Show these icons when the search field is empty. Choose from your enabled widgets and set their order from left to right.</p>
      <div class="preview" role="group" aria-label="Widget shortcut order preview">
        <span class="preview-label">Left to right</span>
        <span v-for="widget in selectedWidgets.filter((widget) => widget.available)" :key="widget.id" :aria-label="widget.title" :title="widget.title" class="preview-icon" role="img">
          <PaletteWidgetIcon :widget="widget" :size="18" data-icon-tile />
        </span>
        <span v-if="!selectedWidgets.some((widget) => widget.available)" class="hint">No widget shortcuts shown</span>
      </div>
      <input ref="widgetFilterInput" v-model="widgetFilter" type="search" class="widget-filter" placeholder="Find widgets…" aria-label="Find widget shortcuts" />
      <ol class="action-list widget-list" aria-label="Widget shortcuts">
        <li v-for="row in widgetRows" :key="row.id" class="action-row">
          <PaletteWidgetIcon :widget="row" :size="18" data-icon-tile />
          <label class="action-toggle">
            <span class="action-copy">
              <span class="action-name">{{ row.title }}</span>
              <span v-if="!row.available" class="hint">Unavailable · enable this widget to show its icon</span>
            </span>
            <span class="switch">
              <input type="checkbox" :aria-label="`Show ${row.title} shortcut`" :checked="row.enabled" @change="setWidgetEnabled(row.id, ($event.target as HTMLInputElement).checked)" />
              <span class="switch-ui" />
            </span>
          </label>
          <div class="reorder">
            <button type="button" :aria-label="`Move ${row.title} shortcut up`" :title="`Move ${row.title} left`" :disabled="row.index <= 0" @click="moveWidget(row.id, -1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
            </button>
            <button type="button" :aria-label="`Move ${row.title} shortcut down`" :title="`Move ${row.title} right`" :disabled="row.index < 0 || row.index === selectedIds.length - 1" @click="moveWidget(row.id, 1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </li>
      </ol>
      <p v-if="!widgetRows.length" class="hint">No widgets found</p>
      <p class="hint">Tab previews the first widget, then the next. Enter or ↓ moves into it. Escape returns to search.</p>
    </section>
  </div>
</template>

<style scoped>
.search-settings { display: flex; flex-direction: column; gap: 28px; color: var(--text); }
h2 { margin: 0; font-size: 22px; font-weight: 600; }
h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.lead { margin: 8px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
.hint { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
p.hint { margin: 8px 0 14px; }
.glass-stage { display: grid; place-items: center; height: 150px; margin-top: 12px; border-radius: 14px; background: #16181d url("../assets/share-canvas/nebula.png") center / cover; }
/* The palette's own glass (see .palette-surface), so Appearance changes show here too. */
.mini-palette { width: min(620px, 72%); overflow: hidden; border: 1px solid var(--surface-border, var(--border)); border-radius: var(--surface-radius, 16px); corner-shape: var(--surface-corner-shape, round); background: var(--surface-sheen, linear-gradient(transparent, transparent)), rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72)); box-shadow: var(--surface-box-shadow), var(--surface-inner-highlight, 0 0 transparent); backdrop-filter: var(--surface-backdrop-filter, blur(16px)); }
.mini-input-row { display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid var(--border); }
.mini-query { flex: 1; min-width: 0; padding: 18px 0; color: rgba(var(--fg-rgb), 0.95); font-size: 15px; white-space: nowrap; }
.mini-caret { display: inline-block; width: 1px; height: 1.1em; margin-left: 1px; vertical-align: -0.2em; background: currentColor; }
.preview { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; min-height: 42px; padding: 8px 14px; border-radius: 10px; background: var(--inset-bg); }
.preview-label { margin-right: auto; color: var(--text-muted); font-size: 12px; }
.preview-icon { display: grid; place-items: center; }
.mini-actions { display: flex; flex: none; gap: 8px; }
.mini-action { display: grid; place-items: center; width: 36px; height: 36px; }
.mini-statusbar { position: relative; display: flex; align-items: center; min-height: 28px; padding: 8px 10px; background: var(--bar-bg); box-shadow: var(--bar-top-highlight, 0 0 transparent); }
.mini-bar-btn { display: inline-flex; align-items: center; gap: 9px; height: 28px; padding: 0 12px; color: var(--text-muted); font-size: 13px; font-weight: 500; }
.mini-bar-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }
.mini-desk-tab { position: absolute; left: 50%; display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; corner-shape: var(--surface-corner-shape, round); background: var(--fill-hover); color: var(--text); font-size: 13px; font-weight: 500; transform: translateX(-50%); }
.action-list { list-style: none; padding: 0; margin: 16px 0; }
.action-row { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.action-row > :first-child { flex-shrink: 0; }
.widget-filter { box-sizing: border-box; width: 100%; margin-top: 16px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--inset-bg); color: var(--text); font: inherit; font-size: 13px; }
.widget-list { max-height: 360px; overflow-y: auto; }
.action-toggle { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; cursor: pointer; }
.action-copy { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.action-name { font-size: 13px; font-weight: 600; }
.destination { display: inline-block; margin-left: 5px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 10px; font-weight: 400; }
.switch { flex-shrink: 0; }
.reorder { display: flex; gap: 4px; }
.reorder button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--text); background: var(--fill); cursor: pointer; }
.reorder button:hover:not(:disabled) { background: var(--fill-hover); }
.reorder button:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
.reorder button:disabled { opacity: 0.25; cursor: default; }
.reorder svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
</style>
