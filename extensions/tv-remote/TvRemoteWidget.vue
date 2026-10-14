<script setup lang="ts">
import { ref } from "vue";
import type { TvRemoteKey } from "@sdk/contract/sdk";
import type { TvRemoteModel } from "./widgets/tvRemote";

const props = defineProps<{ model: TvRemoteModel }>();
const { phase, host, busy, error, startPairing, finishPairing, changeTv, press } = props.model;
const code = ref("");

const digits: TvRemoteKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function submitCode() {
  finishPairing(code.value);
}

function restart() {
  code.value = "";
  changeTv();
}
</script>

<template>
  <div class="tvr">
    <p v-if="phase === 'loading'" class="tvr-hint">Connecting…</p>

    <div v-else-if="phase === 'setup'" class="tvr-setup">
      <p class="tvr-title">Pair a TV</p>
      <p class="tvr-hint">
        Android TV or Google TV on this network, e.g. the waipu.tv 4K Stick.
        Its IP address is under Settings › Network &amp; Internet.
      </p>
      <input
        v-model="host"
        class="tvr-input"
        type="text"
        inputmode="decimal"
        placeholder="192.168.178.32"
        autocomplete="off"
        spellcheck="false"
        aria-label="TV IP address"
        @pointerdown.stop
        @keyup.enter="startPairing"
      />
      <button
        type="button"
        class="tvr-primary"
        :disabled="busy || !host.trim()"
        @pointerdown.stop
        @click="startPairing"
      >
        {{ busy ? "Asking the TV…" : "Pair" }}
      </button>
    </div>

    <div v-else-if="phase === 'pairing'" class="tvr-setup">
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
        @keyup.enter="submitCode"
      />
      <button
        type="button"
        class="tvr-primary"
        :disabled="busy || code.trim().length !== 6"
        @pointerdown.stop
        @click="submitCode"
      >
        {{ busy ? "Pairing…" : "Pair" }}
      </button>
      <button type="button" class="tvr-link" @pointerdown.stop @click="restart">Back</button>
    </div>

    <div v-else class="tvr-remote">
      <div class="tvr-row">
        <button type="button" class="tvr-key tvr-power" aria-label="Power" @pointerdown.stop @click="press('power')">⏻</button>
        <button type="button" class="tvr-key" aria-label="Guide" @pointerdown.stop @click="press('guide')">☰</button>
        <button type="button" class="tvr-key" aria-label="Home" @pointerdown.stop @click="press('home')">⌂</button>
      </div>

      <div class="tvr-pad">
        <button type="button" class="tvr-dir tvr-up" aria-label="Up" @pointerdown.stop @click="press('up')">▲</button>
        <button type="button" class="tvr-dir tvr-left" aria-label="Left" @pointerdown.stop @click="press('left')">◀</button>
        <button type="button" class="tvr-ok" aria-label="OK" @pointerdown.stop @click="press('ok')">OK</button>
        <button type="button" class="tvr-dir tvr-right" aria-label="Right" @pointerdown.stop @click="press('right')">▶</button>
        <button type="button" class="tvr-dir tvr-down" aria-label="Down" @pointerdown.stop @click="press('down')">▼</button>
      </div>

      <div class="tvr-row">
        <button type="button" class="tvr-key" aria-label="Back" @pointerdown.stop @click="press('back')">↩</button>
        <button type="button" class="tvr-key" aria-label="Play or pause" @pointerdown.stop @click="press('playPause')">⏯</button>
        <button type="button" class="tvr-key" aria-label="Mute" @pointerdown.stop @click="press('mute')">🔇</button>
      </div>

      <div class="tvr-rockers">
        <div class="tvr-rocker">
          <button type="button" class="tvr-key" aria-label="Volume up" @pointerdown.stop @click="press('volumeUp')">+</button>
          <span class="tvr-rocker-label">VOL</span>
          <button type="button" class="tvr-key" aria-label="Volume down" @pointerdown.stop @click="press('volumeDown')">−</button>
        </div>
        <div class="tvr-rocker">
          <button type="button" class="tvr-key" aria-label="Channel up" @pointerdown.stop @click="press('channelUp')">⌃</button>
          <span class="tvr-rocker-label">CH</span>
          <button type="button" class="tvr-key" aria-label="Channel down" @pointerdown.stop @click="press('channelDown')">⌄</button>
        </div>
      </div>

      <div class="tvr-digits">
        <button
          v-for="digit in digits"
          :key="digit"
          type="button"
          class="tvr-key"
          @pointerdown.stop
          @click="press(digit)"
        >
          {{ digit }}
        </button>
        <button type="button" class="tvr-key tvr-zero" @pointerdown.stop @click="press('0')">0</button>
      </div>

      <button type="button" class="tvr-link" @pointerdown.stop @click="restart">{{ host }} · change</button>
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

.tvr-link:hover {
  color: rgba(var(--fg-rgb), 0.8);
}

.tvr-remote {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tvr-row,
.tvr-digits {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.tvr-key,
.tvr-dir,
.tvr-ok {
  height: 36px;
  border: none;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.08s ease;
}

.tvr-key:hover,
.tvr-dir:hover,
.tvr-ok:hover {
  background: rgba(var(--fg-rgb), 0.14);
}

.tvr-key:active,
.tvr-dir:active,
.tvr-ok:active {
  transform: scale(0.94);
  background: rgba(var(--fg-rgb), 0.2);
}

.tvr-power {
  color: #ff5f57;
}

.tvr-pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-areas:
    ". up ."
    "left ok right"
    ". down .";
  gap: 6px;
  align-self: center;
  width: 150px;
}

.tvr-up { grid-area: up; }
.tvr-left { grid-area: left; }
.tvr-right { grid-area: right; }
.tvr-down { grid-area: down; }

.tvr-dir {
  height: 40px;
  font-size: 11px;
}

.tvr-ok {
  grid-area: ok;
  height: 40px;
  border-radius: 50%;
  aspect-ratio: 1;
  justify-self: center;
  background: rgba(var(--fg-rgb), 0.16);
  font-size: 12px;
  font-weight: 600;
}

.tvr-rockers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tvr-rocker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.tvr-rocker-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: center;
  color: rgba(var(--fg-rgb), 0.45);
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
