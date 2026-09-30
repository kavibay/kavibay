<script setup lang="ts">
import { computed, ref } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import PaletteWidgetIcon from "../palette/PaletteWidgetIcon.vue";
import { useExtensionsPrefs } from "./useExtensionsPrefs";
import ExtensionDetail from "./ExtensionDetail.vue";
import RuntimeExtensionsPanel from "./RuntimeExtensionsPanel.vue";
import {
  ALL_CATEGORIES,
  extensionCategories,
  filterExtensions,
} from "./extensionsPanelLogic";

const { allExtensions, isEnabled, setEnabled } = useExtensionsPrefs();
const query = ref("");
const selectedCategory = ref(ALL_CATEGORIES);
const tabs = [
  { id: "builtin", label: "Built-in" },
  { id: "my", label: "My extensions" },
] as const;
const activeTab = ref<(typeof tabs)[number]["id"]>("builtin");

function selectTab(index: number, event: KeyboardEvent) {
  activeTab.value = tabs[index]!.id;
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
}

/**
 * The row the pane is opened on, if any. An id rather than the object so the
 * detail keeps following the catalog when it reloads underneath — and so the
 * filters behind it survive a trip into a row and back.
 */
const openedId = ref<string | null>(null);

const extensions = computed(() => allExtensions());
const categories = computed(() => extensionCategories(extensions.value));

/** Null whenever nothing is open, or the open row is no longer in the catalog. */
const opened = computed(
  () => extensions.value.find((ext) => ext.id === openedId.value) ?? null,
);

/** Catalog filtered by a text query and one manifest category. */
const rows = computed(() =>
  filterExtensions(extensions.value, query.value, selectedCategory.value),
);

/** Category dropdown rows, including the unfiltered "all" option. */
const categoryOptions = computed(() => [
  { value: ALL_CATEGORIES, label: "All categories" },
  ...categories.value.map((category) => ({ value: category, label: category })),
]);

/** Toggle one extension on/off. */
function onToggle(typeId: string, e: Event) {
  setEnabled(typeId, (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <div v-if="opened" class="extensions">
    <ExtensionDetail
      :extension="opened"
      :enabled="isEnabled(opened.id)"
      @back="openedId = null"
      @update:enabled="setEnabled(opened.id, $event)"
    />
  </div>

  <div v-else class="extensions extensions--catalog">
    <Teleport to=".settings-sticky">
    <header class="extensions-head">
      <h2 class="extensions-title">Extensions</h2>
      <p class="extensions-lead">
        Disable extensions to hide them from search and the Widgets list. Open widgets
        of a disabled extension are closed until you enable it again.
      </p>
      <div class="extensions-tabs" role="tablist" aria-label="Extension source">
        <button
          v-for="(tab, index) in tabs"
          :id="`extensions-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="extensions-tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`extensions-panel-${tab.id}`"
          :tabindex="activeTab === tab.id ? 0 : -1"
          @click="activeTab = tab.id"
          @keydown.left.prevent="selectTab(1 - index, $event)"
          @keydown.right.prevent="selectTab(1 - index, $event)"
          @keydown.home.prevent="selectTab(0, $event)"
          @keydown.end.prevent="selectTab(1, $event)"
        >{{ tab.label }}</button>
      </div>
    </header>
    </Teleport>

    <section
      v-show="activeTab === 'builtin'"
      id="extensions-panel-builtin"
      class="extensions-block"
      role="tabpanel"
      aria-labelledby="extensions-tab-builtin"
    >
      <div class="extensions-filters">
        <input
          v-model="query"
          type="search"
          class="extensions-search"
          placeholder="Search extensions"
          aria-label="Search extensions"
        />
        <KavibaySelect
          class="extensions-category"
          size="md"
          align="right"
          aria-label="Filter by category"
          :options="categoryOptions"
          :model-value="selectedCategory"
          @update:model-value="selectedCategory = String($event)"
        />
      </div>
      <p class="extensions-count">{{ rows.length }} of {{ extensions.length }}</p>

      <div class="extensions-list" role="list">
        <article
          v-for="ext in rows"
          :key="ext.id"
          class="extensions-row"
          :class="{ 'extensions-row--off': !isEnabled(ext.id) }"
          role="listitem"
        >
          <button type="button" class="extensions-row-open" @click="openedId = ext.id">
            <PaletteWidgetIcon :widget="ext" :size="18" data-icon-tile />
            <span class="extensions-row-text">
              <span class="extensions-row-title">{{ ext.title }}</span>
              <span class="extensions-row-hint">{{ ext.description }}</span>
              <span class="extensions-row-meta">By {{ ext.author }} · v{{ ext.version }}</span>
            </span>
          </button>
          <label class="switch" v-tip="isEnabled(ext.id) ? 'Enabled' : 'Disabled'">
            <input
              type="checkbox"
              :checked="isEnabled(ext.id)"
              :aria-label="`Enable ${ext.title}`"
              @change="onToggle(ext.id, $event)"
            />
            <span class="switch-ui" aria-hidden="true" />
          </label>
        </article>
        <p v-if="rows.length === 0" class="extensions-empty">No extensions match this filter.</p>
      </div>
    </section>

    <RuntimeExtensionsPanel
      v-show="activeTab === 'my'"
      id="extensions-panel-my"
      class="extensions-runtime"
      role="tabpanel"
      aria-labelledby="extensions-tab-my"
    />
  </div>
</template>

<style scoped>
.extensions {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-bottom: 8px;
}

.extensions-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.extensions--catalog {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.extensions-tabs {
  display: flex;
  gap: 4px;
  margin: 12px -32px 0 0;
  padding: 4px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
}

.extensions-tab {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.6);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.extensions-tab:hover {
  color: rgba(var(--fg-rgb), 0.9);
}

.extensions-tab[aria-selected="true"] {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  color: rgba(var(--fg-rgb), 0.95);
}

.extensions-tab:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.extensions-runtime {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.extensions-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.extensions-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.extensions-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.extensions-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168px;
  gap: 8px;
}

.extensions-search {
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.88);
  font: inherit;
  font-size: 13px;
}

.extensions-search::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.extensions-search:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.extensions-category {
  min-width: 0;
}

.extensions-count {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.extensions-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  max-height: calc(14 * 80px + 13 * 6px);
  overflow-y: auto;
}

.extensions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  box-sizing: border-box;
  min-height: 80px;
  flex-shrink: 0;
}

/* The row opens; the switch does not. Two controls, so the toggle keeps
   working without also navigating away from the list it lives in. */
.extensions-row-open {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.extensions-row-open:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 4px;
  border-radius: 8px;
}

.extensions-row:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.extensions-row--off {
  opacity: 0.58;
}

.extensions-row:has(.switch input:focus-visible) {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.extensions-row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.extensions-row-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.extensions-row-hint {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.extensions-row-meta {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.38);
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}

.switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.switch-ui {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
}

.switch-ui::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.85);
}

.switch input:checked + .switch-ui {
  background: rgba(var(--fg-rgb), 0.82);
}

.switch input:checked + .switch-ui::after {
  background: rgb(var(--surface-bg-rgb));
  transform: translateX(16px);
}

.extensions-empty {
  margin: 0;
  padding: 16px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.03);
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 520px) {
  .extensions-filters {
    grid-template-columns: 1fr;
  }
}
</style>
