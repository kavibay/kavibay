<script setup lang="ts">
/**
 * One extension, in full — the generic replacement for Settings → Tado.
 *
 * That section existed because an extension had somewhere to *be* in Settings
 * only if core gave it a nav entry, a section id, an icon and a branch in the
 * modal. Four core edits per integration does not survive twenty of them, and a
 * fixed nav column does not either: the left rail would have become a vendor
 * directory. A row that opens is a list, and a list is the one shape that still
 * works at forty.
 *
 * Everything below is read from the contract, so no vendor is named here:
 * accounts come from the widget's `requires.providers`, the bulk add from a
 * `ConfigField` that declares a provider query, commands from
 * `contributes.commands`. An extension that declares none of them simply shows
 * fewer blocks.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ConfigOption, ProviderStatus, Subscription } from "@sdk/contract/sdk";
import type { RegisteredExtension } from "@sdk/types";
import { BrandMark } from "@sdk/brand";
import type { WidgetInstance } from "../host/types";
import PaletteWidgetIcon from "../palette/PaletteWidgetIcon.vue";
import {
  catalogExtensionDetail,
  extensionHost,
  instanceConfig,
  updateInstanceConfig,
} from "../extension-host/cockpit";
import { loadConfigOptions } from "../extension-host/configOptions";
import {
  bulkAddField,
  bulkAddLabel,
  bulkAddSummary,
  pendingOptions,
  providerStatusLine,
} from "./extensionDetailLogic";
import { useSettingsModal } from "./useSettingsModal";

const props = defineProps<{
  extension: RegisteredExtension;
  enabled: boolean;
}>();

const emit = defineEmits<{ back: []; "update:enabled": [boolean] }>();

const settings = useSettingsModal();
const instances = inject<WidgetInstance[]>("kavibayWidgetInstances");
const addWidget = inject<(typeId: string) => string | undefined>("kavibayAddWidget");

/** Contract facts for this catalog row; absent for a classic extension. */
const detail = computed(() => catalogExtensionDetail(props.extension.id));

// --- accounts --------------------------------------------------------------

/**
 * Status is pushed, not polled: the host publishes it and the palette already
 * listens the same way. Re-subscribed when the pane switches extensions, so a
 * detail view left open on one row does not keep reporting another's account.
 */
const statuses = ref<Record<string, ProviderStatus>>({});
let subscriptions: Subscription[] = [];

function unsubscribeAll() {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
}

function watchProviders() {
  unsubscribeAll();
  statuses.value = {};
  for (const provider of detail.value?.providers ?? []) {
    statuses.value = {
      ...statuses.value,
      [provider.id]: extensionHost.providerStatus(provider.id),
    };
    subscriptions.push(
      extensionHost.onStatusChange(provider.id, (status) => {
        statuses.value = { ...statuses.value, [provider.id]: status };
      }),
    );
    void extensionHost.refreshProviderStatus(provider.id);
  }
}

onMounted(watchProviders);
watch(() => props.extension.id, watchProviders);
onBeforeUnmount(unsubscribeAll);

const accounts = computed(() =>
  (detail.value?.providers ?? [])
    .filter((provider) => provider.requiresCredential)
    .map((provider) => {
      const status = statuses.value[provider.id] ?? { state: "disconnected" as const };
      return { ...provider, status, ...providerStatusLine(status) };
    }),
);

const allConnected = computed(() =>
  accounts.value.every((account) => account.status.state === "connected"),
);

/** Credentials owns sign-in; this only opens it on the right row. */
function openCredentials(credentialType?: string) {
  settings.showSection("credentials", credentialType);
}

// --- one widget per option -------------------------------------------------

const bulk = computed(() => bulkAddField(detail.value?.configuration));
const bulkBusy = ref(false);
const bulkFeedback = ref<string | null>(null);

watch(
  () => props.extension.id,
  () => {
    bulkFeedback.value = null;
    commandFeedback.value = null;
  },
);

/** Config values of this extension's placed widgets, for the field being filled. */
function placedValues(key: string): unknown[] {
  return (instances ?? [])
    .filter((instance) => instance.typeId === props.extension.id)
    .map((instance) => instanceConfig(instance.instanceId)[key]);
}

async function onBulkAdd() {
  const target = bulk.value;
  if (!target || !addWidget) return;
  bulkBusy.value = true;
  bulkFeedback.value = null;
  try {
    const options: ConfigOption[] = await loadConfigOptions(extensionHost, target.field);
    const missing = pendingOptions(options, placedValues(target.key));
    let added = 0;
    for (const option of missing) {
      const instanceId = addWidget(props.extension.id);
      if (!instanceId) continue;
      updateInstanceConfig(instanceId, { [target.key]: option.value });
      added += 1;
    }
    bulkFeedback.value = bulkAddSummary(added, target.field);
  } catch (error) {
    bulkFeedback.value = `Could not load options: ${String(error)}`;
  } finally {
    bulkBusy.value = false;
  }
}

// --- commands --------------------------------------------------------------

const runningCommand = ref<string | null>(null);
const commandFeedback = ref<string | null>(null);

async function onRunCommand(id: string, title: string) {
  runningCommand.value = id;
  commandFeedback.value = null;
  try {
    await extensionHost.runCommand(id);
    commandFeedback.value = `${title} ran.`;
  } catch (error) {
    commandFeedback.value = `${title} failed: ${String(error)}`;
  } finally {
    runningCommand.value = null;
  }
}
</script>

<template>
  <div class="detail">
    <button type="button" class="detail-back" @click="emit('back')">&larr; All extensions</button>

    <header class="detail-head">
      <PaletteWidgetIcon :widget="extension" :size="18" data-icon-tile />
      <span class="detail-head-text">
        <h2 class="detail-title">{{ extension.title }}</h2>
        <span class="detail-meta">By {{ extension.author }} &middot; v{{ extension.version }}</span>
      </span>
      <label class="switch">
        <input
          type="checkbox"
          :checked="enabled"
          :aria-label="`Enable ${extension.title}`"
          @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
        />
        <span class="switch-ui" aria-hidden="true" />
      </label>
    </header>

    <p class="detail-lead">{{ extension.description }}</p>

    <ul v-if="extension.categories.length > 0" class="detail-chips">
      <li v-for="category in extension.categories" :key="category" class="detail-chip">
        {{ category }}
      </li>
    </ul>

    <section v-if="accounts.length > 0" class="detail-block">
      <h3 class="detail-block-title">Account</h3>
      <div v-for="account in accounts" :key="account.id" class="detail-account">
        <BrandMark :provider="account.id" :size="20" />
        <span class="detail-account-text">
          <span class="detail-account-name">{{ account.displayName }}</span>
          <span class="detail-account-status" :data-tone="account.tone">{{ account.label }}</span>
        </span>
        <button type="button" class="detail-action" @click="openCredentials(account.credentialType)">
          {{ account.status.state === "connected" ? "Manage" : "Connect" }}
        </button>
      </div>
    </section>

    <section v-if="bulk" class="detail-block">
      <h3 class="detail-block-title">Quick setup</h3>
      <p v-if="!allConnected" class="detail-hint">
        Connect the account above to see what is available.
      </p>
      <template v-else>
        <button
          type="button"
          class="detail-action"
          :disabled="bulkBusy || !addWidget"
          @click="onBulkAdd"
        >
          {{ bulkBusy ? "Adding…" : bulkAddLabel(bulk.field) }}
        </button>
        <p v-if="bulkFeedback" class="detail-hint">{{ bulkFeedback }}</p>
      </template>
    </section>

    <section v-if="detail && detail.commands.length > 0" class="detail-block">
      <h3 class="detail-block-title">Commands</h3>
      <div class="detail-commands">
        <button
          v-for="command in detail.commands"
          :key="command.id"
          type="button"
          class="detail-action"
          :disabled="runningCommand === command.id"
          @click="onRunCommand(command.id, command.title)"
        >
          {{ runningCommand === command.id ? "Running…" : command.title }}
        </button>
      </div>
      <p v-if="commandFeedback" class="detail-hint">{{ commandFeedback }}</p>
    </section>

    <section v-if="extension.permissions.length > 0" class="detail-block">
      <h3 class="detail-block-title">Permissions</h3>
      <ul class="detail-chips">
        <li v-for="permission in extension.permissions" :key="permission" class="detail-chip">
          {{ permission }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 8px;
}

.detail-back {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: rgba(var(--fg-rgb), 0.5);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.detail-back:hover {
  color: rgba(var(--fg-rgb), 0.8);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.detail-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.detail-meta {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.38);
}

.detail-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.55);
}

.detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.detail-chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.07);
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.55);
}

.detail-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  background: rgba(var(--fg-rgb), 0.04);
}

.detail-block-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.detail-account {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.detail-account-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.detail-account-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.9);
}

.detail-account-status {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.detail-account-status[data-tone="ok"] {
  color: rgba(var(--fg-rgb), 0.62);
}

.detail-account-status[data-tone="warn"] {
  color: rgb(214 138 60);
}

.detail-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-action {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.detail-action:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.14);
}

.detail-action:disabled {
  opacity: 0.6;
  cursor: default;
}

.detail-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.55);
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
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
</style>
