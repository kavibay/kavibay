<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onMounted, onUnmounted, ref } from "vue";
import keypress001 from "../assets/demo-keypress/Single Keys/keypress-001.wav";
import keypress005 from "../assets/demo-keypress/Single Keys/keypress-005.wav";
import keypress009 from "../assets/demo-keypress/Single Keys/keypress-009.wav";
import keypress013 from "../assets/demo-keypress/Single Keys/keypress-013.wav";
import keypress017 from "../assets/demo-keypress/Single Keys/keypress-017.wav";
import keypress021 from "../assets/demo-keypress/Single Keys/keypress-021.wav";
import keypress025 from "../assets/demo-keypress/Single Keys/keypress-025.wav";
import keypress029 from "../assets/demo-keypress/Single Keys/keypress-029.wav";

const enabled = ref(false);
const hotkey = ref("");
const visible = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let unlisten: UnlistenFn | undefined;
let unlistenMode: UnlistenFn | undefined;
let lastSoundAt = 0;

const keys = computed(() => hotkey.value.split("+").filter(Boolean));
const keypressSounds = [
  keypress001,
  keypress005,
  keypress009,
  keypress013,
  keypress017,
  keypress021,
  keypress025,
  keypress029,
];
let lastSoundIndex = -1;

/** Replace the current hint instead of queuing stale keys during a live demo. */
function show(label: string) {
  hotkey.value = label;
  visible.value = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, 1000);
}

function keyLabel(event: KeyboardEvent): string | null {
  if (event.repeat || (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey)) {
    return null;
  }
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("CTRL");
  if (event.altKey) parts.push("ALT");
  if (event.shiftKey) parts.push("SHIFT");
  if (event.metaKey) parts.push("META");

  const named: Record<string, string> = {
    ArrowDown: "↓",
    ArrowLeft: "<-",
    ArrowRight: "->",
    ArrowUp: "↑",
    " ": "SPACE",
  };
  parts.push(named[event.key] ?? event.key.toUpperCase());
  return parts.join("+");
}

function onKeydown(event: KeyboardEvent) {
  if (!enabled.value) return;
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
  playKeypress();
  const label = keyLabel(event);
  if (!label) return;
  show(label);
}

/** Randomised samples keep a sentence from sounding like one repeated click. */
function playKeypress() {
  // A native global shortcut can also reach the webview. Keep it to one sound.
  const now = performance.now();
  if (now - lastSoundAt < 35) return;
  lastSoundAt = now;
  let index = Math.floor(Math.random() * keypressSounds.length);
  if (keypressSounds.length > 1 && index === lastSoundIndex) {
    index = (index + 1) % keypressSounds.length;
  }
  lastSoundIndex = index;
  const sound = new Audio(keypressSounds[index]);
  sound.volume = 0.34;
  void sound.play().catch(() => {
    // Browsers may block audio before the first user gesture; the visual hint
    // still works, and the next genuine keypress is allowed to play.
  });
}

onMounted(async () => {
  enabled.value = await invoke<boolean>("demo_mode_enabled");
  window.addEventListener("keydown", onKeydown, true);
  unlistenMode = await listen<boolean>("demo:mode", (event) => {
    enabled.value = event.payload;
    if (!event.payload) visible.value = false;
  });
  unlisten = await listen<string>("demo:hotkey", (event) => {
    playKeypress();
    show(event.payload);
  });
});

onUnmounted(() => {
  if (hideTimer) clearTimeout(hideTimer);
  window.removeEventListener("keydown", onKeydown, true);
  unlisten?.();
  unlistenMode?.();
});
</script>

<template>
  <Transition name="demo-hotkey">
    <output v-if="enabled && visible" class="demo-hotkey" aria-live="polite">
      <kbd v-for="(key, index) in keys" :key="`${key}-${index}`">
        <svg
          v-if="key === '<-'"
          class="demo-hotkey-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-label="Left arrow"
        >
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
        <svg
          v-else-if="key === '->'"
          class="demo-hotkey-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-label="Right arrow"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
        <span v-else>{{ key }}</span>
      </kbd>
    </output>
  </Transition>
</template>

<style scoped>
.demo-hotkey {
  position: fixed;
  bottom: 72px;
  left: 50%;
  z-index: 1000;
  display: flex;
  gap: 7px;
  transform: translateX(-50%);
  pointer-events: none;
}

.demo-hotkey kbd {
  display: grid;
  min-width: 42px;
  height: 39px;
  padding: 0 12px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-bottom: 3px solid rgba(0, 0, 0, 0.62);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(82, 84, 94, 0.96), rgba(43, 44, 51, 0.96));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 4px 10px rgba(0, 0, 0, 0.34);
  color: rgba(255, 255, 255, 0.96);
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-shadow: 0 1px rgba(0, 0, 0, 0.4);
}

.demo-hotkey-arrow {
  width: 18px;
  height: 18px;
}

.demo-hotkey-enter-active,
.demo-hotkey-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.demo-hotkey-enter-from,
.demo-hotkey-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(18px);
}
</style>
