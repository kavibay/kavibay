<script setup lang="ts">
/**
 * Schema-driven editor for one credential type.
 *
 * Every input, label and action comes from the type definition in Rust — this
 * component has no per-integration knowledge, which is the point of the
 * credentials abstraction.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  cancelConnect,
  connectCredential,
  credentialUsers,
  revokeCredentialUse,
  deleteCredential,
  disconnectCredential,
  saveCredential,
  testCredential,
  type CredentialSummary,
  type CredentialTypeSchema,
  type DeviceVerification,
} from "./credentialsApi";
import { invoke } from "@tauri-apps/api/core";
import { BrandMark } from "@sdk/brand";
import {
  buildFormValues,
  canConnect,
  canSave,
  fieldPlaceholder,
  statusLabel,
  statusTone,
  submittableValues,
  type FormValues,
} from "./credentialsLogic";

const props = defineProps<{
  type: CredentialTypeSchema;
  summary: CredentialSummary | null;
  /**
   * What to call a *new* connection when the platform already has one. Empty
   * for the first, which falls back to the type's own name in Rust.
   */
  suggestedName?: string;
}>();

const emit = defineEmits<{ (event: "changed"): void; (event: "saved", id: string): void }>();
const connectionName = ref(props.summary?.name ?? props.suggestedName ?? "");

const values = ref<FormValues>(buildFormValues(props.type, props.summary));
const saving = ref(false);
const testing = ref(false);
const removing = ref(false);
const connecting = ref(false);
const error = ref<string | null>(null);
const feedback = ref<string | null>(null);
/** Code + URL for device-code sign-ins; the status poll never carries these. */
const verification = ref<DeviceVerification | null>(null);
/** Runtime packages allowed to use this credential (they never see the secret). */
const users = ref<string[]>([]);

/** Loads which packages hold a grant for this credential type. */
async function refreshUsers() {
  try {
    users.value = props.summary ? await credentialUsers(props.summary.id) : [];
  } catch {
    users.value = [];
  }
}

onMounted(refreshUsers);

async function onRevoke(packageId: string) {
  await run(connecting, async () => {
    if (!props.summary) return null;
    await revokeCredentialUse(packageId, props.summary.id);
    emit("changed");
    await refreshUsers();
    return `${packageId} can no longer use this credential.`;
  });
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

// Reset the form whenever the stored credential changes underneath us
// (save, delete, or a reload triggered by another card).
watch(
  () => props.summary,
  (next) => {
    values.value = buildFormValues(props.type, next);
    connectionName.value = next?.name ?? props.suggestedName ?? "";
  },
);

const saveEnabled = computed(() => canSave(props.type, values.value, props.summary));
const tone = computed(() => statusTone(props.summary));
const status = computed(() => statusLabel(props.summary));
const connectEnabled = computed(() => canConnect(props.type, props.summary));
const needsSignIn = computed(() => props.type.authKind !== "static");
const isPending = computed(() => props.summary?.pending ?? false);
const isConnected = computed(() => props.summary?.state === "connected");

/**
 * While a sign-in is pending the flow completes in the browser, so the panel
 * has to poll for the result. Stop as soon as it is no longer pending.
 */
function syncPolling(pending: boolean) {
  if (pending && !pollTimer) {
    pollTimer = setInterval(() => emit("changed"), 2000);
  } else if (!pending && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

watch(isPending, syncPolling, { immediate: true });
onUnmounted(() => syncPolling(false));

/** Runs an async action with shared busy/error/feedback handling. */
async function run(
  busy: { value: boolean },
  action: () => Promise<string | null>,
): Promise<void> {
  busy.value = true;
  error.value = null;
  feedback.value = null;
  try {
    feedback.value = await action();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

async function onSave() {
  await run(saving, async () => {
    const id = await saveCredential(
      props.type.id,
      submittableValues(props.type, values.value),
      props.summary?.id,
      connectionName.value.trim() || props.type.displayName,
    );
    emit("saved", id);
    emit("changed");
    return "Saved. Secrets are encrypted for this user and never shown again.";
  });
}

async function onTest() {
  const id = props.summary?.id;
  if (!id) return;
  await run(testing, async () => {
    const result = await testCredential(id);
    if (!result.ok) throw new Error(result.message);
    return result.message;
  });
}

async function onRemove() {
  const id = props.summary?.id;
  if (!id) return;
  await run(removing, async () => {
    await deleteCredential(id);
    emit("changed");
    return "Removed.";
  });
}

async function onConnect() {
  await run(connecting, async () => {
    // Types without fields (a provider-published client) have no saved row yet;
    // creating it here keeps "Connect" a single click.
    const id =
      props.summary?.id ??
      (await saveCredential(props.type.id, submittableValues(props.type, values.value), undefined, connectionName.value.trim() || props.type.displayName));
    emit("saved", id);

    const device = await connectCredential(id);
    verification.value = device;
    emit("changed");

    if (!device) return "Finish the sign-in in your browser.";
    // Device flows: send the user straight to the pre-filled verification page.
    await invoke("launch_path", { path: device.verificationUriComplete });
    return `Enter code ${device.userCode} in your browser.`;
  });
}

async function onCancelConnect() {
  const id = props.summary?.id;
  if (!id) return;
  await run(connecting, async () => {
    await cancelConnect(id);
    verification.value = null;
    emit("changed");
    return "Sign-in cancelled.";
  });
}

async function onDisconnect() {
  const id = props.summary?.id;
  if (!id) return;
  await run(connecting, async () => {
    await disconnectCredential(id);
    verification.value = null;
    emit("changed");
    return "Account disconnected. Your app credentials were kept.";
  });
}

/** Opens the provider's setup docs in the system browser. */
async function openDocs() {
  if (!props.type.docsUrl) return;
  await invoke("launch_path", { path: props.type.docsUrl });
}
</script>

<template>
  <section class="cred-card">
    <header class="cred-head">
      <div class="cred-ident">
        <!-- Nothing at all for a type we ship no logo for; see BrandMark. -->
        <BrandMark :provider="type.id" :size="22" class="cred-mark" />
        <div>
          <h3 class="cred-name">{{ summary?.name || "New connection" }}</h3>
          <!-- First-run help. Once an account exists it is the same sentence
               the provider row above already carries. -->
          <p v-if="!summary" class="cred-desc">{{ type.description }}</p>
        </div>
      </div>
      <span class="cred-status" :class="`cred-status--${tone}`">{{ status }}</span>
    </header>

    <!--
      First field on purpose: with several accounts on one platform the name is
      the only thing that tells them apart — the keys themselves are write-only
      and look identical in every list that offers them.
    -->
    <label class="cred-field">
      <span class="cred-label">Connection name</span>
      <input
        v-model="connectionName"
        type="text"
        :placeholder="type.displayName"
        autocomplete="off"
      />
      <span class="cred-help">Shown wherever you pick an account — e.g. Work, Personal.</span>
    </label>
    <label v-for="field in type.fields" :key="field.key" class="cred-field">
      <span class="cred-label">
        {{ field.label }}<span v-if="field.required" class="cred-req">*</span>
      </span>
      <input
        v-model="values[field.key]"
        :type="field.kind === 'password' ? 'password' : 'text'"
        autocomplete="off"
        spellcheck="false"
        :placeholder="fieldPlaceholder(field, summary)"
      />
      <span v-if="field.help" class="cred-help">{{ field.help }}</span>
    </label>

    <button
      v-if="type.docsUrl"
      type="button"
      class="cred-docs"
      :title="type.docsUrl"
      @click="openDocs"
    >
      Open setup guide
    </button>

    <div v-if="isPending && verification" class="cred-device">
      <p class="cred-code">{{ verification.userCode }}</p>
      <p class="cred-help">
        Enter this code at {{ verification.verificationUriComplete }}
      </p>
    </div>

    <div class="cred-actions">
      <button
        type="button"
        class="cred-btn"
        :disabled="saving || !saveEnabled"
        @click="onSave"
      >
        {{ saving ? "Saving…" : "Save" }}
      </button>

      <template v-if="needsSignIn">
        <button
          v-if="isPending"
          type="button"
          class="cred-btn cred-btn--ghost"
          :disabled="connecting"
          @click="onCancelConnect"
        >
          {{ connecting ? "Cancelling…" : "Cancel sign-in" }}
        </button>
        <button
          v-else
          type="button"
          class="cred-btn"
          :disabled="connecting || !connectEnabled"
          @click="onConnect"
        >
          {{ isConnected ? "Reconnect" : "Connect" }}
        </button>
        <button
          v-if="isConnected || summary?.state === 'needsReauth'"
          type="button"
          class="cred-btn cred-btn--ghost"
          :disabled="connecting"
          @click="onDisconnect"
        >
          Disconnect
        </button>
      </template>
      <button
        v-if="type.supportsTest && summary"
        type="button"
        class="cred-btn cred-btn--ghost"
        :disabled="testing"
        @click="onTest"
      >
        {{ testing ? "Testing…" : "Test" }}
      </button>
      <button
        v-if="summary"
        type="button"
        class="cred-btn cred-btn--ghost"
        :disabled="removing"
        @click="onRemove"
      >
        {{ removing ? "Removing…" : "Remove" }}
      </button>
    </div>

    <p v-if="needsSignIn && !connectEnabled && !isPending" class="cred-help">
      Save the fields above before connecting.
    </p>

    <div v-if="users.length > 0" class="cred-users">
      <span class="cred-users-title">Used by</span>
      <span v-for="packageId in users" :key="packageId" class="cred-user">
        {{ packageId }}
        <button type="button" class="cred-revoke" @click="onRevoke(packageId)">
          Revoke
        </button>
      </span>
      <span class="cred-help">
        These packages have the secret injected by the host — they never see it.
      </span>
    </div>

    <p v-if="feedback" class="cred-feedback">{{ feedback }}</p>
    <p v-if="error" class="cred-error">{{ error }}</p>
    <p v-if="summary?.error && !isPending" class="cred-error">
      Last sign-in attempt failed: {{ summary.error }}
    </p>
  </section>
</template>

<style scoped>
.cred-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.035);
}

.cred-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.cred-ident {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

/* Optical alignment: the mark sits with the name, not with its cap height. */
.cred-mark {
  margin-top: 1px;
}

.cred-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}

.cred-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.cred-status {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.55);
}

.cred-status--ok {
  background: rgba(120, 200, 150, 0.16);
  color: rgba(160, 220, 180, 0.95);
}

.cred-status--warn {
  background: rgba(255, 205, 120, 0.16);
  color: rgba(255, 205, 120, 0.95);
}

.cred-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.55);
}

.cred-req {
  margin-left: 3px;
  color: rgba(255, 160, 120, 0.9);
}

.cred-field input {
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
}

.cred-field input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.cred-help {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.4);
}

.cred-docs {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: rgba(var(--fg-rgb), 0.55);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cred-docs:hover,
.cred-docs:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  outline: none;
}

.cred-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.cred-btn {
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.cred-btn:hover:not(:disabled) {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.cred-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.cred-btn--ghost {
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
}

.cred-device {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.06);
}

.cred-code {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 3px;
  color: rgba(var(--fg-rgb), 0.95);
}

.cred-users {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
}

.cred-users-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.cred-user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.8);
}

.cred-revoke {
  padding: 2px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.8);
  font-size: 11px;
  cursor: pointer;
}

.cred-feedback,
.cred-error {
  margin: 0;
  font-size: 12px;
}

.cred-feedback {
  color: rgba(160, 220, 180, 0.9);
}

.cred-error {
  color: rgba(255, 140, 140, 0.95);
}
</style>
