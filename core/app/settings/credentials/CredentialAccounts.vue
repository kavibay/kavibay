<script setup lang="ts">
/**
 * One platform's saved connections, as rows, with the form only where it is
 * being used. Rendered by Settings → Credentials inside an open integration
 * row, and by Settings → AI inside an open provider row — the same component,
 * so AI is never a second credential editor.
 *
 * Each connection is one row carrying its own status and actions. Editing
 * opens the form under that row; adding opens it under the list. With nothing
 * saved yet the form is the whole view. An earlier version selected a row and
 * showed a standing editor below the list, which repeated the row, kept every
 * field on screen, and read as two panels for one thing.
 *
 * Several connections per platform are normal (Linear issues one key per
 * workspace). The app-wide default — what the palette, quick AI actions and
 * the Wizard use — is a property of a row.
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { Trash2Icon } from "@sdk/icons";
import CredentialForm from "./CredentialForm.vue";
import {
  connectionEpoch,
  connectionsChanged,
  connectionSelection,
  HOST_OWNER,
  selectConnection,
} from "./connections";
import {
  cancelConnect,
  connectCredential,
  credentialUsers,
  deleteCredential,
  disconnectCredential,
  revokeCredentialUse,
  saveCredential,
  testCredential,
  type CredentialSummary,
  type CredentialTypeSchema,
  type DeviceVerification,
} from "./credentialsApi";
import {
  buildFormValues,
  canConnect,
  canSave,
  statusLabel,
  statusTone,
  submittableValues,
  type FormValues,
} from "./credentialsLogic";
import { needsDeveloperApp } from "./credentialsPanelLogic";

const props = defineProps<{ type: CredentialTypeSchema; credentials: CredentialSummary[] }>();
const emit = defineEmits<{ changed: [] }>();

const entries = computed(() => props.credentials.filter((entry) => entry.typeId === props.type.id));
const needsSignIn = computed(() => props.type.authKind !== "static");
const defaultId = ref<string | null>(null);
/** Runtime packages allowed to use each connection (they never see the secret). */
const users = ref<Record<string, string[]>>({});

/** Which connection the form edits: an id, "new" to add one, or null for no form. */
const editing = ref<string | null>(null);
const formName = ref("");
const values = ref<FormValues>(buildFormValues(props.type, null));
/** The action in flight, as `${action}:${id}`, so only its button waits. */
const busy = ref<string | null>(null);
/** The last outcome, shown under the row it belongs to ("new" for the add form). */
const notice = ref<{ id: string; ok: boolean; text: string } | null>(null);
/** Code + URL for a device-code sign-in; the status poll never carries these. */
const verification = ref<{ id: string; device: DeviceVerification } | null>(null);

const adding = computed(() => entries.value.length === 0 || editing.value === "new");
const formSummary = computed(
  () => entries.value.find((entry) => entry.id === editing.value) ?? null,
);
const formReady = computed(() => canSave(props.type, values.value, formSummary.value));

/** A new sign-in connection is saved and signed in with one click. */
const addLabel = computed(() => (needsSignIn.value ? "Connect" : "Save"));

watch(
  () => [props.type.id, connectionEpoch.value],
  async () => {
    try {
      defaultId.value = (await connectionSelection(HOST_OWNER, props.type.id)).credentialId;
    } catch {
      defaultId.value = null;
    }
  },
  { immediate: true },
);

watch(
  () => entries.value.map((entry) => entry.id).join(),
  async () => {
    const next: Record<string, string[]> = {};
    await Promise.all(
      entries.value.map(async (entry) => {
        next[entry.id] = await credentialUsers(entry.id).catch(() => []);
      }),
    );
    users.value = next;
  },
  { immediate: true },
);

// While a sign-in is pending the flow completes in the browser, so poll for
// the result — and stop the moment nothing is pending any more.
let pollTimer: ReturnType<typeof setInterval> | undefined;
watch(
  () => entries.value.some((entry) => entry.pending),
  (pending) => {
    if (pending && !pollTimer) {
      pollTimer = setInterval(() => emit("changed"), 2000);
    } else if (!pending && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      verification.value = null;
    }
  },
  { immediate: true },
);
onUnmounted(() => clearInterval(pollTimer));

function rowStatus(entry: CredentialSummary): string {
  const using = users.value[entry.id] ?? [];
  const label = statusLabel(entry);
  return using.length > 0 ? `${label} · Used by ${using.join(", ")}` : label;
}

function startEdit(target: string) {
  const summary = entries.value.find((entry) => entry.id === target) ?? null;
  editing.value = target;
  values.value = buildFormValues(props.type, summary);
  // A second connection must not arrive named like the first: the name is the
  // only thing telling two write-only keys apart.
  formName.value = summary?.name ?? `${props.type.displayName} ${entries.value.length + 1}`;
  notice.value = null;
}

function cancelEdit() {
  editing.value = null;
  values.value = buildFormValues(props.type, null);
  formName.value = "";
}

function changed() {
  connectionsChanged();
  emit("changed");
}

/** Runs one action; its outcome lands under row `id`. */
async function run(key: string, id: string, action: () => Promise<string | null>) {
  busy.value = key;
  notice.value = null;
  try {
    const text = await action();
    if (text) notice.value = { id, ok: true, text };
  } catch (cause) {
    notice.value = { id, ok: false, text: String(cause) };
  } finally {
    busy.value = null;
  }
}

async function submit() {
  const existing = formSummary.value;
  await run("save", existing?.id ?? "new", async () => {
    const id = await saveCredential(
      props.type.id,
      submittableValues(props.type, values.value),
      existing?.id,
      formName.value.trim() || props.type.displayName,
    );
    cancelEdit();
    changed();
    // Only a brand-new sign-in connection goes straight on to signing in; an
    // edit of client details is saved and left for the row's Connect.
    if (needsSignIn.value && !existing) return await signIn(id);
    return "Saved. Secrets are encrypted and never shown again.";
  });
}

async function signIn(id: string): Promise<string> {
  const device = await connectCredential(id);
  changed();
  if (!device) return "Finish the sign-in in your browser.";
  verification.value = { id, device };
  // Device flows: send the user straight to the pre-filled verification page.
  await invoke("launch_path", { path: device.verificationUriComplete });
  return `Enter code ${device.userCode} in your browser.`;
}

const connect = (id: string) => run(`connect:${id}`, id, () => signIn(id));

const cancelSignIn = (id: string) =>
  run(`connect:${id}`, id, async () => {
    await cancelConnect(id);
    verification.value = null;
    changed();
    return "Sign-in cancelled.";
  });

const disconnect = (id: string) =>
  run(`disconnect:${id}`, id, async () => {
    await disconnectCredential(id);
    cancelEdit();
    changed();
    return "Account disconnected. The saved details were kept.";
  });

const test = (id: string) =>
  run(`test:${id}`, id, async () => {
    const result = await testCredential(id);
    if (!result.ok) throw new Error(result.message);
    return result.message;
  });

const remove = (id: string) =>
  run(`remove:${id}`, id, async () => {
    await deleteCredential(id);
    if (editing.value === id) cancelEdit();
    changed();
    return null;
  });

const makeDefault = (id: string) =>
  run(`default:${id}`, id, async () => {
    await selectConnection(HOST_OWNER, props.type.id, id);
    return null;
  });

const revoke = (packageId: string, id: string) =>
  run(`revoke:${id}`, id, async () => {
    await revokeCredentialUse(packageId, id);
    users.value = { ...users.value, [id]: (users.value[id] ?? []).filter((user) => user !== packageId) };
    emit("changed");
    return `${packageId} can no longer use this connection.`;
  });
</script>

<template>
  <div class="accounts">
    <template v-for="entry in entries" :key="entry.id">
      <div class="settings-row account-row" :class="{ 'account-row--editing': editing === entry.id }">
        <span class="settings-row-copy">
          <span class="settings-row-title">
            {{ entry.name }}
            <span v-if="entries.length > 1 && defaultId === entry.id" class="account-default">Default</span>
          </span>
          <span class="settings-row-hint account-status" :class="`account-status--${statusTone(entry)}`">
            {{ rowStatus(entry) }}
          </span>
        </span>

        <span class="account-actions">
          <button
            v-if="entries.length > 1 && defaultId !== entry.id"
            type="button"
            class="settings-btn settings-btn--quiet"
            :disabled="busy !== null"
            title="Used by the palette, quick AI actions and the Wizard"
            @click="makeDefault(entry.id)"
          >
            Make default
          </button>
          <template v-if="needsSignIn">
            <button
              v-if="entry.pending"
              type="button"
              class="settings-btn"
              :disabled="busy !== null"
              @click="cancelSignIn(entry.id)"
            >
              Cancel sign-in
            </button>
            <button
              v-else-if="entry.state !== 'connected' && canConnect(type, entry)"
              type="button"
              class="settings-btn settings-btn--primary"
              :disabled="busy !== null"
              @click="connect(entry.id)"
            >
              {{ entry.state === "needsReauth" ? "Reconnect" : "Connect" }}
            </button>
          </template>
          <button
            v-if="type.supportsTest && entry.state === 'connected'"
            type="button"
            class="settings-btn"
            :disabled="busy !== null"
            @click="test(entry.id)"
          >
            {{ busy === `test:${entry.id}` ? "Testing…" : "Test" }}
          </button>
          <button
            type="button"
            class="settings-btn"
            :aria-expanded="editing === entry.id"
            @click="editing === entry.id ? cancelEdit() : startEdit(entry.id)"
          >
            Edit
          </button>
          <button
            type="button"
            class="account-remove"
            :aria-label="`Remove ${entry.name}`"
            :title="`Remove ${entry.name}`"
            :disabled="busy !== null"
            @click="remove(entry.id)"
          >
            <Trash2Icon :size="15" />
          </button>
        </span>
      </div>

      <div v-if="verification?.id === entry.id && entry.pending" class="account-device">
        <p class="account-code">{{ verification.device.userCode }}</p>
        <p class="account-note">Enter this code at {{ verification.device.verificationUriComplete }}</p>
      </div>
      <p
        v-if="notice?.id === entry.id"
        class="account-notice"
        :class="{ 'account-notice--bad': !notice.ok }"
        role="status"
      >
        {{ notice.text }}
      </p>
      <p v-else-if="entry.error && !entry.pending" class="account-notice account-notice--bad">
        Last sign-in attempt failed: {{ entry.error }}
      </p>

      <div v-if="editing === entry.id" class="account-edit">
        <CredentialForm
          v-model:name="formName"
          v-model:values="values"
          :type="type"
          :summary="entry"
          show-name
          :submit-label="busy === 'save' ? 'Saving…' : 'Save'"
          :submit-disabled="!formReady || busy !== null"
          cancellable
          @submit="submit"
          @cancel="cancelEdit"
        >
          <div v-if="needsSignIn && (entry.state === 'connected' || entry.state === 'needsReauth')" class="account-more">
            <button type="button" class="settings-btn" :disabled="busy !== null" @click="disconnect(entry.id)">
              Disconnect account
            </button>
            <span class="account-note">Signs out and keeps the saved details.</span>
          </div>
          <div v-if="(users[entry.id] ?? []).length > 0" class="account-more account-users">
            <span class="account-users-title">Used by</span>
            <span v-for="packageId in users[entry.id]" :key="packageId" class="account-user">
              {{ packageId }}
              <button type="button" class="settings-btn" :disabled="busy !== null" @click="revoke(packageId, entry.id)">
                Revoke
              </button>
            </span>
            <span class="account-note">These packages have the secret injected by the host — they never see it.</span>
          </div>
        </CredentialForm>
      </div>
    </template>

    <div v-if="adding" class="account-add-form">
      <p v-if="entries.length > 0" class="account-add-title">New connection</p>
      <!-- The one step that happens outside Kavibay, said before the form asks for its result. -->
      <div v-else-if="needsDeveloperApp(type)" class="account-devapp">
        <p class="account-devapp-title">Needs your own {{ type.displayName }} developer app</p>
        <p class="account-devapp-text">
          Register an app in {{ type.displayName }}'s developer console, copy its details
          into the fields below, then connect. The setup guide walks through it.
        </p>
      </div>
      <CredentialForm
        v-model:name="formName"
        v-model:values="values"
        :type="type"
        :summary="null"
        :show-name="entries.length > 0"
        :submit-label="busy === 'save' ? 'Saving…' : addLabel"
        :submit-disabled="!formReady || busy !== null"
        :cancellable="entries.length > 0"
        @submit="submit"
        @cancel="cancelEdit"
      />
      <p
        v-if="notice?.id === 'new'"
        class="account-notice"
        :class="{ 'account-notice--bad': !notice.ok }"
        role="status"
      >
        {{ notice.text }}
      </p>
    </div>

    <template v-else>
      <button type="button" class="account-add" @click="startEdit('new')">+ Add connection</button>
      <p v-if="entries.length > 1" class="account-note">
        Each widget picks its own connection in its settings. The default is what the
        command palette, quick AI actions and the Wizard use.
      </p>
    </template>
  </div>
</template>

<style scoped>
.accounts {
  display: flex;
  flex-direction: column;
}

.account-row {
  padding: 10px 0;
}

/* The row being edited and its form read as one block. */
.account-row--editing {
  border-bottom-color: transparent;
}

.account-default {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  font-size: 10px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.6);
}

/* Status as a dot and a word, as on the integration rows. */
.account-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.account-status::before {
  content: "";
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.3);
}

.account-status--ok::before {
  background: #4ade80;
}

.account-status--warn::before {
  background: #fbbf24;
}

.account-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  cursor: pointer;
}

.account-remove:hover:not(:disabled),
.account-remove:focus-visible {
  outline: none;
  background: rgba(255, 120, 120, 0.14);
  color: rgba(255, 170, 170, 0.95);
}

.account-remove:disabled {
  cursor: default;
  opacity: 0.5;
}

.account-edit {
  padding: 2px 0 16px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
}

.account-add-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 4px;
}

/* Same violet as the "Developer app" badge on the integration row. */
.account-devapp {
  max-width: 480px;
  padding: 10px 12px;
  border: 1px solid rgba(167, 139, 250, 0.3);
  border-radius: 8px;
  background: rgba(139, 92, 246, 0.1);
}

.account-devapp-title {
  margin: 0 0 3px;
  font-size: 12px;
  font-weight: 600;
  color: #ddd6fe;
}

.account-devapp-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.7);
}

:global(html[data-color-mode="light"]) .account-devapp-title {
  color: #5b21b6;
}

.account-add-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}

.account-more {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.account-users {
  flex-direction: column;
  align-items: stretch;
}

.account-users-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.8);
}

.account-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.8);
}

.account-device {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.06);
}

.account-code {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 3px;
  color: rgba(var(--fg-rgb), 0.95);
}

.account-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.45);
}

.account-notice {
  margin: -4px 0 8px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(134, 239, 172, 0.9);
}

.account-notice--bad {
  color: rgba(255, 140, 140, 0.95);
}

.account-add {
  align-self: flex-start;
  margin: 6px 0 4px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.6);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.account-add:hover,
.account-add:focus-visible {
  outline: none;
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
