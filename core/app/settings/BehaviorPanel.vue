<script setup lang="ts">
import { emit } from "@tauri-apps/api/event";
import {
  openMonitorOptions,
  WIDGET_LAYOUT_MODE_OPTIONS,
  type OpenMonitor,
  type WidgetLayoutMode,
} from "./appearanceLogic";
import { doubleTapKeyLabel, keyPlatform } from "../host/shortcutHints";
import { waitingPlace } from "../onboarding/onboardingCopy";
import { useAutostart } from "../onboarding/useAutostart";
import { useOnboarding } from "../onboarding/useOnboarding";
import { useAppearance } from "./useAppearance";
import { useDeveloperPrefs } from "./useDeveloperPrefs";
import { useSettingsModal } from "./useSettingsModal";

const {
  hideOnOutsideClick,
  openMonitor,
  widgetLayoutMode,
  setHideOnOutsideClick,
  setOpenMonitor,
  setWidgetLayoutMode,
} = useAppearance();

const {
  developerExtensionsEnabled,
  setDeveloperExtensionsEnabled,
  wizardAutoEnable,
  setWizardAutoEnable,
} = useDeveloperPrefs();

const {
  enabled: autostartEnabled,
  supported: autostartSupported,
  error: autostartError,
  setEnabled: setAutostartEnabled,
} = useAutostart();

const { replay, continueTour } = useOnboarding();
const { hide: hideSettings } = useSettingsModal();

const platform = keyPlatform();
const doubleTapKey = doubleTapKeyLabel(platform);
const openMonitors = openMonitorOptions(platform);

/**
 * Create or remove the autostart entry.
 *
 * Unlike its neighbours this does not persist a value — the registry entry (or
 * the `.desktop` file) *is* the value, and the switch follows what the host
 * reports rather than what was clicked. See `useAutostart`.
 */
function onAutostart(e: Event) {
  void setAutostartEnabled((e.target as HTMLInputElement).checked);
}

/** Toggle hide-on-outside-click and persist. */
function onHideOutside(e: Event) {
  setHideOnOutsideClick((e.target as HTMLInputElement).checked);
}

/** Toggle Developer Extensions gate and persist. */
function onDeveloperExtensions(e: Event) {
  setDeveloperExtensionsEnabled((e.target as HTMLInputElement).checked);
}

/** Toggle the Wizard's consent bypass and persist. */
function onWizardAutoEnable(e: Event) {
  setWizardAutoEnable((e.target as HTMLInputElement).checked);
}

/** Select which monitor to cover when opening the cockpit. */
function onOpenMonitor(target: OpenMonitor) {
  setOpenMonitor(target);
}

/** Select free-hand vs snap-to-grid layout mode. */
function onWidgetLayoutMode(mode: WidgetLayoutMode) {
  setWidgetLayoutMode(mode);
}

/** Reset onboarding to step 1, close Settings, and open the cockpit so the coach is visible. */
function onReplayOnboarding() {
  replay();
  continueTour();
  hideSettings();
  void emit("palette:show");
}
</script>

<template>
  <div class="behavior">
    <Teleport to=".settings-sticky">
    <header class="behavior-head">
      <h2 class="behavior-title">Behavior</h2>
      <p class="behavior-lead">How the cockpit reacts to interaction.</p>
    </header>
    </Teleport>

    <section v-if="autostartSupported" class="settings-section">
      <h3 class="settings-section-title">Startup</h3>
      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Start Kavibay when I log in</span>
          <span class="settings-row-hint">
            Waits in {{ waitingPlace(platform) }}, out of the way, until you tap
            {{ doubleTapKey }} twice
          </span>
          <span v-if="autostartError" class="behavior-warn">
            Could not change the startup entry: {{ autostartError }}
          </span>
        </span>
        <span class="switch">
          <input type="checkbox" :checked="autostartEnabled" @change="onAutostart" />
          <span class="switch-ui" />
        </span>
      </label>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Cockpit</h3>
      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Hide on outside click</span>
          <span class="settings-row-hint">Click empty space to hide the cockpit and all widgets</span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            :checked="hideOnOutsideClick"
            @change="onHideOutside"
          />
          <span class="switch-ui" />
        </span>
      </label>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Widget layout</span>
          <span class="settings-row-hint">
            How widgets move and resize on the desk. Switching mode does not move
            existing widgets until you drag them again.
          </span>
        </span>
        <div class="tiles" role="radiogroup" aria-label="Widget layout">
          <button
            v-for="opt in WIDGET_LAYOUT_MODE_OPTIONS"
            :key="opt.id"
            type="button"
            class="tile"
            role="radio"
            :aria-checked="widgetLayoutMode === opt.id"
            :title="opt.hint"
            :class="{ 'tile--active': widgetLayoutMode === opt.id }"
            @click="onWidgetLayoutMode(opt.id)"
          >
            <span class="layout-preview" :class="`layout-preview--${opt.id}`" aria-hidden="true">
              <span class="layout-tile" />
              <span class="layout-tile" />
              <span class="layout-tile" />
            </span>
            <span class="tile-name">{{ opt.name }}</span>
          </button>
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Open on</span>
          <span class="settings-row-hint">
            Which display a double tap on {{ doubleTapKey }} covers when multiple screens are
            available. Shift+Ctrl+Space always opens on the screen under the mouse.
          </span>
        </span>
        <div class="tiles" role="radiogroup" aria-label="Open on">
          <button
            v-for="opt in openMonitors"
            :key="opt.id"
            type="button"
            class="tile"
            role="radio"
            :aria-checked="openMonitor === opt.id"
            :aria-label="`${opt.name}. ${opt.hint}`"
            :title="opt.hint"
            :class="{ 'tile--active': openMonitor === opt.id }"
            @click="onOpenMonitor(opt.id)"
          >
            <span class="displays" :class="`displays--${opt.id}`" aria-hidden="true">
              <span class="display">
                <span class="display-window" />
              </span>
              <span class="display">
                <span class="display-window" />
              </span>
              <span class="display">
                <span class="display-window" />
              </span>
              <span class="display-pointer" />
            </span>
            <span class="tile-name">{{ opt.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Developer</h3>
      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Developer Extensions</span>
          <span class="settings-row-hint">
            Allow loading untrusted packages from the app data extensions folder.
            Packages with a native backend can run code as your user. Off by default.
          </span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            :checked="developerExtensionsEnabled"
            @change="onDeveloperExtensions"
          />
          <span class="switch-ui" />
        </span>
      </label>
      <!-- Warm on purpose: this one gives something away rather than showing something. -->
      <label v-if="developerExtensionsEnabled" class="settings-row row--warn">
        <span class="settings-row-copy">
          <span class="settings-row-title">Skip the Wizard's consent step</span>
          <span class="settings-row-hint">
            Widgets built in the Wizard turn on the moment you save them, with any
            network access and credentials they ask for — without showing you what
            they may reach. For demos and fast iteration. Turns itself off with
            Developer Extensions.
          </span>
        </span>
        <span class="switch">
          <input type="checkbox" :checked="wizardAutoEnable" @change="onWizardAutoEnable" />
          <span class="switch-ui" />
        </span>
      </label>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Tour</h3>
      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Getting-started tour</span>
          <span class="settings-row-hint">Palette → gallery → add a widget.</span>
        </span>
        <button type="button" class="behavior-action" @click="onReplayOnboarding">
          Replay tour
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.behavior {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

.behavior-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.behavior-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.behavior-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.row--warn {
  margin: 4px 0 0 12px;
  padding: 12px 14px;
  border-bottom: 0;
  border-radius: 12px;
  background: rgba(240, 170, 90, 0.1);
}

/* Small illustrated choices, sitting in the control column of a row. */
.tiles {
  flex: none;
  display: flex;
  gap: 6px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 80px;
  padding: 5px 5px 6px;
  border: 0;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.55);
  font: inherit;
  cursor: pointer;
}

.tile:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
}

.tile--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  color: rgba(var(--fg-rgb), 0.95);
}

.tile-name {
  max-width: 100%;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.25;
  text-align: center;
}

.layout-preview,
.displays {
  width: 100%;
  height: 36px;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.05);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.08);
}

.layout-preview {
  position: relative;
  overflow: hidden;
}

.layout-tile {
  position: absolute;
  border-radius: 3px;
  background: rgba(var(--fg-rgb), 0.22);
}

.layout-preview--freehand .layout-tile:nth-child(1) {
  top: 6px;
  left: 6px;
  width: 38%;
  height: 44%;
}

.layout-preview--freehand .layout-tile:nth-child(2) {
  top: 5px;
  right: 7px;
  width: 28%;
  height: 30%;
}

.layout-preview--freehand .layout-tile:nth-child(3) {
  right: 16%;
  bottom: 5px;
  width: 34%;
  height: 36%;
}

.layout-preview--grid {
  background-image:
    linear-gradient(rgba(var(--fg-rgb), 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--fg-rgb), 0.07) 1px, transparent 1px);
  background-size: 7px 7px;
  background-position: 4px 4px;
}

.layout-preview--grid .layout-tile:nth-child(1) {
  top: 5px;
  left: 5px;
  width: 30%;
  height: 36%;
}

.layout-preview--grid .layout-tile:nth-child(2) {
  top: 5px;
  left: calc(5px + 30% + 5px);
  width: 30%;
  height: 36%;
}

.layout-preview--grid .layout-tile:nth-child(3) {
  top: calc(5px + 36% + 5px);
  left: 5px;
  width: 30%;
  height: 36%;
}

.displays {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  padding: 0 5px 8px;
}

.display {
  position: relative;
  width: 28%;
  height: 15px;
  border-radius: 2px;
  background: rgba(var(--fg-rgb), 0.12);
}

.display::after {
  content: "";
  position: absolute;
  bottom: -4px;
  left: 50%;
  width: 6px;
  height: 2px;
  border-radius: 0 0 1px 1px;
  background: rgba(var(--fg-rgb), 0.16);
  transform: translateX(-50%);
}

.display-window {
  display: none;
  position: absolute;
  inset: 3px 2px 2px;
  border-radius: 1px;
  background: rgba(var(--fg-rgb), 0.28);
}

.display-pointer {
  display: none;
  position: absolute;
  width: 0;
  height: 0;
  border-top: 6px solid rgba(var(--fg-rgb), 0.85);
  border-right: 4px solid transparent;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
  transform: rotate(-12deg);
}

/* Primary is the left-hand display in a typical desk setup. */
.displays--primary .display:first-child {
  background: rgba(var(--fg-rgb), 0.42);
}

/* Pointer sits on the middle screen — "wherever the mouse is". */
.displays--cursor .display:nth-child(2) {
  background: rgba(var(--fg-rgb), 0.42);
}

.displays--cursor .display-pointer {
  display: block;
  top: 13px;
  left: 54%;
}

/* Focused window lives on the middle display. */
.displays--activeWindow .display:nth-child(2) {
  background: rgba(var(--fg-rgb), 0.42);
}

.displays--activeWindow .display:nth-child(2) .display-window {
  display: block;
}

.behavior-warn {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(240, 170, 90, 0.95);
}

.behavior-action {
  flex: none;
  padding: 6px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.behavior-action:hover,
.behavior-action:focus-visible {
  background: rgba(var(--fg-rgb), 0.06);
  outline: none;
}
</style>
