<script setup lang="ts">
/**
 * The host's answer to a refused declared request, shown over the widget.
 *
 * The twin of a contract widget's connect prompt: the package does not explain
 * its own access, because it cannot tell the three fixes apart and guessed
 * wrong. "account" opens a dialog with this instance's connection chooser for
 * exactly the credential types the package declares — the same component the
 * widget's settings popover renders, so choosing and granting work as there.
 */
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import ConnectionSelect from "../settings/credentials/ConnectionSelect.vue";
import { listCredentialTypes } from "../settings/credentials/credentialsApi";
import { widgetConnectionOwner } from "../settings/credentials/connections";
import { useSettingsModal } from "../settings/useSettingsModal";
import { setClickThroughPaused, syncInteractiveRegions } from "../system/clickThrough";
import { packageIdBehind, type AccessProblem } from "./accessProblem";

const props = defineProps<{ problem: AccessProblem; extId: string; instanceId: string }>();
/** The dialog closed; whatever was chosen there is worth another try. */
const emit = defineEmits<{ retry: [] }>();

const pkg = computed(() => packageIdBehind(props.extId));
const types = ref<string[]>([]);
const names = ref<string[]>([]);

watch(
  () => pkg.value.id,
  async (id) => {
    try {
      const [declared, catalog] = await Promise.all([
        invoke<string[]>("connections_package_types", { id }),
        listCredentialTypes(),
      ]);
      types.value = declared;
      names.value = declared.map((type) => catalog.find((entry) => entry.id === type)?.displayName ?? type);
    } catch {
      // Unknown types only cost the name in the sentence; the actions still work.
      types.value = [];
      names.value = [];
    }
  },
  { immediate: true },
);

const what = computed(() => names.value.join(", ") || "an account");

const copy = computed(() => {
  switch (props.problem) {
    case "enable":
      return pkg.value.draft
        ? { line: "Save this widget to turn on its network access.", action: undefined }
        : { line: "This widget's network access is off or has changed.", action: "Review" };
    case "reconnect":
      return { line: `Your ${what.value} sign-in expired.`, action: "Reconnect" };
    default:
      return { line: `This widget needs ${what.value}.`, action: "Choose account" };
  }
});

const settings = useSettingsModal();
const dialogOpen = ref(false);
const headingEl = ref<HTMLHeadingElement | null>(null);

function act(): void {
  if (props.problem === "enable") settings.showSection("extensions");
  else if (props.problem === "reconnect") settings.showSection("credentials", types.value[0]);
  else dialogOpen.value = true;
}

function close(): void {
  dialogOpen.value = false;
  emit("retry");
}

// "Add one in Settings → Credentials" opens the Settings modal; two stacked
// dialogs would leave this one behind it, answering nothing.
watch(settings.open, (open) => {
  if (open && dialogOpen.value) close();
});

watch(dialogOpen, async (open) => {
  setClickThroughPaused(open);
  await nextTick();
  if (open) headingEl.value?.focus();
  syncInteractiveRegions();
});
onUnmounted(() => {
  if (dialogOpen.value) setClickThroughPaused(false);
});
</script>

<template>
  <div class="access-bar" role="status">
    <span class="access-line">{{ copy.line }}</span>
    <button v-if="copy.action" type="button" class="access-action" @click="act">{{ copy.action }}</button>
  </div>

  <Teleport to="body">
    <div
      v-if="dialogOpen"
      class="access-backdrop"
      data-interactive
      @pointerdown.self="close"
      @keydown.esc.stop.prevent="close"
    >
      <section class="access-dialog" data-interactive role="dialog" aria-modal="true" aria-labelledby="access-title">
        <header class="access-header">
          <h2 id="access-title" ref="headingEl" tabindex="-1">{{ what }}</h2>
          <DialogCloseButton label="Close" @click="close" />
        </header>
        <ConnectionSelect
          :owner="widgetConnectionOwner(instanceId)"
          :type-ids="types"
          :package-id="pkg.id"
        />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.access-bar {
  position: absolute;
  inset: auto 8px 8px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 10px;
  background: rgb(var(--surface-bg-rgb));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font-size: 12px;
  line-height: 1.4;
}

.access-line {
  flex: 1;
  min-width: 0;
  color: rgba(var(--fg-rgb), 0.85);
}

.access-action {
  flex: none;
  padding: 5px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
  font: inherit;
  cursor: pointer;
}

.access-action:hover,
.access-action:focus-visible {
  background: rgba(var(--fg-rgb), 0.14);
  outline: none;
}

.access-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.35);
}

.access-dialog {
  width: min(360px, 100%);
  max-height: min(440px, 100%);
  overflow: auto;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: var(--surface-radius, 16px);
  background: rgb(var(--surface-bg-rgb));
  box-shadow: var(--surface-box-shadow);
}

.access-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.1);
}

.access-header h2 {
  margin: 0;
  font-size: 14px;
  outline: none;
}
</style>
