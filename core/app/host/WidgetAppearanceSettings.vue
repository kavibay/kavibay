<script setup lang="ts">
import { computed } from "vue";
import { useAppearance } from "../settings/useAppearance";
import { MAX_WIDGET_BLUR, MAX_WIDGET_RADIUS, type WidgetAppearance } from "./widgetAppearance";

/**
 * The host's Appearance section in a widget's settings, shown when the
 * manifest sets `ui.appearance.editable`. The controls show what the card
 * draws now. A change reports only the field it touched, and the host merges
 * it into what is stored: two quick changes would otherwise both start from
 * the same stale props, and the second would undo the first. Reset reports
 * null, so the manifest's values apply again.
 */
const props = defineProps<{
  /** What the card draws: this instance's values over the manifest's. */
  effective: WidgetAppearance;
  /** This instance's own values; undefined while it follows the manifest. */
  own: WidgetAppearance | undefined;
}>();

const emit = defineEmits<{ update: [patch: WidgetAppearance | null] }>();

const { surfaceOpacity, surfaceBlur, surfaceRadius } = useAppearance();

/** The shared surface colour, for a manifest that leaves the background open. */
function sharedBackground(): string {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue("--surface-bg-rgb")
    .split(",")
    .map((part) => Number.parseInt(part, 10));
  if (channels.length !== 3 || channels.some((n) => !Number.isFinite(n))) return "#1c1c20";
  return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const background = computed(() => props.effective.background ?? sharedBackground());
const opacity = computed(() => props.effective.opacity ?? surfaceOpacity.value);
const blur = computed(() => props.effective.blur ?? surfaceBlur.value);
const radius = computed(() => props.effective.radius ?? surfaceRadius.value);

function set<K extends keyof WidgetAppearance>(key: K, value: WidgetAppearance[K]) {
  emit("update", { [key]: value });
}

function onNumber(key: "opacity" | "blur" | "radius", event: Event, scale = 1) {
  set(key, Number((event.target as HTMLInputElement).value) / scale);
}
</script>

<template>
  <section class="appearance">
    <header class="head">
      <h3 class="title">Appearance</h3>
      <button v-if="own" type="button" class="reset" @click="emit('update', null)">
        Reset
      </button>
    </header>

    <label class="field field--row">
      <span class="label">Background</span>
      <input
        type="color"
        class="color"
        :value="background"
        @input="set('background', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="field">
      <span class="label">
        Opacity <span class="value">{{ Math.round(opacity * 100) }}%</span>
      </span>
      <input
        type="range"
        class="slider-input"
        min="0"
        max="100"
        :value="Math.round(opacity * 100)"
        :style="{ '--fill': `${opacity * 100}%` }"
        @input="onNumber('opacity', $event, 100)"
      />
    </label>

    <label class="field">
      <span class="label">
        Blur <span class="value">{{ blur === 0 ? "Off" : `${blur}px` }}</span>
      </span>
      <input
        type="range"
        class="slider-input"
        min="0"
        :max="MAX_WIDGET_BLUR"
        :value="blur"
        :style="{ '--fill': `${(blur / MAX_WIDGET_BLUR) * 100}%` }"
        @input="onNumber('blur', $event)"
      />
    </label>

    <label class="field">
      <span class="label">
        Radius <span class="value">{{ radius }}px</span>
      </span>
      <input
        type="range"
        class="slider-input"
        min="0"
        :max="MAX_WIDGET_RADIUS"
        :value="radius"
        :style="{ '--fill': `${(radius / MAX_WIDGET_RADIUS) * 100}%` }"
        @input="onNumber('radius', $event)"
      />
    </label>
  </section>
</template>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.reset {
  padding: 2px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.75);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.reset:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
}

.value {
  font-weight: 400;
  color: rgba(var(--fg-rgb), 0.6);
}

.color {
  width: 36px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
</style>
