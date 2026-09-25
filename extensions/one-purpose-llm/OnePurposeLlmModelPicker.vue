<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  setClickThroughPaused,
  syncInteractiveRegions,
} from "../../core/app/system/clickThrough";
import {
  formatModelPricing,
  providerLabel,
  type LlmModelOption,
} from "./onePurposeLlmLogic";
import OnePurposeLlmVendorLogo from "./OnePurposeLlmVendorLogo.vue";

const props = defineProps<{
  /** The host catalog, already sorted (usable models first). */
  models: LlmModelOption[];
  model: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:model": [value: string];
  "add-key": [provider: string];
  open: [];
}>();

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

const selected = computed(() => props.models.find((model) => model.id === props.model));
const label = computed(() => selected.value?.label ?? "Choose a model");

/**
 * Grouped by provider, in the order the host listed them. Which key a model
 * needs is the one thing you have to know before picking it, and a provider
 * heading says that once instead of once per row.
 */
const groups = computed(() => {
  const order: string[] = [];
  const byProvider = new Map<string, LlmModelOption[]>();
  for (const model of props.models) {
    if (!byProvider.has(model.provider)) {
      byProvider.set(model.provider, []);
      order.push(model.provider);
    }
    byProvider.get(model.provider)!.push(model);
  }
  return order.map((provider) => ({
    provider,
    label: providerLabel(provider),
    configured: byProvider.get(provider)!.some((model) => model.configured),
    models: byProvider.get(provider)!,
  }));
});

/** Position the teleported menu above the trigger pill. */
function placeMenu() {
  const trigger = triggerEl.value;
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 300), Math.min(360, window.innerWidth - 16));
  let left = r.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
  if (left < 8) left = 8;
  menuStyle.value = {
    position: "fixed",
    left: `${left}px`,
    bottom: `${Math.max(8, window.innerHeight - r.top + 8)}px`,
    width: `${width}px`,
    zIndex: "10000",
  };
}

async function setOpen(next: boolean) {
  if (next && !open.value) emit("open");
  open.value = next;
  // Pause click-through while the menu is on document.body (outside the card).
  setClickThroughPaused(next);
  if (next) {
    await nextTick();
    placeMenu();
  }
  await nextTick();
  syncInteractiveRegions();
}

function toggle() {
  if (props.disabled) return;
  void setOpen(!open.value);
}

function choose(modelId: string) {
  emit("update:model", modelId);
  void setOpen(false);
}

/** Close the menu and send the user to Settings → AI on this provider. */
function addKey(provider: string) {
  emit("add-key", provider);
  void setOpen(false);
}

function onPointerDown(e: PointerEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (triggerEl.value?.contains(t) || menuEl.value?.contains(t)) return;
  void setOpen(false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) void setOpen(false);
}

function onViewportChange() {
  if (open.value) placeMenu();
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && open.value) void setOpen(false);
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div class="opl-picker">
    <button
      ref="triggerEl"
      type="button"
      class="opl-picker-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="`Model: ${label}`"
      @click="toggle"
      @pointerdown.stop
    >
      <OnePurposeLlmVendorLogo :vendor="selected?.vendor" :size="14" />
      <span class="opl-picker-trigger-label">{{ label }}</span>
      <svg class="opl-picker-chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
        <path
          d="M1 1l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        class="opl-picker-menu"
        role="listbox"
        aria-label="Models"
        data-interactive
        :style="menuStyle"
        @pointerdown.stop
      >
        <p v-if="!models.length" class="opl-picker-empty">No models available.</p>
        <div v-for="group in groups" :key="group.provider" class="opl-picker-group">
          <p class="opl-picker-group-label">
            {{ group.label }}
            <button
              v-if="!group.configured"
              type="button"
              class="opl-picker-add-key"
              @click="addKey(group.provider)"
            >
              Add key
            </button>
          </p>
          <button
            v-for="item in group.models"
            :key="item.id"
            type="button"
            role="option"
            class="opl-picker-option"
            :class="{
              'opl-picker-option--active': item.id === model,
              'opl-picker-option--locked': !item.configured,
            }"
            :aria-selected="item.id === model"
            @click="choose(item.id)"
          >
            <OnePurposeLlmVendorLogo :vendor="item.vendor" :size="18" />
            <span class="opl-picker-option-body">
              <span class="opl-picker-option-label">{{ item.label }}</span>
              <span class="opl-picker-option-note">{{ item.note }}</span>
              <span v-if="formatModelPricing(item)" class="opl-picker-option-pricing">
                {{ formatModelPricing(item) }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.opl-picker {
  min-width: 0;
  max-width: calc(100% - 40px);
}

.opl-picker-trigger {
  display: flex;
  align-items: center;
  height: 28px;
  box-sizing: border-box;
  gap: 6px;
  max-width: 100%;
  padding: 4px 9px 4px 7px;
  border-radius: 999px;
  border: 1px solid rgba(var(--fg-rgb), 0.06);
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.78);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.opl-picker-trigger:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.1);
  border-color: rgba(var(--fg-rgb), 0.1);
}

.opl-picker-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

.opl-picker-trigger-label {
  min-width: 0;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.opl-picker-chevron {
  flex-shrink: 0;
  color: rgba(var(--fg-rgb), 0.45);
}

.opl-picker-menu {
  max-height: min(380px, 60vh);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--surface-bg-rgb), 0.97);
  box-shadow: 0 16px 40px rgba(var(--shadow-rgb), calc(0.55 * var(--surface-shadow, 1) * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(14px));
  box-sizing: border-box;
}

.opl-picker-empty {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
}

.opl-picker-group + .opl-picker-group {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.opl-picker-group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 4px;
  padding: 0 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.opl-picker-add-key {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.72);
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  cursor: pointer;
}

.opl-picker-add-key:hover {
  background: rgba(var(--fg-rgb), 0.14);
  color: rgba(var(--fg-rgb), 0.92);
}

.opl-picker-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 12px;
  align-items: start;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.opl-picker-option + .opl-picker-option {
  margin-top: 2px;
}

.opl-picker-option:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.opl-picker-option--active {
  background: rgba(var(--fg-rgb), 0.12);
}

/* Still selectable — Add key on the group opens Settings; picking still works. */
.opl-picker-option--locked {
  opacity: 0.55;
}

.opl-picker-option-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.opl-picker-option-label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.opl-picker-option-note {
  font-size: 11px;
  line-height: 1.3;
  color: rgba(var(--fg-rgb), 0.52);
}

.opl-picker-option-pricing {
  font-size: 10px;
  line-height: 1.3;
  color: rgba(var(--fg-rgb), 0.36);
  font-variant-numeric: tabular-nums;
}
</style>
