<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CommandPalette from "./palette/CommandPalette.vue";
import WidgetHost from "./host/WidgetHost.vue";
import ExtensionAboutModal from "./extensions/ExtensionAboutModal.vue";
import OnboardingCoach from "./onboarding/OnboardingCoach.vue";
import SettingsModal from "./settings/SettingsModal.vue";
import { useSettingsModal } from "./settings/useSettingsModal";
import { useRegionSync } from "./system/clickThrough";
import FloatingTipHost from "./system/FloatingTipHost.vue";
import CommandHost from "./extension-host/ui/CommandHost.vue";
import { colorPickerPicking } from "../../extensions/color-picker/colorPickerSession";

useRegionSync();

const { open: settingsOpen, show: showSettings } = useSettingsModal();
let unlistenSettingsShow: UnlistenFn | undefined;

/** Hide window on Esc only when Settings / color-pick are not handling it. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (settingsOpen.value || colorPickerPicking.value) return;
  void getCurrentWindow().hide();
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  // Tray → Settings: open the same modal as the palette Settings command.
  unlistenSettingsShow = await listen("settings:show", () => {
    showSettings();
  });
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  unlistenSettingsShow?.();
});
</script>

<template>
  <div class="app-shell">
    <WidgetHost>
      <template #center>
        <CommandPalette />
      </template>
      <template #overlay>
        <SettingsModal />
        <ExtensionAboutModal />
        <OnboardingCoach />
      </template>
    </WidgetHost>
  </div>
  <FloatingTipHost />
  <!-- Argument prompts and confirmations for extension-host commands. A command
       need not belong to any widget, so this sits at the root rather than in a card. -->
  <CommandHost />
</template>

<style scoped>
/* Does not catch pointer events itself — the palette, handle, and widgets set pointer-events
   back to auto. Everything between them is a gap and passes through to the OS. */
.app-shell {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
</style>
