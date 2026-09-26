<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import {
  COLOR_MODE_OPTIONS,
  CORNER_SHAPE_OPTIONS,
  CORNER_SHAPE_SUPPORTED,
  cornerGeometry,
  DESKTOP_FILL_MODE_OPTIONS,
  FONT_OPTIONS,
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
  type ShadowStyleId,
} from "./appearanceLogic";
import { useAppearance } from "./useAppearance";

const {
  colorMode,
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
      ...cornerStyle(surfaceRadius.value, cornerShape.value),
      boxShadow: shadowStyleCss(surfaceShadowStyle.value),
      background: `rgba(var(--surface-bg-rgb), ${surfaceOpacity.value})`,
      backdropFilter: surfaceBlur.value > 0 ? `blur(${surfaceBlur.value}px)` : "none",
      WebkitBackdropFilter:
        surfaceBlur.value > 0 ? `blur(${surfaceBlur.value}px)` : "none",
    }) as CSSProperties,
);
</script>

<template>
  <div class="appearance">
    <header class="appearance-head">
      <h2 class="appearance-title">Appearance</h2>
      <p class="appearance-lead">
        Theme, type, and the shared glass of widgets and search.
      </p>
    </header>

    <section class="appearance-block">
      <h3 class="appearance-block-title">Color mode</h3>
      <div class="choice-row" role="listbox" aria-label="Color mode">
        <button
          v-for="opt in COLOR_MODE_OPTIONS"
          :key="opt.id"
          type="button"
          class="choice"
          role="option"
          :aria-selected="colorMode === opt.id"
          :class="{ 'choice--active': colorMode === opt.id }"
          @click="onColorMode(opt.id)"
        >
          <span class="theme-preview" aria-hidden="true">
            <span
              v-if="opt.id === 'system' || opt.id === 'dark'"
              class="theme-pane theme-pane--dark"
            />
            <span
              v-if="opt.id === 'system' || opt.id === 'light'"
              class="theme-pane theme-pane--light"
            />
          </span>
          <span class="choice-name">{{ opt.name }}</span>
          <span class="choice-hint">{{ opt.hint }}</span>
        </button>
      </div>
    </section>

    <section class="appearance-block">
      <h3 class="appearance-block-title">Typeface</h3>
      <div class="choice-row choice-row--fonts" role="listbox" aria-label="Font style">
        <button
          v-for="font in FONT_OPTIONS"
          :key="font.id"
          type="button"
          class="choice font-choice"
          role="option"
          :aria-selected="fontId === font.id"
          :class="{ 'choice--active': fontId === font.id }"
          :style="{ fontFamily: font.stack }"
          @click="onSelect(font.id)"
        >
          <span class="font-sample">{{ font.sample }}</span>
          <span class="choice-name">{{ font.name }}</span>
        </button>
      </div>
    </section>

    <section class="appearance-block">
      <h3 class="appearance-block-title">Glass</h3>
      <p class="appearance-block-hint">
        Shared look for widgets and the search bar. Lower blur helps performance.
      </p>

      <div class="glass-stage" aria-hidden="true">
        <div class="glass-stage-card" :style="glassPreviewStyle">
          <span class="glass-stage-time">14:32</span>
          <span class="glass-stage-caption">Preview</span>
        </div>
      </div>

      <div class="appearance-group">
        <label class="slider">
          <span class="slider-row">
            <span>Opacity</span>
            <span class="slider-value">{{ Math.round(surfaceOpacity * 100) }}%</span>
          </span>
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
        </label>

        <label class="slider">
          <span class="slider-row">
            <span>Blur</span>
            <span class="slider-value">{{
              surfaceBlur === 0 ? "Off" : `${surfaceBlur}px`
            }}</span>
          </span>
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
        </label>

        <label class="slider">
          <span class="slider-row">
            <span>Border radius</span>
            <span class="slider-value">{{
              surfaceRadius === 0 ? "Sharp" : `${surfaceRadius}px`
            }}</span>
          </span>
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
        </label>

        <div class="corner-row" role="listbox" aria-label="Corner shape">
          <button
            v-for="opt in CORNER_SHAPE_OPTIONS"
            :key="opt.id"
            type="button"
            class="choice corner-choice"
            role="option"
            :aria-selected="cornerShape === opt.id"
            :class="{ 'choice--active': cornerShape === opt.id }"
            @click="onCornerShape(opt.id)"
          >
            <span
              class="corner-preview"
              :style="cornerStyle(Math.max(surfaceRadius, 12), opt.id)"
            />
            <span class="choice-copy">
              <span class="choice-name">{{ opt.name }}</span>
              <span class="choice-hint">{{ opt.hint }}</span>
            </span>
          </button>
        </div>
      </div>
    </section>

    <section class="appearance-block">
      <h3 class="appearance-block-title">Shadow</h3>
      <p class="appearance-block-hint">The drop under widgets and the search bar.</p>

      <div class="appearance-group">
        <div class="shadow-stage" role="listbox" aria-label="Shadow style">
          <button
            v-for="opt in SHADOW_STYLE_OPTIONS"
            :key="opt.id"
            type="button"
            class="shadow-chip"
            role="option"
            :aria-selected="surfaceShadowStyle === opt.id"
            :aria-label="opt.hint"
            :title="opt.hint"
            :class="{ 'shadow-chip--active': surfaceShadowStyle === opt.id }"
            @click="onShadowStyle(opt.id)"
          >
            <span class="shadow-preview" :style="{ boxShadow: opt.css }" />
            <span class="shadow-chip-name">{{ opt.hint }}</span>
          </button>
        </div>

        <label class="slider">
          <span class="slider-row">
            <span>Strength</span>
            <span class="slider-value">{{ Math.round(surfaceShadow * 100) }}%</span>
          </span>
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
        </label>
      </div>
    </section>

    <section class="appearance-block">
      <h3 class="appearance-block-title">Space between widgets</h3>
      <p class="appearance-block-hint">
        Tint empty space while the cockpit is open. Pinned-only desktop stays clear.
      </p>
      <div class="choice-row choice-row--2" role="listbox" aria-label="Space between widgets">
        <button
          v-for="opt in DESKTOP_FILL_MODE_OPTIONS"
          :key="opt.id"
          type="button"
          class="choice"
          role="option"
          :aria-selected="desktopFillMode === opt.id"
          :class="{ 'choice--active': desktopFillMode === opt.id }"
          @click="onDesktopFillMode(opt.id)"
        >
          <span
            class="fill-swatch"
            :class="{ 'fill-swatch--clear': opt.id === 'transparent' }"
            :style="
              opt.id === 'color'
                ? { background: desktopFillColor }
                : undefined
            "
            aria-hidden="true"
          />
          <span class="choice-name">{{ opt.name }}</span>
          <span class="choice-hint">{{ opt.hint }}</span>
        </button>
      </div>

      <div v-if="desktopFillMode === 'color'" class="appearance-group">
        <div class="slider-row">
          <span>Background color</span>
          <input
            class="appearance-color"
            type="color"
            :value="desktopFillColor"
            @input="onDesktopFillColor"
          />
        </div>
        <label class="slider">
          <span class="slider-row">
            <span>Opacity</span>
            <span class="slider-value"
              >{{ Math.round(desktopFillOpacity * 100) }}%</span
            >
          </span>
          <input
            class="slider-input"
            type="range"
            :min="MIN_DESKTOP_FILL_OPACITY"
            :max="MAX_DESKTOP_FILL_OPACITY"
            step="0.01"
            :value="desktopFillOpacity"
            :style="{
              '--fill': rangeFill(
                desktopFillOpacity,
                MIN_DESKTOP_FILL_OPACITY,
                MAX_DESKTOP_FILL_OPACITY,
              ),
            }"
            @input="onDesktopFillOpacity"
          />
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
  gap: 22px;
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

.appearance-lead,
.appearance-block-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.appearance-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.appearance-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.appearance-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.035);
}

.choice-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.choice-row--fonts {
  grid-template-columns: repeat(3, 1fr);
}

.choice-row--2 {
  grid-template-columns: 1fr 1fr;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.92);
  cursor: pointer;
  text-align: left;
}

.choice:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.choice--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.choice-name {
  font-size: 13px;
  font-weight: 600;
}

.choice-hint {
  font-size: 11px;
  line-height: 1.3;
  color: rgba(var(--fg-rgb), 0.45);
}

.theme-preview {
  display: flex;
  width: 100%;
  height: 48px;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22);
}

.theme-pane {
  position: relative;
  flex: 1;
}

.theme-pane::after {
  content: "";
  position: absolute;
  top: 8px;
  right: 6px;
  left: 6px;
  height: 16px;
  border-radius: 4px;
}

.theme-pane--dark {
  background: #1c1c20;
}

.theme-pane--dark::after {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
}

.theme-pane--light {
  background: #ececf1;
}

.theme-pane--light::after {
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
}

.font-choice {
  gap: 10px;
  padding: 14px 12px 12px;
}

.font-sample {
  max-width: 100%;
  font-size: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.font-choice .choice-name {
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.5);
}

.glass-stage {
  display: grid;
  place-items: center;
  height: 96px;
  border-radius: 14px;
  background:
    radial-gradient(90% 80% at 18% 20%, rgba(120, 160, 220, 0.28), transparent 55%),
    radial-gradient(80% 70% at 88% 78%, rgba(70, 90, 140, 0.3), transparent 50%),
    #16181d;
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

.slider {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.slider-value {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.5);
}

.corner-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.corner-choice {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}

.choice-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.corner-preview {
  flex: none;
  width: 36px;
  height: 36px;
  background: rgba(var(--fg-rgb), 0.14);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.12);
}

.shadow-stage {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px 4px;
  padding: 12px 8px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.28);
}

.shadow-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 8px 4px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.88);
  cursor: pointer;
}

.shadow-chip:hover {
  background: rgba(255, 255, 255, 0.05);
}

.shadow-chip--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.shadow-preview {
  width: 100%;
  height: 28px;
  border-radius: 7px;
  background: rgb(var(--surface-bg-rgb));
}

.shadow-chip-name {
  max-width: 100%;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.2;
  /* Stage is always a dark well, so labels stay light until the chip is selected. */
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shadow-chip--active .shadow-chip-name {
  color: rgba(var(--fg-rgb), 0.85);
}

.fill-swatch {
  width: 100%;
  height: 36px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.12);
}

.fill-swatch--clear {
  background:
    linear-gradient(45deg, rgba(var(--fg-rgb), 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(var(--fg-rgb), 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(var(--fg-rgb), 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(var(--fg-rgb), 0.12) 75%);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
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

@media (max-width: 560px) {
  .choice-row,
  .choice-row--fonts,
  .choice-row--2 {
    grid-template-columns: 1fr;
  }

  .shadow-stage {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
