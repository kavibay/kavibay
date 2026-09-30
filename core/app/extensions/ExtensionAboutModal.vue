<script setup lang="ts">
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { setClickThroughPaused, syncInteractiveRegions } from "../system/clickThrough";
import { useExtensionAboutModal } from "./useExtensionAboutModal";

const { content, open, hide } = useExtensionAboutModal();
const headingEl = ref<HTMLHeadingElement | null>(null);
const debugOpen = ref(false);

/** The dialog title already renders the README's leading H1. */
const readmeBody = computed(() =>
  (content.value?.readme ?? "").replace(/^\s*#\s+.+\r?\n+/, "").trim(),
);
const debugUi = computed(() => JSON.stringify({ ui: content.value?.ui }, null, 2));

function onBackdropPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) hide();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hide();
}

watch(open, async (isOpen) => {
  debugOpen.value = false;
  setClickThroughPaused(isOpen);
  await nextTick();
  if (isOpen) headingEl.value?.focus();
  syncInteractiveRegions();
});

onMounted(() => document.addEventListener("keydown", onDocumentKeydown, true));
onUnmounted(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true);
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div
    v-if="open && content"
    class="extension-about-backdrop"
    data-interactive
    @pointerdown="onBackdropPointerDown"
  >
    <section
      class="extension-about-modal"
      data-interactive
      role="dialog"
      aria-modal="true"
      :aria-label="`About ${content.title}`"
      @pointerdown.stop
    >
      <header class="extension-about-header">
        <h2 ref="headingEl" tabindex="-1">About {{ content.title }}</h2>
        <DialogCloseButton label="Close about dialog" @click="hide" />
      </header>
      <p v-if="readmeBody" class="extension-about-readme">{{ readmeBody }}</p>
      <footer class="extension-about-footer">
        <button
          type="button"
          class="extension-about-debug-toggle"
          :aria-expanded="debugOpen"
          @click="debugOpen = !debugOpen"
        >
          Debug
        </button>
      </footer>
      <pre v-if="debugOpen" class="extension-about-debug">{{ debugUi }}</pre>
    </section>
  </div>
</template>

<style scoped>
h2[tabindex="-1"] { outline: none; }

.extension-about-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.35);
}

.extension-about-modal {
  width: min(480px, 100%);
  max-height: min(440px, 100%);
  overflow: auto;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: var(--surface-radius, 16px);
  background: rgb(var(--surface-bg-rgb));
  box-shadow: var(--surface-box-shadow);
}

.extension-about-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.1);
}

.extension-about-header h2 {
  margin: 0;
  font-size: 16px;
}

.extension-about-readme {
  margin: 0;
  padding: 18px;
  color: rgba(var(--fg-rgb), 0.8);
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.extension-about-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 18px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.extension-about-debug-toggle {
  padding: 6px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.78);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.extension-about-debug-toggle:hover,
.extension-about-debug-toggle:focus-visible {
  border-color: rgba(var(--fg-rgb), 0.3);
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.98);
}

.extension-about-debug {
  margin: 0;
  padding: 14px 18px 18px;
  overflow: auto;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  background: rgba(var(--fg-rgb), 0.035);
  color: rgba(var(--fg-rgb), 0.75);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
</style>
