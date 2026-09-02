import { invoke } from "@tauri-apps/api/core";
import { type Ref, ref } from "vue";
import {
  type AppearanceState,
  type ColorMode,
  type CornerShape,
  type DesktopFillMode,
  type FontId,
  type OpenMonitor,
  type ShadowStyleId,
  type WidgetLayoutMode,
  applyColorModeToDocument,
  applyCornerShapeToDocument,
  applyDesktopFillToDocument,
  applyFontToDocument,
  applySurfaceBlurToDocument,
  applySurfaceOpacityToDocument,
  applySurfaceRadiusToDocument,
  applySurfaceShadowStyleToDocument,
  applySurfaceShadowToDocument,
  loadAppearance,
  normalizeColorMode,
  normalizeCornerShape,
  normalizeDesktopFillColor,
  normalizeDesktopFillMode,
  normalizeDesktopFillOpacity,
  normalizeAppearance,
  normalizeOpenMonitor,
  normalizeShadowStyle,
  normalizeSurfaceBlur,
  normalizeSurfaceOpacity,
  normalizeSurfaceRadius,
  normalizeSurfaceShadow,
  normalizeWidgetLayoutMode,
  saveAppearance,
  toggleColorModeValue,
} from "./appearanceLogic";

const hasTauri = () => "__TAURI_INTERNALS__" in window;

const initial = loadAppearance();
const colorMode: Ref<ColorMode> = ref(initial.colorMode);
const fontId: Ref<FontId> = ref(initial.fontId);
const hideOnOutsideClick: Ref<boolean> = ref(initial.hideOnOutsideClick);
const openMonitor: Ref<OpenMonitor> = ref(initial.openMonitor);
const widgetLayoutMode: Ref<WidgetLayoutMode> = ref(initial.widgetLayoutMode);
const surfaceOpacity: Ref<number> = ref(initial.surfaceOpacity);
const surfaceBlur: Ref<number> = ref(initial.surfaceBlur);
const surfaceShadow: Ref<number> = ref(initial.surfaceShadow);
const surfaceShadowStyle: Ref<ShadowStyleId> = ref(initial.surfaceShadowStyle);
const surfaceRadius: Ref<number> = ref(initial.surfaceRadius);
const cornerShape: Ref<CornerShape> = ref(initial.cornerShape);
const desktopFillMode: Ref<DesktopFillMode> = ref(initial.desktopFillMode);
const desktopFillColor: Ref<string> = ref(initial.desktopFillColor);
const desktopFillOpacity: Ref<number> = ref(initial.desktopFillOpacity);

/** Apply appearance tokens once (boot / first import). */
applyColorModeToDocument(colorMode.value);
if (typeof window !== "undefined" && window.matchMedia) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemChange = () => {
    if (colorMode.value === "system") {
      applyColorModeToDocument("system");
    }
  };
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", handleSystemChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(handleSystemChange);
  }
}
applyFontToDocument(fontId.value);
applySurfaceOpacityToDocument(surfaceOpacity.value);
applySurfaceBlurToDocument(surfaceBlur.value);
applySurfaceShadowToDocument(surfaceShadow.value);
applySurfaceShadowStyleToDocument(surfaceShadowStyle.value);
applySurfaceRadiusToDocument(surfaceRadius.value);
applyCornerShapeToDocument(cornerShape.value);
applyDesktopFillToDocument(
  desktopFillMode.value,
  desktopFillColor.value,
  desktopFillOpacity.value,
);

/** Push open-monitor choice to Rust (hotkey placement runs before UI). */
function syncOpenMonitorToRust(target: OpenMonitor) {
  if (!hasTauri()) return;
  void invoke("set_open_monitor", { target }).catch(() => {});
}

// Sync persisted preference as soon as the webview boots.
syncOpenMonitorToRust(openMonitor.value);

/** Persist all appearance fields together. */
function persist() {
  const state: AppearanceState = {
    fontId: fontId.value,
    colorMode: colorMode.value,
    hideOnOutsideClick: hideOnOutsideClick.value,
    openMonitor: openMonitor.value,
    widgetLayoutMode: widgetLayoutMode.value,
    surfaceOpacity: surfaceOpacity.value,
    surfaceBlur: surfaceBlur.value,
    surfaceShadow: surfaceShadow.value,
    surfaceShadowStyle: surfaceShadowStyle.value,
    surfaceRadius: surfaceRadius.value,
    cornerShape: cornerShape.value,
    desktopFillMode: desktopFillMode.value,
    desktopFillColor: desktopFillColor.value,
    desktopFillOpacity: desktopFillOpacity.value,
  };
  saveAppearance(state);
  // Local storage is just the immediate cache. The AppData copy survives a
  // WebView profile reset (which otherwise makes Settings look like defaults).
  if (hasTauri()) {
    void invoke("appearance_preferences_save", {
      value: JSON.stringify(state),
    }).catch(() => {});
  }
}

/** Replace the shared refs and document tokens after the durable store loads. */
function applyPersistedState(state: AppearanceState) {
  fontId.value = state.fontId;
  colorMode.value = state.colorMode;
  hideOnOutsideClick.value = state.hideOnOutsideClick;
  openMonitor.value = state.openMonitor;
  widgetLayoutMode.value = state.widgetLayoutMode;
  surfaceOpacity.value = state.surfaceOpacity;
  surfaceBlur.value = state.surfaceBlur;
  surfaceShadow.value = state.surfaceShadow;
  surfaceShadowStyle.value = state.surfaceShadowStyle;
  surfaceRadius.value = state.surfaceRadius;
  cornerShape.value = state.cornerShape;
  desktopFillMode.value = state.desktopFillMode;
  desktopFillColor.value = state.desktopFillColor;
  desktopFillOpacity.value = state.desktopFillOpacity;

  applyColorModeToDocument(state.colorMode);
  applyFontToDocument(state.fontId);
  applySurfaceOpacityToDocument(state.surfaceOpacity);
  applySurfaceBlurToDocument(state.surfaceBlur);
  applySurfaceShadowToDocument(state.surfaceShadow);
  applySurfaceShadowStyleToDocument(state.surfaceShadowStyle);
  applySurfaceRadiusToDocument(state.surfaceRadius);
  applyCornerShapeToDocument(state.cornerShape);
  applyDesktopFill();
  syncOpenMonitorToRust(state.openMonitor);
  saveAppearance(state);
}

// Migrate an existing local setting once, then always prefer the AppData copy.
if (hasTauri()) {
  void invoke<string | null>("appearance_preferences_load")
    .then((raw) => {
      if (!raw) {
        persist();
        return;
      }
      applyPersistedState(normalizeAppearance(JSON.parse(raw) as unknown));
    })
    .catch(() => {});
}

/** Re-apply desktop fill CSS from current refs. */
function applyDesktopFill() {
  applyDesktopFillToDocument(
    desktopFillMode.value,
    desktopFillColor.value,
    desktopFillOpacity.value,
  );
}

/** App-wide appearance shared by Settings UI and boot path. */
export function useAppearance() {
  /** Live-apply + persist a font choice. */
  function setFont(id: FontId) {
    fontId.value = id;
    applyFontToDocument(id);
    persist();
  }

  /** Live-apply + persist hide-on-outside-click. */
  function setHideOnOutsideClick(enabled: boolean) {
    hideOnOutsideClick.value = enabled;
    persist();
  }

  /** Live-apply + persist which monitor to cover when opening. */
  function setOpenMonitor(target: OpenMonitor) {
    const next = normalizeOpenMonitor(target);
    openMonitor.value = next;
    persist();
    syncOpenMonitorToRust(next);
  }

  /** Live-apply + persist free-hand vs snap-to-grid. */
  function setWidgetLayoutMode(mode: WidgetLayoutMode) {
    widgetLayoutMode.value = normalizeWidgetLayoutMode(mode);
    persist();
  }

  /** Live-apply + persist glass opacity for widgets + palette. */
  function setSurfaceOpacity(value: number) {
    const next = normalizeSurfaceOpacity(value);
    surfaceOpacity.value = next;
    applySurfaceOpacityToDocument(next);
    persist();
  }

  /** Live-apply + persist backdrop blur (px) for glass surfaces. */
  function setSurfaceBlur(value: number) {
    const next = normalizeSurfaceBlur(value);
    surfaceBlur.value = next;
    applySurfaceBlurToDocument(next);
    persist();
  }

  /** Live-apply + persist drop-shadow strength (0–1). */
  function setSurfaceShadow(value: number) {
    const next = normalizeSurfaceShadow(value);
    surfaceShadow.value = next;
    applySurfaceShadowToDocument(next);
    persist();
  }

  /** Live-apply + persist drop-shadow style preset. */
  function setSurfaceShadowStyle(style: ShadowStyleId) {
    const next = normalizeShadowStyle(style);
    surfaceShadowStyle.value = next;
    applySurfaceShadowStyleToDocument(next);
    persist();
  }

  /** Live-apply + persist border-radius (px) for widgets + palette. */
  function setSurfaceRadius(value: number) {
    const next = normalizeSurfaceRadius(value);
    surfaceRadius.value = next;
    applySurfaceRadiusToDocument(next);
    persist();
  }

  /** Live-apply + persist corner shape (round / squircle). */
  function setCornerShape(shape: CornerShape) {
    const next = normalizeCornerShape(shape);
    cornerShape.value = next;
    applyCornerShapeToDocument(next);
    persist();
  }

  /** Live-apply + persist desktop gap fill mode. */
  function setDesktopFillMode(mode: DesktopFillMode) {
    desktopFillMode.value = normalizeDesktopFillMode(mode);
    applyDesktopFill();
    persist();
  }

  /** Live-apply + persist desktop gap fill color (hex). */
  function setDesktopFillColor(color: string) {
    desktopFillColor.value = normalizeDesktopFillColor(color);
    applyDesktopFill();
    persist();
  }

  /** Live-apply + persist desktop gap fill opacity (0–1). */
  function setDesktopFillOpacity(value: number) {
    desktopFillOpacity.value = normalizeDesktopFillOpacity(value);
    applyDesktopFill();
    persist();
  }

  /** Live-apply + persist light/dark color mode. */
  function setColorMode(mode: ColorMode) {
    const next = normalizeColorMode(mode);
    colorMode.value = next;
    applyColorModeToDocument(next);
    persist();
  }

  /** Flip light ↔ dark and persist. */
  function toggleColorMode() {
    setColorMode(toggleColorModeValue(colorMode.value));
  }

  return {
    colorMode,
    fontId,
    hideOnOutsideClick,
    openMonitor,
    widgetLayoutMode,
    surfaceOpacity,
    surfaceBlur,
    surfaceShadow,
    surfaceShadowStyle,
    surfaceRadius,
    cornerShape,
    desktopFillMode,
    desktopFillColor,
    desktopFillOpacity,
    setFont,
    setHideOnOutsideClick,
    setOpenMonitor,
    setWidgetLayoutMode,
    setSurfaceOpacity,
    setSurfaceBlur,
    setSurfaceShadow,
    setSurfaceShadowStyle,
    setSurfaceRadius,
    setCornerShape,
    setDesktopFillMode,
    setDesktopFillColor,
    setDesktopFillOpacity,
    setColorMode,
    toggleColorMode,
  };
}
