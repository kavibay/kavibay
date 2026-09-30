<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch, type Component, type CSSProperties } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import { MonitorIcon, MoonIcon, SunIcon } from "@sdk/icons";
import {
  applyColorModeToDocument,
  applyCornerGeometryToDocument,
  applyDesktopFillToDocument,
  applyFontToDocument,
  applyIconStyleToDocument,
  applySurfaceShadowStyleToDocument,
  COLOR_MODE_OPTIONS,
  CORNER_SHAPE_OPTIONS,
  CORNER_SHAPE_SUPPORTED,
  cornerGeometry,
  DESKTOP_FILL_MODE_OPTIONS,
  FONT_OPTIONS,
  fontStack,
  MAX_DESKTOP_FILL_OPACITY,
  MAX_SURFACE_BLUR,
  MAX_SURFACE_OPACITY,
  MAX_SURFACE_RADIUS,
  MAX_SURFACE_SHADOW,
  MIN_DESKTOP_FILL_OPACITY,
  MIN_SURFACE_BLUR,
  MIN_SURFACE_OPACITY,
  MIN_SURFACE_RADIUS,
  MIN_SURFACE_SHADOW,
  SHADOW_STYLE_OPTIONS,
  shadowStyleCss,
  type ColorMode,
  type CornerShape,
  type DesktopFillMode,
  type FontId,
  type IconStyle,
  type ShadowStyleId,
} from "./appearanceLogic";
import { useAppearance } from "./useAppearance";

const {
  colorMode,
  iconStyle,
  fontId,
  surfaceOpacity,
  surfaceBlur,
  surfaceShadow,
  surfaceShadowStyle,
  surfaceRadius,
  cornerShape,
  desktopFillMode,
  desktopFillColor,
  desktopFillOpacity,
  setColorMode,
  setIconStyle,
  setFont,
  setSurfaceOpacity,
  setSurfaceBlur,
  setSurfaceShadow,
  setSurfaceShadowStyle,
  setSurfaceRadius,
  setCornerShape,
  setDesktopFillMode,
  setDesktopFillColor,
  setDesktopFillOpacity,
} = useAppearance();

const colorModeIcons: Record<ColorMode, Component> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

const fontOptions = FONT_OPTIONS.map((f) => ({ value: f.id, label: f.name, note: f.sample }));
const shadowOptions = SHADOW_STYLE_OPTIONS.map((s) => ({ value: s.id, label: s.hint }));
const iconStyleOptions: { id: IconStyle; name: string }[] = [
  { id: "colorful", name: "Colorful" },
  { id: "monochrome", name: "Monochrome" },
];

/**
 * The option under the pointer, shown app-wide before it is chosen. Only the
 * document is restyled; a click commits and persists through the setters.
 */
const hovered = reactive<{
  colorMode: ColorMode | null;
  iconStyle: IconStyle | null;
  font: FontId | null;
  corner: CornerShape | null;
  shadow: ShadowStyleId | null;
  fill: DesktopFillMode | null;
}>({ colorMode: null, iconStyle: null, font: null, corner: null, shadow: null, fill: null });

const shownCorner = computed(() => hovered.corner ?? cornerShape.value);
const shownShadow = computed(() => hovered.shadow ?? surfaceShadowStyle.value);

// Sync, so clearing `hovered` on unmount restores the committed look at once.
const sync = { flush: "sync" } as const;
watch(() => hovered.colorMode ?? colorMode.value, applyColorModeToDocument, sync);
watch(() => hovered.iconStyle ?? iconStyle.value, applyIconStyleToDocument, sync);
watch(() => hovered.font ?? fontId.value, applyFontToDocument, sync);
watch(shownCorner, (shape) => applyCornerGeometryToDocument(surfaceRadius.value, shape), sync);
watch(shownShadow, applySurfaceShadowStyleToDocument, sync);
watch(
  () => hovered.fill ?? desktopFillMode.value,
  (mode) => applyDesktopFillToDocument(mode, desktopFillColor.value, desktopFillOpacity.value),
  sync,
);

onBeforeUnmount(() => {
  Object.assign(hovered, { colorMode: null, iconStyle: null, font: null, corner: null, shadow: null, fill: null });
});

const cornerHint = computed(
  () => CORNER_SHAPE_OPTIONS.find((o) => o.id === shownCorner.value)?.hint ?? "",
);

/** Select color mode and live-apply. */
function onColorMode(mode: ColorMode) {
  setColorMode(mode);
}

/** Select a font and live-apply it globally. */
function onSelect(id: FontId) {
  setFont(id);
}

/** Live-apply surface opacity from the range input (0–1). */
function onOpacity(e: Event) {
  setSurfaceOpacity(Number((e.target as HTMLInputElement).value));
}

/** Live-apply backdrop blur from the range input (px). */
function onBlur(e: Event) {
  setSurfaceBlur(Number((e.target as HTMLInputElement).value));
}

/** Live-apply shadow strength from the range input (0–1). */
function onShadow(e: Event) {
  setSurfaceShadow(Number((e.target as HTMLInputElement).value));
}

/** Select a drop-shadow style preset and live-apply. */
function onShadowStyle(id: ShadowStyleId) {
  setSurfaceShadowStyle(id);
}

/** Live-apply border-radius from the range input (px). */
function onRadius(e: Event) {
  setSurfaceRadius(Number((e.target as HTMLInputElement).value));
}

/** Select corner shape and live-apply. */
function onCornerShape(shape: CornerShape) {
  setCornerShape(shape);
}

/** Corners as this engine draws them (CSS corner-shape is not in CSSProperties yet). */
function cornerStyle(radiusPx: number, shape: CornerShape): CSSProperties {
  const drawn = cornerGeometry(radiusPx, shape, CORNER_SHAPE_SUPPORTED);
  return { borderRadius: `${drawn.radiusPx}px`, "corner-shape": drawn.shape } as CSSProperties;
}

/** Select desktop gap fill mode and live-apply. */
function onDesktopFillMode(mode: DesktopFillMode) {
  setDesktopFillMode(mode);
}

/** Live-apply desktop fill color from native color input. */
function onDesktopFillColor(e: Event) {
  setDesktopFillColor((e.target as HTMLInputElement).value);
}

/** Live-apply desktop fill opacity from the range input (0–1). */
function onDesktopFillOpacity(e: Event) {
  setDesktopFillOpacity(Number((e.target as HTMLInputElement).value));
}

/**
 * How far along a range the thumb sits, as a CSS percentage. Drives the
 * filled portion of the custom track (native range fill is not styleable).
 */
function rangeFill(value: number, min: number, max: number): string {
  if (max <= min) return "0%";
  return `${((value - min) / (max - min)) * 100}%`;
}

/**
 * Mini widget on the glass stage. Settings itself is opaque on purpose, so
 * this is the only place opacity / blur / shadow / radius show together.
 */
const glassPreviewStyle = computed(
  (): CSSProperties =>
    ({
      ...cornerStyle(surfaceRadius.value, shownCorner.value),
      boxShadow: shadowStyleCss(shownShadow.value),
      background: `rgba(var(--surface-bg-rgb), ${surfaceOpacity.value})`,
      backdropFilter: surfaceBlur.value > 0 ? `blur(${surfaceBlur.value}px)` : "none",
      WebkitBackdropFilter:
        surfaceBlur.value > 0 ? `blur(${surfaceBlur.value}px)` : "none",
    }) as CSSProperties,
);
</script>

<template>
  <div class="appearance">
    <Teleport to=".settings-sticky">
    <header class="appearance-head">
      <h2 class="appearance-title">Appearance</h2>
      <p class="appearance-lead">
        Theme, type, and the shared glass of widgets and search.
      </p>
      <div class="glass-stage" aria-hidden="true">
        <div class="glass-stage-card" :style="glassPreviewStyle">
          <span class="glass-stage-time">14:32</span>
          <span class="glass-stage-caption">Preview</span>
        </div>
      </div>
    </header>
    </Teleport>

    <section class="settings-section">
      <h3 class="settings-section-title">Theme</h3>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Color mode</span>
        </span>
        <div class="settings-segmented" role="radiogroup" aria-label="Color mode">
          <button
            v-for="opt in COLOR_MODE_OPTIONS"
            :key="opt.id"
            type="button"
            class="settings-segment settings-segment--icon"
            role="radio"
            :aria-checked="colorMode === opt.id"
            :aria-label="opt.name"
            :title="opt.name"
            :class="{ 'settings-segment--active': colorMode === opt.id }"
            @mouseenter="hovered.colorMode = opt.id"
            @mouseleave="hovered.colorMode = null"
            @click="onColorMode(opt.id)"
          >
            <component :is="colorModeIcons[opt.id]" :size="16" />
          </button>
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Icon Style</span>
        </span>
        <div class="settings-segmented" role="radiogroup" aria-label="Icon Style">
          <button
            v-for="opt in iconStyleOptions"
            :key="opt.id"
            type="button"
            class="settings-segment"
            role="radio"
            :aria-checked="iconStyle === opt.id"
            :class="{ 'settings-segment--active': iconStyle === opt.id }"
            @mouseenter="hovered.iconStyle = opt.id"
            @mouseleave="hovered.iconStyle = null"
            @click="setIconStyle(opt.id)"
          >
            {{ opt.name }}
          </button>
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Font</span>
        </span>
        <KavibaySelect
          class="row-select"
          :style="{ '--font-preview': fontStack(fontId) }"
          :options="fontOptions"
          :model-value="fontId"
          align="right"
          aria-label="Font"
          @highlight="hovered.font = $event as FontId | null"
          @update:model-value="onSelect($event as FontId)"
        >
          <template #option="{ option }">
            <span class="rich-item" :style="{ fontFamily: fontStack(option.value as FontId) }">
              <span class="font-sample">{{ option.note }}</span>
              <span class="rich-name">{{ option.label }}</span>
            </span>
          </template>
        </KavibaySelect>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Glass</h3>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Opacity</span>
          <span class="settings-row-hint">Shared look for widgets and the search bar.</span>
        </span>
        <span class="row-slider">
          <input
            class="slider-input"
            type="range"
            :min="MIN_SURFACE_OPACITY"
            :max="MAX_SURFACE_OPACITY"
            step="0.01"
            :value="surfaceOpacity"
            :style="{ '--fill': rangeFill(surfaceOpacity, MIN_SURFACE_OPACITY, MAX_SURFACE_OPACITY) }"
            @input="onOpacity"
          />
          <span class="slider-value">{{ Math.round(surfaceOpacity * 100) }}%</span>
        </span>
      </label>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Blur</span>
          <span class="settings-row-hint">Lower blur helps performance.</span>
        </span>
        <span class="row-slider">
          <input
            class="slider-input"
            type="range"
            :min="MIN_SURFACE_BLUR"
            :max="MAX_SURFACE_BLUR"
            step="1"
            :value="surfaceBlur"
            :style="{ '--fill': rangeFill(surfaceBlur, MIN_SURFACE_BLUR, MAX_SURFACE_BLUR) }"
            @input="onBlur"
          />
          <span class="slider-value">{{ surfaceBlur === 0 ? "Off" : `${surfaceBlur}px` }}</span>
        </span>
      </label>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Border radius</span>
        </span>
        <span class="row-slider">
          <input
            class="slider-input"
            type="range"
            :min="MIN_SURFACE_RADIUS"
            :max="MAX_SURFACE_RADIUS"
            step="1"
            :value="surfaceRadius"
            :style="{ '--fill': rangeFill(surfaceRadius, MIN_SURFACE_RADIUS, MAX_SURFACE_RADIUS) }"
            @input="onRadius"
          />
          <span class="slider-value">{{ surfaceRadius === 0 ? "Sharp" : `${surfaceRadius}px` }}</span>
        </span>
      </label>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Corners</span>
          <span class="settings-row-hint">{{ cornerHint }}</span>
        </span>
        <div class="settings-segmented" role="radiogroup" aria-label="Corner shape">
          <button
            v-for="opt in CORNER_SHAPE_OPTIONS"
            :key="opt.id"
            type="button"
            class="settings-segment"
            role="radio"
            :aria-checked="cornerShape === opt.id"
            :class="{ 'settings-segment--active': cornerShape === opt.id }"
            @mouseenter="hovered.corner = opt.id"
            @mouseleave="hovered.corner = null"
            @click="onCornerShape(opt.id)"
          >
            {{ opt.name }}
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Shadow</h3>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Style</span>
          <span class="settings-row-hint">The drop under widgets and the search bar.</span>
        </span>
        <KavibaySelect
          class="row-select"
          :options="shadowOptions"
          :model-value="surfaceShadowStyle"
          align="right"
          aria-label="Shadow style"
          @highlight="hovered.shadow = $event as ShadowStyleId | null"
          @update:model-value="onShadowStyle($event as ShadowStyleId)"
        >
          <template #option="{ option }">
            <span class="rich-item rich-item--row">
              <span class="shadow-well">
                <span
                  class="shadow-swatch"
                  :style="{ boxShadow: shadowStyleCss(option.value as ShadowStyleId) }"
                />
              </span>
              <span>{{ option.label }}</span>
            </span>
          </template>
        </KavibaySelect>
      </div>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Strength</span>
        </span>
        <span class="row-slider">
          <input
            class="slider-input"
            type="range"
            :min="MIN_SURFACE_SHADOW"
            :max="MAX_SURFACE_SHADOW"
            step="0.01"
            :value="surfaceShadow"
            :style="{ '--fill': rangeFill(surfaceShadow, MIN_SURFACE_SHADOW, MAX_SURFACE_SHADOW) }"
            @input="onShadow"
          />
          <span class="slider-value">{{ Math.round(surfaceShadow * 100) }}%</span>
        </span>
      </label>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Space between widgets</h3>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Fill</span>
          <span class="settings-row-hint">
            Tint empty space while the cockpit is open. Pinned-only desktop stays clear.
          </span>
        </span>
        <div class="settings-segmented" role="radiogroup" aria-label="Space between widgets">
          <button
            v-for="opt in DESKTOP_FILL_MODE_OPTIONS"
            :key="opt.id"
            type="button"
            class="settings-segment"
            role="radio"
            :aria-checked="desktopFillMode === opt.id"
            :title="opt.hint"
            :class="{ 'settings-segment--active': desktopFillMode === opt.id }"
            @mouseenter="hovered.fill = opt.id"
            @mouseleave="hovered.fill = null"
            @click="onDesktopFillMode(opt.id)"
          >
            {{ opt.name }}
          </button>
        </div>
      </div>

      <template v-if="desktopFillMode === 'color'">
        <label class="settings-row">
          <span class="settings-row-copy">
            <span class="settings-row-title">Color</span>
          </span>
          <input
            class="appearance-color"
            type="color"
            :value="desktopFillColor"
            @input="onDesktopFillColor"
          />
        </label>

        <label class="settings-row">
          <span class="settings-row-copy">
            <span class="settings-row-title">Fill opacity</span>
          </span>
          <span class="row-slider">
            <input
              class="slider-input"
              type="range"
              :min="MIN_DESKTOP_FILL_OPACITY"
              :max="MAX_DESKTOP_FILL_OPACITY"
              step="0.01"
              :value="desktopFillOpacity"
              :style="{
                '--fill': rangeFill(desktopFillOpacity, MIN_DESKTOP_FILL_OPACITY, MAX_DESKTOP_FILL_OPACITY),
              }"
              @input="onDesktopFillOpacity"
            />
            <span class="slider-value">{{ Math.round(desktopFillOpacity * 100) }}%</span>
          </span>
        </label>
      </template>
    </section>
  </div>
</template>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

.appearance-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.appearance-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.appearance-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.glass-stage {
  display: grid;
  place-items: center;
  height: 96px;
  margin-top: 12px;
  border-radius: 14px;
  background: #16181d url("../assets/share-canvas/nebula.png") center / cover;
}

.glass-stage-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: 12px 16px 10px;
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
  color: rgba(var(--fg-rgb), 0.92);
}

.glass-stage-time {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.glass-stage-caption {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.row-slider {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 220px;
}

.slider-value {
  flex: none;
  width: 44px;
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.5);
}

/* Borderless dropdown, like the rest of the row: just the value and a caret. */
.row-select {
  flex: none;
}

.row-select :deep(.ssel-trigger) {
  gap: 8px;
  border-color: transparent;
  background: transparent;
  font-size: 13px;
}

.row-select :deep(.ssel-trigger:hover:not(:disabled)) {
  border-color: transparent;
  background: rgba(var(--fg-rgb), 0.06);
}

.row-select :deep(.ssel-item-label) {
  white-space: nowrap;
}

/* Dropdown rows that show what they set: a font sample, a shadow swatch. */
.rich-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
  white-space: nowrap;
}

.rich-item--row {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.font-sample {
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.rich-name {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

/* A shadow needs something lighter than itself to fall on, in either theme. */
.shadow-well {
  flex: none;
  display: grid;
  place-items: center;
  width: 52px;
  height: 34px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.18);
}

.shadow-swatch {
  width: 30px;
  height: 18px;
  border-radius: 5px;
  background: rgb(var(--surface-bg-rgb));
}

/* The font row shows the chosen font in itself. */
.row-select :deep(.ssel-value) {
  font-family: var(--font-preview, inherit);
}

.appearance-color {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
</style>
