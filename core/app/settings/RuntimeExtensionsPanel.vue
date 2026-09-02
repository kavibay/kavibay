<script setup lang="ts">
/**
 * Settings → Extensions → Runtime packages:
 * list/scan/enable AppData drop-ins when Developer Extensions is on.
 */
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { needsReconsent, permissionLabel } from "../runtime/runtimeInstallLogic";
import { useRuntimeExtensions } from "../runtime/useRuntimeExtensions";
import { extensionHost } from "../extension-host/cockpit";
import { buildPermissionRequest } from "../extension-host/permissionRequest";
import type { ApprovedGrant } from "../extension-host/widgetPackage";
import PermissionRequest from "../extension-host/ui/PermissionRequest.vue";
import { useDeveloperPrefs } from "./useDeveloperPrefs";

const { developerExtensionsEnabled } = useDeveloperPrefs();
/** Package awaiting a second click to confirm deletion. */
const pendingDelete = ref<string | null>(null);
const { scanned, installs, rescan, setEnabled } = useRuntimeExtensions();

const rootPath = ref<string>("");
const rootError = ref<string | null>(null);
const scanning = ref(false);
const copyFeedback = ref<string | null>(null);

/** Sorted scan rows for the settings list. */
const rows = computed(() =>
  [...scanned.value].sort((a, b) => a.name.localeCompare(b.name)),
);

/** Whether the install record for id is enabled. */
function isEnabled(id: string): boolean {
  return installs.value.find((r) => r.id === id)?.enabled === true;
}

/** Load AppData extensions root path for display / copy. */
async function loadRoot() {
  rootError.value = null;
  try {
    rootPath.value = await invoke<string>("runtime_extensions_root");
  } catch (err) {
    rootPath.value = "";
    rootError.value = String(err);
  }
}

/** Rescan packages (no-op clear when developer mode off). */
async function onRescan() {
  scanning.value = true;
  copyFeedback.value = null;
  try {
    await rescan();
  } finally {
    scanning.value = false;
  }
}

/** Configured per-package call budget plus what each package used today. */
const budget = ref<number>(500);
const budgetInput = ref<string>("500");
const budgetUsage = ref<Array<[string, number]>>([]);
const budgetFeedback = ref<string | null>(null);

/** Load the budget and today's usage from the backend. */
async function refreshBudget() {
  try {
    const status = await invoke<{ dailyBudget: number; usage: Array<[string, number]> }>(
      "runtime_extensions_budget_status",
    );
    budget.value = status.dailyBudget;
    budgetInput.value = String(status.dailyBudget);
    budgetUsage.value = status.usage;
  } catch (error) {
    console.error("[kavibay] budget status failed:", error);
  }
}

/** Save the budget; the backend clamps it and returns what it stored. */
async function onSaveBudget() {
  budgetFeedback.value = null;
  const parsed = Number.parseInt(budgetInput.value, 10);
  if (!Number.isFinite(parsed)) {
    budgetFeedback.value = "Enter a number.";
    return;
  }
  try {
    const stored = await invoke<number>("runtime_extensions_set_daily_budget", {
      value: parsed,
    });
    budget.value = stored;
    budgetInput.value = String(stored);
    budgetFeedback.value =
      stored === parsed ? "Saved." : `Saved as ${stored} (allowed range 10–10000).`;
  } catch (error) {
    budgetFeedback.value = String(error);
  }
}

/** Calls a package has made today, for the row. */
function usedToday(id: string): number {
  return budgetUsage.value.find(([extId]) => extId === id)?.[1] ?? 0;
}

/**
 * Package awaiting confirmation. Enabling grants capabilities, so it asks first
 * rather than flipping on a checkbox change.
 */
const pendingConsent = ref<string | null>(null);

/** Start (or cancel) the confirm step for one package. */
function onRequestEnable(id: string) {
  pendingConsent.value = pendingConsent.value === id ? null : id;
}

function onCancelConsent() {
  pendingConsent.value = null;
}

/** Confirmed: grant and enable. */
async function onConfirmEnable(id: string) {
  pendingConsent.value = null;
  try {
    await setEnabled(id, true);
  } catch (error) {
    console.error("[kavibay] enabling a runtime package failed:", error);
  }
}

/**
 * The other consent screen, for the other package format.
 *
 * A contract package asks to read named queries from a provider, which the
 * runtime list above has no vocabulary for — it would drop every one of them as
 * an unknown permission and enable the package having granted nothing, silently.
 * So the format picks the dialog, from the same discriminator that picks the
 * frame.
 *
 * `buildPermissionRequest` is what decides; this only renders it and hands back
 * what was ticked. That split is deliberate — see `permissionRequest.ts`.
 */
const contractRequest = computed(() => {
  const row = rows.value.find((r) => r.id === pendingConsent.value);
  if (!row || row.format !== "contract" || row.contractManifest === undefined) return undefined;
  try {
    return buildPermissionRequest(row.contractManifest, extensionHost.registry);
  } catch (error) {
    console.error("[kavibay] a contract package's manifest could not be read:", error);
    return undefined;
  }
});

/** Approved: store exactly what was ticked, then enable. */
async function onApproveContract(id: string, grant: ApprovedGrant) {
  pendingConsent.value = null;
  try {
    // `actions` is not passed and has nowhere to go: the stored shape has no
    // field for one. Generated widgets are read-only, kept as a shape rather
    // than as a rule somebody has to remember.
    await setEnabled(id, true, { approved: [...grant.providers] });
  } catch (error) {
    console.error("[kavibay] approving a widget package failed:", error);
  }
}

/** True when the declaration changed after the user consented to it. */
function needsReview(id: string): boolean {
  const row = rows.value.find((r) => r.id === id);
  return needsReconsent(
    installs.value.find((i) => i.id === id),
    row?.apiHash,
  );
}

/**
 * Delete a widget built here, on a second click.
 *
 * Only packages from the custom root: one that arrived in a folder — or later
 * from the store — is not this panel's to remove, and the backend refuses it
 * regardless. There is no undo, so the first click only arms the button.
 */
async function onDelete(id: string) {
  if (pendingDelete.value !== id) {
    pendingDelete.value = id;
    return;
  }
  pendingDelete.value = null;
  try {
    await invoke("runtime_extensions_delete_package", { id });
    await rescan();
  } catch (error) {
    console.error("[kavibay] deleting a runtime package failed:", error);
  }
}

/** Disable a package without deleting files (no remove command in P1). */
async function onDisable(id: string) {
  try {
    await setEnabled(id, false);
  } catch (error) {
    console.error("[kavibay] disabling a runtime package failed:", error);
  }
}

/** Copy extensions root path to clipboard. */
async function onCopyRoot() {
  if (!rootPath.value) return;
  try {
    await navigator.clipboard.writeText(rootPath.value);
    copyFeedback.value = "Copied";
  } catch {
    copyFeedback.value = "Copy failed";
  }
}

onMounted(async () => {
  await loadRoot();
  if (developerExtensionsEnabled.value) {
    await onRescan();
    await refreshBudget();
  }
});

watch(developerExtensionsEnabled, async () => {
  await onRescan();
});
</script>

<template>
  <div class="runtime-ext">
    <h3 class="runtime-ext-title">Runtime packages</h3>
    <p class="runtime-ext-sub">
      Drop-in packages from the app data
      <code>extensions/</code> folder. Untrusted — enable only what you trust.
    </p>

    <p v-if="!developerExtensionsEnabled" class="runtime-ext-hint">
      Turn on
      <strong>Settings → Behavior → Developer Extensions</strong>
      to scan and enable runtime packages.
    </p>

    <template v-else>
      <div class="runtime-ext-root">
        <span class="runtime-ext-root-label">Folder</span>
        <code class="runtime-ext-root-path" :title="rootPath || undefined">
          {{ rootPath || (rootError ? "unavailable" : "…") }}
        </code>
        <button
          type="button"
          class="runtime-ext-btn runtime-ext-btn--ghost"
          :disabled="!rootPath"
          @click="onCopyRoot"
        >
          Copy
        </button>
        <button
          type="button"
          class="runtime-ext-btn"
          :disabled="scanning"
          @click="onRescan"
        >
          {{ scanning ? "Scanning…" : "Rescan" }}
        </button>
      </div>
      <div class="runtime-ext-budget">
        <label class="runtime-ext-budget-label">
          Daily call budget per package
          <input
            v-model="budgetInput"
            type="number"
            min="10"
            max="10000"
            inputmode="numeric"
          />
        </label>
        <button type="button" class="runtime-ext-btn" @click="onSaveBudget">Save</button>
        <span class="runtime-ext-budget-hint">
          Requests a package may make per day. Cached answers do not count.
        </span>
        <span v-if="budgetFeedback" class="runtime-ext-feedback">{{ budgetFeedback }}</span>
      </div>

      <p v-if="rootError" class="runtime-ext-error">{{ rootError }}</p>
      <p v-if="copyFeedback" class="runtime-ext-feedback">{{ copyFeedback }}</p>

      <div v-if="rows.length === 0" class="runtime-ext-empty">
        No packages found. Copy a template into the folder above, then Rescan.
      </div>

      <div v-else class="runtime-ext-list" role="list">
        <div
          v-for="ext in rows"
          :key="ext.id"
          class="runtime-ext-row"
          role="listitem"
        >
          <span class="runtime-ext-row-text">
            <span class="runtime-ext-row-title">
              {{ ext.name }}
              <span class="runtime-ext-row-meta">v{{ ext.version }}</span>
            </span>
            <span class="runtime-ext-row-hint">
              <span class="runtime-ext-origin" :class="`runtime-ext-origin--${ext.origin}`">
                {{ ext.origin === "custom" ? "built here" : "installed" }}
              </span>
              {{ ext.path }}
            </span>

            <span v-if="usedToday(ext.id) > 0" class="runtime-ext-row-usage">
              {{ usedToday(ext.id) }} of {{ budget }} calls today
            </span>

            <span v-if="needsReview(ext.id)" class="runtime-ext-row-stale">
              This package changed what it calls since you enabled it. Its
              requests are refused until you review and enable it again.
            </span>

            <!--
              What this package will call, shown before it can be enabled.
              Descriptions come from the package author, so they are rendered as
              text and never as markup.
            -->
            <span
              v-if="ext.apiEndpoints && ext.apiEndpoints.length > 0"
              class="runtime-ext-row-endpoints"
            >
              <span class="runtime-ext-endpoints-title">Will call:</span>
              <span
                v-for="endpoint in ext.apiEndpoints"
                :key="endpoint.id"
                class="runtime-ext-endpoint"
              >
                {{ endpoint.description }}
                <span class="runtime-ext-endpoint-target">
                  {{ endpoint.method }} {{ endpoint.hosts.join(", ") }}
                </span>
                <span v-if="endpoint.credential" class="runtime-ext-endpoint-cred">
                  uses your {{ endpoint.credential }} credential — the package never
                  sees the secret
                </span>
              </span>
            </span>
            <span
              class="runtime-ext-row-status"
              :class="{
                'runtime-ext-row-status--ready': ext.status === 'ready',
                'runtime-ext-row-status--error': ext.status !== 'ready',
              }"
            >
              {{ ext.status }}
              <template v-if="ext.error"> — {{ ext.error }}</template>
            </span>
          </span>
          <PermissionRequest
            v-if="pendingConsent === ext.id && contractRequest"
            :display-name="ext.name"
            :request="contractRequest"
            class="runtime-ext-consent"
            @approve="onApproveContract(ext.id, $event)"
            @cancel="onCancelConsent"
          />

          <div
            v-else-if="pendingConsent === ext.id"
            class="runtime-ext-consent"
          >
            <p class="runtime-ext-consent-title">{{ ext.name }} wants to:</p>
            <ul class="runtime-ext-consent-list">
              <li v-for="permission in ext.permissions" :key="permission">
                {{ permissionLabel(permission) }}
              </li>
              <li v-for="endpoint in ext.apiEndpoints" :key="endpoint.id">
                {{ endpoint.description }}
                <span class="runtime-ext-endpoint-target">
                  {{ endpoint.method }} {{ endpoint.hosts.join(", ") }}
                </span>
                <span v-if="endpoint.credential" class="runtime-ext-endpoint-cred">
                  using your {{ endpoint.credential }} credential — the package
                  never sees the secret
                </span>
              </li>
            </ul>
            <p class="runtime-ext-consent-note">
              Runtime packages are untrusted code. Enable only what you trust.
            </p>
            <div class="runtime-ext-consent-actions">
              <button
                type="button"
                class="runtime-ext-btn runtime-ext-btn--ghost"
                @click="onCancelConsent"
              >
                Cancel
              </button>
              <button
                type="button"
                class="runtime-ext-btn"
                @click="onConfirmEnable(ext.id)"
              >
                Enable
              </button>
            </div>
          </div>

          <div class="runtime-ext-row-actions">
            <button
              v-if="isEnabled(ext.id)"
              type="button"
              class="runtime-ext-btn runtime-ext-btn--ghost"
              @click="onDisable(ext.id)"
            >
              Disable
            </button>
            <button
              v-if="!isEnabled(ext.id)"
              type="button"
              class="runtime-ext-btn"
              :disabled="ext.status !== 'ready'"
              @click="onRequestEnable(ext.id)"
            >
              {{ pendingConsent === ext.id ? "Cancel" : "Enable…" }}
            </button>
            <button
              v-else-if="needsReview(ext.id)"
              type="button"
              class="runtime-ext-btn"
              @click="onRequestEnable(ext.id)"
            >
              Review changes…
            </button>
            <button
              v-if="ext.origin === 'custom'"
              type="button"
              class="runtime-ext-btn runtime-ext-btn--ghost"
              :class="{ 'runtime-ext-btn--danger': pendingDelete === ext.id }"
              v-tip="
                pendingDelete === ext.id
                  ? 'Click again to delete for good'
                  : 'Delete this widget and its files'
              "
              @click="onDelete(ext.id)"
              @mouseleave="pendingDelete === ext.id && (pendingDelete = null)"
            >
              {{ pendingDelete === ext.id ? "Sure?" : "Delete" }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.runtime-ext {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

.runtime-ext-budget {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.035);
}

.runtime-ext-budget-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.72);
}

.runtime-ext-budget-label input {
  width: 88px;
  padding: 6px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
}

.runtime-ext-budget-label input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.runtime-ext-budget-hint {
  flex-basis: 100%;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-origin {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.55);
}

.runtime-ext-origin--custom {
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.78);
}

.runtime-ext-row-usage {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-row-stale {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 205, 120, 0.9);
}

.runtime-ext-consent {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.06);
}

.runtime-ext-consent-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.9);
}

.runtime-ext-consent-list {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.75);
}

.runtime-ext-consent-note {
  margin: 0;
  font-size: 10px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-consent-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.runtime-ext-row-endpoints {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.05);
}

.runtime-ext-endpoints-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.runtime-ext-endpoint {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.7);
}

.runtime-ext-endpoint-target {
  font-size: 10px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-endpoint-cred {
  font-size: 10px;
  color: rgba(255, 205, 120, 0.9);
}

.runtime-ext-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.runtime-ext-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.runtime-ext-sub code {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.65);
}

.runtime-ext-hint {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.55);
  line-height: 1.4;
}

.runtime-ext-hint strong {
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.75);
}

.runtime-ext-root {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.035);
}

.runtime-ext-root-label {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
  flex-shrink: 0;
}

.runtime-ext-root-path {
  flex: 1 1 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.65);
}

.runtime-ext-btn {
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.runtime-ext-btn:hover:not(:disabled) {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.runtime-ext-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.runtime-ext-btn--danger {
  background: rgba(255, 120, 120, 0.16);
  color: rgba(255, 157, 157, 0.95);
}

.runtime-ext-btn--ghost {
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
}

.runtime-ext-empty {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.runtime-ext-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
}

.runtime-ext-row:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.runtime-ext-row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.runtime-ext-row-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.runtime-ext-row-meta {
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-row-hint {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-ext-row-status {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.5);
}

.runtime-ext-row-status--ready {
  color: rgba(160, 220, 180, 0.9);
}

.runtime-ext-row-status--error {
  color: rgba(255, 140, 140, 0.95);
}

.runtime-ext-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.runtime-ext-check {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.runtime-ext-check-label {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.55);
}

.runtime-ext-check input {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.runtime-ext-check input:disabled {
  opacity: 0.4;
  cursor: default;
}

.runtime-ext-feedback {
  margin: 0;
  font-size: 12px;
  color: rgba(160, 220, 180, 0.9);
}

.runtime-ext-error {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 140, 140, 0.95);
}
</style>
