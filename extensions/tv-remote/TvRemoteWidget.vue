<script setup lang="ts">
import { h, ref } from "vue";
import type { TvRemoteKey } from "@sdk/contract/sdk";
import SpotifyMark from "@sdk/brand/SpotifyMark.vue";
import { APP_MARKS } from "./appMarks";
import type { TvRemoteModel } from "./widgets/tvRemote";

const props = defineProps<{ model: TvRemoteModel }>();
const {
  phase,
  candidates,
  searching,
  manualHost,
  tvHost,
  stickHost,
  apps,
  busy,
  error,
  search,
  choose,
  submitCode,
  restart,
  press,
  launch,
} = props.model;
const code = ref("");

const digits: TvRemoteKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Stroke paths on a 24px grid (Lucide shapes), drawn in the button's text colour. */
const icons = {
  power: ["M12 2v10", "M18.4 6.6a9 9 0 1 1-12.77.04"],
  guide: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  home: ["M3 10.5 12 3l9 7.5", "M5 9v11h5v-6h4v6h5V9"],
  back: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  playPause: ["M3 5v14l9-7z", "M16 5v14", "M21 5v14"],
  mute: ["M11 5 6 9H2v6h4l5 4z", "m22 9-6 6", "m16 9 6 6"],
  up: ["m18 15-6-6-6 6"],
  down: ["m6 9 6 6 6-6"],
  left: ["m15 18-6-6 6-6"],
  right: ["m9 18 6-6-6-6"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
};

const Icon = (props: { name: keyof typeof icons }) =>
  h(
    "svg",
    {
      class: "tvr-icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    icons[props.name].map((d) => h("path", { d })),
  );
Icon.props = ["name"];

function back() {
  code.value = "";
  restart();
}
</script>

<template>
  <div class="tvr">
    <p v-if="phase === 'loading'" class="tvr-hint">Connecting…</p>

    <div v-else-if="phase === 'findTv' || phase === 'findStick'" class="tvr-setup">
      <template v-if="phase === 'findTv'">
        <p class="tvr-title">Connect your Samsung TV</p>
        <p class="tvr-hint">The TV asks once whether to allow Kavibay.</p>
      </template>
      <template v-else>
        <p class="tvr-title">Connect the stick</p>
        <p class="tvr-hint">
          waipu.tv 4K Stick or another Android TV device. It shows a code next.
          Volume and power stay with the TV.
        </p>
      </template>

      <p v-if="busy" class="tvr-wait">
        {{ phase === "findTv" ? "Choose Allow on the TV…" : "Asking the stick for a code…" }}
      </p>
      <template v-else>
        <button
          v-for="device in candidates"
          :key="device.host"
          type="button"
          class="tvr-device"
          @pointerdown.stop
          @click="choose(device.host)"
        >
          <span class="tvr-device-name">{{ device.name }}</span>
          <span class="tvr-device-host">{{ device.host }}</span>
        </button>
        <p v-if="searching" class="tvr-hint">Searching the network…</p>
        <p v-else-if="!candidates.length" class="tvr-hint">Nothing found. Is it switched on?</p>
        <button
          v-if="!searching"
          type="button"
          class="tvr-link"
          @pointerdown.stop
          @click="search"
        >
          Search again
        </button>

        <div class="tvr-manual">
          <input
            v-model="manualHost"
            class="tvr-input"
            type="text"
            inputmode="decimal"
            placeholder="or IP address, e.g. 192.168.178.31"
            autocomplete="off"
            spellcheck="false"
            aria-label="IP address"
            @pointerdown.stop
            @keyup.enter="manualHost.trim() && choose(manualHost)"
          />
          <button
            type="button"
            class="tvr-primary"
            :disabled="!manualHost.trim()"
            @pointerdown.stop
            @click="choose(manualHost)"
          >
            Connect
          </button>
        </div>
      </template>
      <button
        v-if="phase === 'findStick' || tvHost"
        type="button"
        class="tvr-link"
        :disabled="busy"
        @pointerdown.stop
        @click="back"
      >
        Start over
      </button>
    </div>

    <div v-else-if="phase === 'code'" class="tvr-setup">
      <p class="tvr-title">Enter the code</p>
      <p class="tvr-hint">The TV shows a six-character code.</p>
      <input
        v-model="code"
        class="tvr-input tvr-code"
        type="text"
        maxlength="6"
        placeholder="A1B2C3"
        autocomplete="off"
        spellcheck="false"
        aria-label="Pairing code"
        @pointerdown.stop
        @keyup.enter="code.trim().length === 6 && submitCode(code)"
      />
      <button
        type="button"
        class="tvr-primary"
        :disabled="busy || code.trim().length !== 6"
        @pointerdown.stop
        @click="submitCode(code)"
      >
        {{ busy ? "Pairing…" : "Pair" }}
      </button>
      <button type="button" class="tvr-link" :disabled="busy" @pointerdown.stop @click="back">Start over</button>
    </div>

    <div v-else class="tvr-remote">
      <div class="tvr-top">
        <button type="button" class="tvr-round tvr-power" aria-label="Power" @pointerdown.stop @click="press('power')">
          <Icon name="power" />
        </button>
        <button type="button" class="tvr-round" aria-label="Guide" @pointerdown.stop @click="press('guide')">
          <Icon name="guide" />
        </button>
      </div>

      <div class="tvr-ring">
        <button type="button" class="tvr-arrow tvr-up" aria-label="Up" @pointerdown.stop @click="press('up')">
          <Icon name="up" />
        </button>
        <button type="button" class="tvr-arrow tvr-left" aria-label="Left" @pointerdown.stop @click="press('left')">
          <Icon name="left" />
        </button>
        <button type="button" class="tvr-ok" @pointerdown.stop @click="press('ok')">OK</button>
        <button type="button" class="tvr-arrow tvr-right" aria-label="Right" @pointerdown.stop @click="press('right')">
          <Icon name="right" />
        </button>
        <button type="button" class="tvr-arrow tvr-down" aria-label="Down" @pointerdown.stop @click="press('down')">
          <Icon name="down" />
        </button>
      </div>

      <div class="tvr-row">
        <button type="button" class="tvr-round" aria-label="Back" @pointerdown.stop @click="press('back')">
          <Icon name="back" />
        </button>
        <button type="button" class="tvr-round" aria-label="Home" @pointerdown.stop @click="press('home')">
          <Icon name="home" />
        </button>
        <button type="button" class="tvr-round" aria-label="Play or pause" @pointerdown.stop @click="press('playPause')">
          <Icon name="playPause" />
        </button>
      </div>

      <div class="tvr-row">
        <div class="tvr-rocker">
          <button type="button" aria-label="Volume up" @pointerdown.stop @click="press('volumeUp')">
            <Icon name="plus" />
          </button>
          <span class="tvr-rocker-label">VOL</span>
          <button type="button" aria-label="Volume down" @pointerdown.stop @click="press('volumeDown')">
            <Icon name="minus" />
          </button>
        </div>
        <button type="button" class="tvr-round" aria-label="Mute" @pointerdown.stop @click="press('mute')">
          <Icon name="mute" />
        </button>
        <div class="tvr-rocker">
          <button type="button" aria-label="Channel up" @pointerdown.stop @click="press('channelUp')">
            <Icon name="up" />
          </button>
          <span class="tvr-rocker-label">CH</span>
          <button type="button" aria-label="Channel down" @pointerdown.stop @click="press('channelDown')">
            <Icon name="down" />
          </button>
        </div>
      </div>

      <div v-if="apps.length" class="tvr-apps">
        <button
          v-for="app in apps"
          :key="app.id"
          type="button"
          class="tvr-app"
          :aria-label="app.label"
          v-tip="app.label"
          @pointerdown.stop
          @click="launch(app.id)"
        >
          <SpotifyMark v-if="app.id === 'spotify'" class="tvr-app-mark" :size="20" />
          <svg
            v-else-if="APP_MARKS[app.id]"
            class="tvr-app-mark"
            :viewBox="APP_MARKS[app.id]!.viewBox"
            :fill="APP_MARKS[app.id]!.color ?? 'currentColor'"
            aria-hidden="true"
          >
            <path v-for="d in APP_MARKS[app.id]!.paths" :key="d" :d="d" />
          </svg>
          <template v-else>{{ app.label }}</template>
        </button>
      </div>

      <div class="tvr-digits">
        <button
          v-for="digit in digits"
          :key="digit"
          type="button"
          class="tvr-digit"
          @pointerdown.stop
          @click="press(digit)"
        >
          {{ digit }}
        </button>
        <button type="button" class="tvr-digit tvr-zero" @pointerdown.stop @click="press('0')">0</button>
      </div>

      <button
        type="button"
        class="tvr-link"
        :title="stickHost ? `TV ${tvHost} · stick ${stickHost}` : `TV ${tvHost}`"
        @pointerdown.stop
        @click="back"
      >
        Change devices
      </button>
    </div>

    <p v-if="error" class="tvr-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.tvr {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 4px 2px;
  color: rgba(var(--fg-rgb), 0.92);
  font-family: inherit;
}

.tvr-setup {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tvr-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.tvr-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.55);
}

.tvr-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.15);
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.06);
  color: inherit;
  font: inherit;
  font-size: 14px;
  outline: none;
}

.tvr-input:focus {
  border-color: rgba(var(--fg-rgb), 0.4);
}

.tvr-code {
  font-family: ui-monospace, monospace;
  font-size: 20px;
  letter-spacing: 0.3em;
  text-align: center;
  text-transform: uppercase;
}

.tvr-primary {
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.9);
  color: rgb(var(--surface-bg-rgb));
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.tvr-primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.tvr-link {
  align-self: center;
  padding: 2px 6px;
  border: none;
  background: none;
  color: rgba(var(--fg-rgb), 0.45);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.tvr-wait {
  margin: 8px 0;
  font-size: 13px;
  font-weight: 500;
}

.tvr-device {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tvr-device:hover {
  background: rgba(var(--fg-rgb), 0.14);
}

.tvr-device-name {
  font-size: 14px;
  font-weight: 600;
}

.tvr-device-host {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.tvr-manual {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.tvr-link:hover {
  color: rgba(var(--fg-rgb), 0.8);
}

.tvr-remote {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 4px;
}

button:focus {
  outline: none;
}

button:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.tvr-icon {
  width: 18px;
  height: 18px;
}

.tvr-top,
.tvr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 172px;
}

.tvr-round,
.tvr-arrow,
.tvr-ok,
.tvr-rocker button,
.tvr-digit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: rgba(var(--fg-rgb), 0.85);
  font: inherit;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, transform 0.08s ease;
}

.tvr-round {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.08);
}

.tvr-round:hover,
.tvr-digit:hover,
.tvr-rocker button:hover,
.tvr-arrow:hover {
  background: rgba(var(--fg-rgb), 0.14);
  color: rgb(var(--fg-rgb));
}

.tvr-round:active,
.tvr-digit:active,
.tvr-ok:active,
.tvr-rocker button:active,
.tvr-arrow:active {
  transform: scale(0.92);
  background: rgba(var(--fg-rgb), 0.2);
}

.tvr-power {
  color: #ff6259;
  background: rgba(255, 98, 89, 0.14);
}

.tvr-power:hover {
  color: #ff7a72;
  background: rgba(255, 98, 89, 0.22);
}

/* The direction pad: one disc, four targets on its rim and OK in the middle. */
.tvr-ring {
  position: relative;
  width: 172px;
  height: 172px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.07);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.06);
}

.tvr-arrow {
  position: absolute;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
}

.tvr-up { top: 4px; left: 60px; }
.tvr-down { bottom: 4px; left: 60px; }
.tvr-left { left: 4px; top: 60px; }
.tvr-right { right: 4px; top: 60px; }

.tvr-ok {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 66px;
  height: 66px;
  margin: -33px 0 0 -33px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.16);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.tvr-ok:hover {
  background: rgba(var(--fg-rgb), 0.22);
}

/* Volume and channel as rockers: one capsule, press its top or bottom half. */
.tvr-rocker {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 48px;
  border-radius: 24px;
  background: rgba(var(--fg-rgb), 0.08);
  overflow: hidden;
}

.tvr-rocker button {
  width: 48px;
  height: 44px;
  background: transparent;
}

.tvr-rocker-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(var(--fg-rgb), 0.4);
}

/* Logo-only keys, like the app buttons on a real remote; the name is the tooltip. */
.tvr-apps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 172px;
}

.tvr-app {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 6px;
  border: none;
  border-radius: 17px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.9);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.08s ease;
}

.tvr-app:hover {
  background: rgba(var(--fg-rgb), 0.12);
}

.tvr-app:active {
  transform: scale(0.95);
}

/* Square marks get 20px; a wordmark like Disney+ keeps its ratio up to 40px. */
.tvr-app-mark {
  flex: none;
  width: auto;
  height: 20px;
  max-width: 40px;
}

.tvr-digits {
  display: grid;
  grid-template-columns: repeat(3, 48px);
  gap: 8px 14px;
}

.tvr-digit {
  height: 34px;
  border-radius: 17px;
  background: rgba(var(--fg-rgb), 0.06);
  font-size: 15px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.tvr-zero {
  grid-column: 2;
}

.tvr-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: #ff6b63;
}
</style>
