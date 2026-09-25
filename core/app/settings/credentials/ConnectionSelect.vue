<script setup lang="ts">
/**
 * "Which account does this widget use", for one consumer and the credential
 * types it needs.
 *
 * Host-owned and rendered in two places — a widget's settings panel and the
 * connect prompt on the gate. A widget never builds its own: two widgets on one
 * platform would otherwise disagree about what "connected" means, and the
 * inconsistency is immediately visible in an overlay.
 *
 * A sole connection renders as a label rather than a dropdown. The backend has
 * already bound it (`bindings::selection`), so a one-option select would only
 * invite a click that changes nothing.
 *
 * The app-wide default is *not* set here — that lives on the row in
 * Settings → Credentials, where the accounts are listed.
 */
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import {
  listCredentials,
  listCredentialTypes,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "./credentialsApi";
import {
  connectionEpoch,
  connectionsChanged,
  connectionSelection,
  selectConnection,
  type ConnectionBinding,
} from "./connections";
import { useSettingsModal } from "../useSettingsModal";

const props = defineProps<{ owner: string; typeIds: string[]; packageId?: string }>();
const emit = defineEmits<{ changed: [] }>();

const types = ref<CredentialTypeSchema[]>([]);
const entries = ref<CredentialSummary[]>([]);
const bindings = ref<Record<string, ConnectionBinding>>({});
const error = ref("");
const busy = ref(false);
let request = 0;

watch(
  () => [props.owner, props.typeIds.join(","), connectionEpoch.value],
  async () => {
    const current = ++request;
    try {
      const [catalog, credentials, selected] = await Promise.all([
        listCredentialTypes(),
        listCredentials(),
        Promise.all(props.typeIds.map((type) => connectionSelection(props.owner, type))),
      ]);
      if (current !== request) return;
      types.value = catalog.filter((type) => props.typeIds.includes(type.id));
      entries.value = credentials;
      bindings.value = Object.fromEntries(selected.map((binding) => [binding.typeId, binding]));
      error.value = "";
    } catch (cause) {
      if (current === request) error.value = String(cause);
    }
  },
  { immediate: true },
);

/** Connections of this type, in the order the store returns them. */
function matches(typeId: string) {
  return entries.value.filter((entry) => entry.typeId === typeId);
}

/** The bound connection, or null when it was never chosen — or was deleted. */
function chosen(typeId: string): CredentialSummary | null {
  const id = bindings.value[typeId]?.credentialId;
  return (id && matches(typeId).find((entry) => entry.id === id)) || null;
}

/** True once the selection points at a row that no longer exists. */
function wasDeleted(typeId: string): boolean {
  return Boolean(bindings.value[typeId]?.credentialId) && !chosen(typeId);
}

/**
 * What to show for a sole connection. Its name defaults to the credential
 * type's own, so printing it under a label that already says "Linear API Key"
 * would just repeat the line above and teach nothing.
 */
function soleLabel(entry: CredentialSummary, type: CredentialTypeSchema): string {
  if (entry.name && entry.name !== type.displayName) return entry.name;
  return entry.accountLabel ?? "Connected";
}

/** Whether anything at all is saved for the types on screen. */
function anySaved(): boolean {
  return props.typeIds.some((typeId) => matches(typeId).length > 0);
}

function options(typeId: string) {
  return matches(typeId).map((entry) => ({
    value: entry.id,
    label: entry.name,
    note: entry.accountLabel ?? undefined,
  }));
}

async function choose(typeId: string, value: string | number) {
  if (!value) return;
  busy.value = true;
  try {
    await selectConnection(props.owner, typeId, String(value));
    emit("changed");
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

const { showSection } = useSettingsModal();

async function grant() {
  busy.value = true;
  try {
    for (const binding of Object.values(bindings.value)) {
      if (binding.credentialId) {
        await invoke("connections_grant_package", {
          id: props.packageId,
          credentialId: binding.credentialId,
        });
      }
    }
    connectionsChanged();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="typeIds.length" class="conn">
    <div v-for="type in types" :key="type.id" class="conn-field">
      <span class="conn-label">{{ type.displayName }}</span>

      <!-- Nothing saved yet: an empty dropdown would be a dead control. -->
      <template v-if="matches(type.id).length === 0">
        <p class="conn-note">No account added yet.</p>
        <button type="button" class="conn-link" @click="showSection('credentials', type.id)">
          Add one in Settings → Credentials
        </button>
      </template>

      <!-- Exactly one, already bound by the backend: a label, not a control. -->
      <p v-else-if="matches(type.id).length === 1 && !wasDeleted(type.id)" class="conn-single">
        {{ soleLabel(matches(type.id)[0]!, type) }}
      </p>

      <KavibaySelect
        v-else
        size="sm"
        :options="options(type.id)"
        :disabled="busy"
        :placeholder="wasDeleted(type.id) ? 'Choose another account' : 'Choose an account'"
        :aria-label="`${type.displayName} account`"
        :model-value="chosen(type.id)?.id ?? ''"
        @update:model-value="choose(type.id, $event)"
      />

      <p v-if="wasDeleted(type.id)" class="conn-warn">
        That account was deleted. Pick another — nothing falls back on its own.
      </p>
      <p
        v-else-if="chosen(type.id) && !bindings[type.id]?.available"
        class="conn-warn"
      >
        This account needs setup or reconnection.
      </p>
    </div>

    <p v-if="error" class="conn-warn" role="alert">{{ error }}</p>

    <button v-if="packageId" type="button" class="conn-grant" :disabled="busy" @click="grant">
      Allow {{ packageId }} to use the selected accounts
    </button>
    <!-- With nothing saved, each field already offers its own "add one" link. -->
    <button v-if="anySaved()" type="button" class="conn-link" @click="showSection('credentials')">
      Manage accounts
    </button>
  </section>
</template>

<style scoped>
/* Sized against ConfigForm: the two stack inside one settings popover. */
.conn {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  box-sizing: border-box;
}

.conn-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conn-label {
  font-size: 12px;
  font-weight: 500;
}

.conn-single {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.9);
}

.conn-note {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.conn-warn {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 205, 120, 0.9);
}

.conn-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: rgba(var(--fg-rgb), 0.5);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.conn-link:hover,
.conn-link:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  outline: none;
}

.conn-grant {
  align-self: flex-start;
  padding: 6px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.conn-grant:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.14);
}

.conn-grant:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
