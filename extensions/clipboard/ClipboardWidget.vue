<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import { ClipboardCopyIcon, EyeClosedIcon, EyeIcon, FolderIcon, Trash2Icon } from "@sdk/icons";
import { fileName, type ClipboardEntry } from "./clipboardLogic";
import type { ClipboardModel } from "./widgets/clipboard";

const props = defineProps<{ model: ClipboardModel }>();
const model = props.model;

const injectedInstanceId = inject<string>("widgetInstanceId");
if (!injectedInstanceId) throw new Error("widgetInstanceId missing");
const instanceId: string = injectedInstanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const { entries, error, loading, copiedId, restore, setRevealed, remove } = model;
const selectedId = ref<string | null>(null);
const rootEl = ref<HTMLElement | null>(null);
const shouldFocusFirstRow = ref(false);
const empty = computed(() => !loading.value && entries.value.length === 0);
const selectedEntry = computed(
  () => entries.value.find((entry) => entry.id === selectedId.value) ?? entries.value[0] ?? null,
);

const brokenImages = reactive(new Set<string>());

function imageSrc(entry: ClipboardEntry): string | null {
  if (!entry.imagePath || brokenImages.has(entry.id)) return null;
  try {
    return model.imageUrl(entry.imagePath);
  } catch {
    return null;
  }
}

function onImageError(entry: ClipboardEntry) {
  brokenImages.add(entry.id);
}

function onEyeClick(entry: ClipboardEntry) {
  void setRevealed(entry.id, !entry.revealed);
}

function removeSelected() {
  if (!selectedEntry.value) return;
  const id = selectedEntry.value.id;
  selectedId.value = null;
  void remove(id);
}

function selectEntry(entry: ClipboardEntry) {
  selectedId.value = entry.id;
}

function copySelected() {
  const entry = selectedEntry.value;
  if (!entry) return;
  void restore(entry.id);
}

function copiedAt(entry: ClipboardEntry): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(entry.createdAt),
  );
}

function kindLabel(entry: ClipboardEntry): string {
  if (entry.kind === "text") return "Text";
  if (entry.kind === "image") return "Image";
  return (entry.filePaths?.length ?? 0) === 1 ? "File" : "Files";
}

async function focusWidget() {
  shouldFocusFirstRow.value = true;
  if (entries.value[0]) selectedId.value = entries.value[0].id;
  await nextTick();
  // The first row is the natural keyboard entry point: it makes ↑/↓ usable
  // immediately and keeps the visible selection aligned with browser focus.
  const firstRow = rootEl.value?.querySelector<HTMLButtonElement>(".clip-row");
  if (!firstRow) return;
  firstRow.focus();
  shouldFocusFirstRow.value = false;
}

function onKavibayFocusWidget(event: Event) {
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  void focusWidget();
}

function onKeydown(event: KeyboardEvent) {
  if (entries.value.length === 0) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    (event.code === "KeyC" || event.key.toLowerCase() === "c")
  ) {
    if (!selectedEntry.value) return;
    event.preventDefault();
    event.stopPropagation();
    copySelected();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const currentIndex = Math.max(
    0,
    entries.value.findIndex((entry) => entry.id === selectedEntry.value?.id),
  );
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, entries.value.length - 1);
  if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
  if (nextIndex !== null) {
    event.preventDefault();
    event.stopPropagation();
    selectedId.value = entries.value[nextIndex]!.id;
    void nextTick().then(() => {
      const selectedRow = rootEl.value?.querySelector<HTMLButtonElement>(".clip-row.is-selected");
      selectedRow?.focus({ preventScroll: true });
      selectedRow?.scrollIntoView({ block: "nearest" });
    });
    return;
  }
  if (event.key === "Enter" && selectedEntry.value) {
    event.preventDefault();
    event.stopPropagation();
    void restore(selectedEntry.value.id);
  }
}

onMounted(() => window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget));
onBeforeUnmount(() => window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget));

// Clipboard data may arrive after the palette requested focus; complete it as
// soon as the first row has rendered instead of leaving focus in the search box.
watch(entries, () => {
  if (shouldFocusFirstRow.value && entries.value.length > 0) void focusWidget();
});
</script>

<template>
  <div ref="rootEl" class="clip" tabindex="0" @keydown.capture="onKeydown">
    <p v-if="error" class="clip-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="clip-muted">Loading…</p>
    <p v-else-if="empty" class="clip-muted">Copy something to start</p>

    <div v-if="entries.length > 0" class="clip-history">
      <ul class="clip-list" aria-label="Clipboard history" @wheel.stop>
        <li v-for="entry in entries" :key="entry.id">
          <button
            type="button"
            class="clip-row"
            :class="{ 'is-selected': selectedEntry?.id === entry.id, 'is-copied': copiedId === entry.id }"
            @click="selectEntry(entry)"
            @focus="selectEntry(entry)"
            @dblclick="restore(entry.id)"
          >
            <span class="clip-row-icon" :class="`clip-row-icon--${entry.kind}`">
              <FolderIcon v-if="entry.kind === 'file'" :size="14" />
              <template v-else>{{ entry.kind === "text" ? "Aa" : "▧" }}</template>
            </span>
            <span class="clip-copy">
              <span class="clip-text" :class="{ masked: !entry.revealed }">
                {{ model.displayText(entry) || "Image" }}
              </span>
              <span class="clip-time">{{ copiedAt(entry) }}</span>
            </span>
            <span
              v-if="entry.sourceApp"
              class="clip-source-app"
              :title="`Copied from ${entry.sourceApp.name}`"
            >
              <img
                v-if="model.sourceIcon(entry)"
                class="clip-source-icon"
                :src="model.sourceIcon(entry)!"
                alt=""
              />
            </span>
          </button>
        </li>
      </ul>

      <section v-if="selectedEntry" class="clip-detail" aria-label="Selected clipboard entry">
        <div class="clip-detail-head">
          <span>{{ kindLabel(selectedEntry) }}</span>
          <span>{{ copiedAt(selectedEntry) }}</span>
        </div>
        <div class="clip-detail-preview">
          <p
            v-if="selectedEntry.kind === 'text'"
            class="clip-detail-text"
            :class="{ masked: !selectedEntry.revealed }"
          >
            {{ selectedEntry.revealed ? selectedEntry.text : "••••••" }}
          </p>
          <template v-else-if="selectedEntry.kind === 'image'">
            <div v-if="!selectedEntry.revealed" class="clip-detail-mask">Image preview hidden</div>
            <img
              v-else-if="imageSrc(selectedEntry)"
              class="clip-detail-image"
              :src="imageSrc(selectedEntry)!"
              alt="Clipboard image"
              @error="onImageError(selectedEntry)"
            />
            <div v-else class="clip-detail-mask">Image unavailable</div>
          </template>
          <div v-else-if="!selectedEntry.revealed" class="clip-detail-mask">
            File references hidden
          </div>
          <img
            v-else-if="imageSrc(selectedEntry)"
            class="clip-detail-image"
            :src="imageSrc(selectedEntry)!"
            :alt="model.displayText(selectedEntry)"
            @error="onImageError(selectedEntry)"
          />
          <ul v-else class="clip-detail-files">
            <li v-for="path in selectedEntry.filePaths ?? []" :key="path">
              <strong>{{ fileName(path) }}</strong>
              <span>{{ path }}</span>
            </li>
          </ul>
        </div>
        <div class="clip-detail-actions">
          <button type="button" class="clip-detail-action" @click="copySelected">
            <ClipboardCopyIcon :size="16" />
            <span>{{ copiedId === selectedEntry.id ? "Copied" : "Copy" }}</span>
          </button>
          <button type="button" class="clip-detail-action" @click="onEyeClick(selectedEntry)">
            <EyeClosedIcon v-if="selectedEntry.revealed" :size="16" />
            <EyeIcon v-else :size="16" />
            {{ selectedEntry.revealed ? "Hide" : "Show" }}
          </button>
          <button type="button" class="clip-detail-action clip-detail-action--danger" @click="removeSelected">
            <Trash2Icon :size="16" />
            <span>Delete</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.clip {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  outline: none;
}

.clip-muted,
.clip-error {
  margin: 0;
  font-size: 12px;
}

.clip-muted { color: rgba(var(--fg-rgb), 0.45); }
.clip-error { color: #f87171; }

.clip-history {
  display: grid;
  grid-template-columns: minmax(150px, 0.85fr) minmax(190px, 1.35fr);
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
}

.clip-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  list-style: none;
  border-right: 1px solid rgba(var(--fg-rgb), 0.09);
  overscroll-behavior: contain;
}

.clip-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 30px;
  corner-shape: var(--surface-corner-shape, round);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.clip-row:hover,
.clip-row:focus-visible { background: rgba(var(--fg-rgb), 0.06); outline: none; }
.clip-row.is-selected {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.clip-row-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 10px;
  font-weight: 700;
}

.clip-row-icon--image { font-size: 14px; }
.clip-row.is-copied .clip-row-icon { color: #9ad0ff; }

.clip-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.clip-time {
  color: rgba(var(--fg-rgb), 0.42);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.clip-source-app {
  display: grid;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  place-items: center;
}

.clip-source-icon {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: contain;
}

.masked {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.08em;
  color: rgba(var(--fg-rgb), 0.55);
}

.clip-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 14px;
}

.clip-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: rgba(var(--fg-rgb), 0.5);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.clip-detail-preview {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  place-items: center;
  margin: 12px 0;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.clip-detail-text {
  width: 100%;
  max-height: 100%;
  margin: 0;
  padding: 14px;
  overflow: auto;
  box-sizing: border-box;
  color: rgba(var(--fg-rgb), 0.93);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.clip-detail-text.masked { text-align: center; }
.clip-detail-image { display: block; width: 100%; height: 100%; object-fit: contain; }
.clip-detail-mask { color: rgba(var(--fg-rgb), 0.45); font-size: 12px; }

.clip-detail-files {
  align-self: stretch;
  width: 100%;
  max-height: 100%;
  margin: 0;
  padding: 8px;
  overflow: auto;
  box-sizing: border-box;
  list-style: none;
}

.clip-detail-files li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.07);
}

.clip-detail-files strong {
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-detail-files span {
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.45);
  font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-detail-actions { display: flex; gap: 8px; }

.clip-detail-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 7px;
  padding: 8px 10px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.78);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.clip-detail-action:first-child { flex: 1 1 auto; }
.clip-detail-action--danger { color: #fca5a5 !important; }
.clip-detail-actions button:hover { filter: brightness(1.1); }

@media (max-width: 440px) {
  .clip-history { grid-template-columns: minmax(120px, 0.75fr) minmax(140px, 1fr); }
  .clip-detail { padding: 10px; }
  .clip-detail-head { font-size: 10px; }
}
</style>
