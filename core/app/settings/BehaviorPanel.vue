<script setup lang="ts">
import { emit } from "@tauri-apps/api/event";
import {
  openMonitorOptions,
  WIDGET_LAYOUT_MODE_OPTIONS,
  type OpenMonitor,
  type WidgetLayoutMode,
} from "./appearanceLogic";
import { doubleTapKeyLabel, keyPlatform } from "../host/shortcutHints";
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
    <header class="behavior-head">
      <h2 class="behavior-title">Behavior</h2>
      <p class="behavior-lead">How the cockpit reacts to interaction.</p>
    </header>

    <section v-if="autostartSupported" class="behavior-block">
      <h3 class="behavior-block-title">Startup</h3>
      <label class="toggle">
        <span class="toggle-copy">
          <span class="toggle-title">Start Kavibay when I log in</span>
          <span class="toggle-hint">
            Waits in the tray, out of the way, until you tap {{ doubleTapKey }} twice
          </span>
        </span>
        <span class="switch">
          <input type="checkbox" :checked="autostartEnabled" @change="onAutostart" />
          <span class="switch-ui" />
        </span>
      </label>
      <p v-if="autostartError" class="behavior-warn">
        Could not change the startup entry: {{ autostartError }}
      </p>
    </section>

    <section class="behavior-block">
      <h3 class="behavior-block-title">Cockpit</h3>
      <label class="toggle">
        <span class="toggle-copy">
          <span class="toggle-title">Hide on outside click</span>
          <span class="toggle-hint">Click empty space to hide the cockpit and all widgets</span>
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
    </section>

    <section class="behavior-block">
      <h3 class="behavior-block-title">Widget layout</h3>
      <p class="behavior-block-hint">
        How widgets move and resize on the desk. Switching mode does not move
        existing widgets until you drag them again.
      </p>
      <div class="choice-row choice-row--2" role="listbox" aria-label="Widget layout">
        <button
          v-for="opt in WIDGET_LAYOUT_MODE_OPTIONS"
          :key="opt.id"
          type="button"
          class="choice"
          role="option"
          :aria-selected="widgetLayoutMode === opt.id"
          :class="{ 'choice--active': widgetLayoutMode === opt.id }"
          @click="onWidgetLayoutMode(opt.id)"
        >
          <span class="layout-preview" :class="`layout-preview--${opt.id}`" aria-hidden="true">
            <span class="layout-tile" />
            <span class="layout-tile" />
            <span class="layout-tile" />
          </span>
          <span class="choice-name">{{ opt.name }}</span>
          <span class="choice-hint">{{ opt.hint }}</span>
        </button>
      </div>
    </section>

    <section class="behavior-block">
      <h3 class="behavior-block-title">Open on</h3>
      <p class="behavior-block-hint">
        Which display a double tap on {{ doubleTapKey }} covers when multiple screens are
        available. Shift+Ctrl+Space always opens on the screen under the mouse.
      </p>
      <div class="choice-row" role="listbox" aria-label="Open on">
        <button
          v-for="opt in openMonitors"
          :key="opt.id"
          type="button"
          class="choice"
          role="option"
          :aria-selected="openMonitor === opt.id"
          :aria-label="`${opt.name}. ${opt.hint}`"
          :class="{ 'choice--active': openMonitor === opt.id }"
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
          <span class="choice-name">{{ opt.name }}</span>
        </button>
      </div>
    </section>

    <section class="behavior-block">
      <h3 class="behavior-block-title">Developer</h3>
      <label class="toggle">
        <span class="toggle-copy">
          <span class="toggle-title">Developer Extensions</span>
          <span class="toggle-hint">
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
      <label v-if="developerExtensionsEnabled" class="toggle toggle--warn">
        <span class="toggle-copy">
          <span class="toggle-title">Skip the Wizard's consent step</span>
          <span class="toggle-hint">
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

    <section class="behavior-block">
      <h3 class="behavior-block-title">Tour</h3>
      <p class="behavior-block-hint">
        Replay the getting-started tour (palette → gallery → add a widget).
      </p>
      <button type="button" class="behavior-action" @click="onReplayOnboarding">
        Replay tour
      </button>
    </section>
  </div>
</template>

<style scoped>
.behavior {
  display: flex;
  flex-direction: column;
  gap: 22px;
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

.behavior-lead,
.behavior-block-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.behavior-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.behavior-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  cursor: pointer;
}

.toggle:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.toggle--warn {
  margin-left: 12px;
  background: rgba(240, 170, 90, 0.1);
}

.toggle--warn:hover {
  background: rgba(240, 170, 90, 0.16);
}

.toggle-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.toggle-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.toggle-hint {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.45);
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  margin-top: 1px;
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

.switch input:focus-visible + .switch-ui {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.choice-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.choice-row--2 {
  grid-template-columns: 1fr 1fr;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
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

.layout-preview,
.displays {
  width: 100%;
  height: 52px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.08);
}

.layout-preview {
  position: relative;
  overflow: hidden;
}

.layout-tile {
  position: absolute;
  border-radius: 4px;
  background: rgba(var(--fg-rgb), 0.22);
}

.layout-preview--freehand .layout-tile:nth-child(1) {
  top: 10px;
  left: 10px;
  width: 38%;
  height: 44%;
}

.layout-preview--freehand .layout-tile:nth-child(2) {
  top: 8px;
  right: 12px;
  width: 28%;
  height: 30%;
}

.layout-preview--freehand .layout-tile:nth-child(3) {
  right: 16%;
  bottom: 8px;
  width: 34%;
  height: 36%;
}

.layout-preview--grid {
  background-image:
    linear-gradient(rgba(var(--fg-rgb), 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--fg-rgb), 0.07) 1px, transparent 1px);
  background-size: 10px 10px;
  background-position: 6px 6px;
}

.layout-preview--grid .layout-tile:nth-child(1) {
  top: 8px;
  left: 8px;
  width: 30%;
  height: 36%;
}

.layout-preview--grid .layout-tile:nth-child(2) {
  top: 8px;
  left: calc(8px + 30% + 8px);
  width: 30%;
  height: 36%;
}

.layout-preview--grid .layout-tile:nth-child(3) {
  top: calc(8px + 36% + 8px);
  left: 8px;
  width: 30%;
  height: 36%;
}

.displays {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
  padding: 0 8px 10px;
}

.display {
  position: relative;
  width: 26%;
  max-width: 34px;
  height: 22px;
  border-radius: 3px;
  background: rgba(var(--fg-rgb), 0.12);
}

.display::after {
  content: "";
  position: absolute;
  bottom: -5px;
  left: 50%;
  width: 8px;
  height: 3px;
  border-radius: 0 0 1px 1px;
  background: rgba(var(--fg-rgb), 0.16);
  transform: translateX(-50%);
}

.display-window {
  display: none;
  position: absolute;
  inset: 4px 3px 3px;
  border-radius: 2px;
  background: rgba(var(--fg-rgb), 0.28);
}

.display-pointer {
  display: none;
  position: absolute;
  width: 0;
  height: 0;
  border-top: 8px solid rgba(var(--fg-rgb), 0.85);
  border-right: 6px solid transparent;
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
  top: 14px;
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
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(240, 170, 90, 0.95);
}

.behavior-action {
  align-self: flex-start;
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.behavior-action:hover,
.behavior-action:focus-visible {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  outline: none;
}

@media (max-width: 560px) {
  .choice-row,
  .choice-row--2 {
    grid-template-columns: 1fr;
  }
}
</style>
