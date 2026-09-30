<script setup lang="ts">
/**
 * Settings → Extensions → My extensions: widgets built or imported here, plus
 * AppData drop-ins when Developer Extensions is on.
 */
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { BrandMark, brandMarkFor } from "@sdk/brand";
import { FolderIcon, KeyRoundIcon, SquarePenIcon, Trash2Icon } from "@sdk/icons";
import { WIDGET_WIZARD_ID } from "../host/builtinWidgetIds";
import { contractGrantFrom, needsReconsent, permissionLabel } from "../runtime/runtimeInstallLogic";
import { runtimeEntryUrlFor, useRuntimeExtensions } from "../runtime/useRuntimeExtensions";
import type { ScannedRuntimeExtension } from "../runtime/runtimeTypes";
import { extensionHost } from "../extension-host/cockpit";
import { buildPermissionRequest } from "../extension-host/permissionRequest";
import type { ApprovedGrant } from "../extension-host/widgetPackage";
import PermissionRequest from "../extension-host/ui/PermissionRequest.vue";
import PaletteWidgetIcon from "../palette/PaletteWidgetIcon.vue";
import { revealInFileManager } from "../palette/fileSearch";
import {
  listCredentials,
  listCredentialTypes,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "./credentials/credentialsApi";
import { rowStatusLabel, summariesForType, typeTone } from "./credentials/credentialsPanelLogic";
import { useDeveloperPrefs } from "./useDeveloperPrefs";
import { useSettingsModal } from "./useSettingsModal";

const { developerExtensionsEnabled } = useDeveloperPrefs();
const settings = useSettingsModal();
/** Package awaiting a second click to confirm deletion. */
const pendingDelete = ref<string | null>(null);
const { scanned, installs, rescan, setEnabled } = useRuntimeExtensions();

const rootPath = ref<string>("");
const rootError = ref<string | null>(null);
const scanning = ref(false);
const folderError = ref<string | null>(null);

/** The row opened in place, one at a time — as on Settings → Credentials. */
const openId = ref<string | null>(null);

function toggleOpen(id: string) {
  openId.value = openId.value === id ? null : id;
  // Summaries decrypt stored secrets, so they load when an account is shown.
  if (openId.value) void loadCredentials();
}

/** Sorted scan rows for the settings list. */
const rows = computed(() =>
  [...scanned.value].sort((a, b) => a.name.localeCompare(b.name)),
);

/** Whether the install record for id is enabled. */
function isEnabled(id: string): boolean {
  return installs.value.find((r) => r.id === id)?.enabled === true;
}

/** Icon source in the shape the Built-in tab's rows use. */
function iconFor(ext: ScannedRuntimeExtension) {
  return {
    id: ext.id,
    title: ext.name,
    iconUrl: ext.icon ? runtimeEntryUrlFor(ext.id, ext.icon) : undefined,
  };
}

/** Accounts a package signs requests with, and hosts it reaches without one. */
function reach(ext: ScannedRuntimeExtension) {
  const endpoints = ext.apiEndpoints;
  return {
    credentials: [...new Set(endpoints.flatMap((e) => (e.credential ? [e.credential] : [])))],
    publicHosts: [...new Set(endpoints.filter((e) => !e.credential).flatMap((e) => e.hosts))],
  };
}

// --- accounts ----------------------------------------------------------------

/** Credential names for the chips; connection state for an open row. */
const credentialTypes = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);

async function loadCredentialTypes() {
  try {
    credentialTypes.value = await listCredentialTypes();
  } catch (error) {
    console.error("[kavibay] credential types failed:", error);
  }
}

async function loadCredentials() {
  try {
    credentials.value = await listCredentials();
  } catch (error) {
    console.error("[kavibay] credential status failed:", error);
  }
}

function credentialName(typeId: string): string {
  return credentialTypes.value.find((type) => type.id === typeId)?.displayName ?? typeId;
}

function accountStatus(typeId: string) {
  const summaries = summariesForType(credentials.value, typeId);
  return { label: rowStatusLabel(summaries), tone: typeTone(summaries) };
}

// --- folder ------------------------------------------------------------------

/** Load AppData extensions root path for display. */
async function loadRoot() {
  rootError.value = null;
  try {
    rootPath.value = await invoke<string>("runtime_extensions_root");
  } catch (err) {
    rootPath.value = "";
    rootError.value = String(err);
  }
}

/** Rescan packages; without Developer Extensions only custom ones come back. */
async function onRescan() {
  scanning.value = true;
  folderError.value = null;
  try {
    await rescan();
  } finally {
    scanning.value = false;
  }
}

/**
 * Reopen a package built here in the Widget Wizard.
 *
 * The same event as a widget card's "Edit in Wizard", so the host keeps one
 * rule for which Wizard answers. Settings closes first: it covers the desk the
 * Wizard is about to appear on.
 */
function onOpenInWizard(packageId: string) {
  settings.hide();
  window.dispatchEvent(
    new CustomEvent("kavibay:run-runtime-widget", {
      detail: { typeId: WIDGET_WIZARD_ID, openPackageId: packageId },
    }),
  );
}

/** Show a package or the extensions root in the OS file manager. */
async function onReveal(path: string) {
  folderError.value = null;
  try {
    await revealInFileManager(path);
  } catch (error) {
    folderError.value = String(error);
  }
}

// --- budget ------------------------------------------------------------------

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

/** Save the budget on commit; the backend clamps it and returns what it stored. */
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

// --- enable / consent --------------------------------------------------------

/**
 * Package awaiting confirmation. Enabling grants capabilities, so switching a
 * package on opens the consent step instead of enabling it outright.
 */
const pendingConsent = ref<string | null>(null);

/** Switch on shows it as on while the consent step is open. */
function switchOn(id: string): boolean {
  return isEnabled(id) || pendingConsent.value === id;
}

/** On → ask for consent. Off → drop a pending consent, or disable. */
async function onToggle(id: string, event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.checked) {
    pendingConsent.value = id;
    return;
  }
  pendingConsent.value = null;
  if (isEnabled(id)) await onDisable(id);
  // A failed disable leaves the binding unchanged, so Vue would not reset it.
  input.checked = switchOn(id);
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
    await setEnabled(id, true, contractGrantFrom(grant));
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

/** Disable a package without deleting files. */
async function onDisable(id: string) {
  try {
    await setEnabled(id, false);
  } catch (error) {
    console.error("[kavibay] disabling a runtime package failed:", error);
  }
}

// Custom packages show without Developer Extensions, so the list and the
// budget load either way; the flag only adds the drop-in folder.
onMounted(async () => {
  void loadCredentialTypes();
  await loadRoot();
  await onRescan();
  await refreshBudget();
});

watch(developerExtensionsEnabled, async () => {
  await onRescan();
});
</script>

<template>
  <div class="runtime-ext">
    <p class="runtime-ext-sub">
      Widgets you built or imported here{{ developerExtensionsEnabled ? ", and packages from your extensions folder" : "" }}.
      They run code Kavibay did not ship — turn on only what you trust.
    </p>

    <div v-if="rows.length === 0" class="runtime-ext-empty">
      No widgets yet. Build one in the Widget Wizard<template v-if="developerExtensionsEnabled">,
      or drop a package into the extensions folder below and Rescan</template>.
    </div>

    <div v-else class="runtime-ext-list" role="list">
      <article
        v-for="ext in rows"
        :key="ext.id"
        class="runtime-ext-item"
        :class="{
          'runtime-ext-item--open': openId === ext.id,
          'runtime-ext-item--off': !switchOn(ext.id),
        }"
        role="listitem"
      >
        <div class="runtime-ext-head">
          <button
            type="button"
            class="runtime-ext-open"
            :aria-expanded="openId === ext.id"
            :aria-controls="`runtime-ext-body-${ext.id}`"
            @click="toggleOpen(ext.id)"
          >
            <PaletteWidgetIcon :widget="iconFor(ext)" :size="18" data-icon-tile />
            <span class="runtime-ext-copy">
              <span class="runtime-ext-title">{{ ext.name }}</span>
              <span v-if="ext.description" class="runtime-ext-desc">{{ ext.description }}</span>
              <span class="runtime-ext-meta">
                <span v-for="typeId in reach(ext).credentials" :key="typeId" class="runtime-ext-chip">
                  <BrandMark v-if="brandMarkFor(typeId)" :provider="typeId" :size="12" />
                  <KeyRoundIcon v-else :size="11" />
                  {{ credentialName(typeId) }}
                </span>
                <span v-for="host in reach(ext).publicHosts" :key="host" class="runtime-ext-chip">
                  {{ host }}
                </span>
                <span>
                  {{ ext.origin === "custom" ? "Built here" : "From folder" }} · v{{ ext.version }}<template
                    v-if="usedToday(ext.id) > 0"
                  > · {{ usedToday(ext.id) }} of {{ budget }} calls today</template>
                </span>
              </span>
            </span>
            <svg class="runtime-ext-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <label
            class="switch"
            v-tip="
              ext.status !== 'ready' && !isEnabled(ext.id)
                ? 'Fix the error below to turn it on'
                : isEnabled(ext.id) ? 'Enabled' : 'Disabled'
            "
          >
            <input
              type="checkbox"
              :checked="switchOn(ext.id)"
              :disabled="ext.status !== 'ready' && !isEnabled(ext.id)"
              :aria-label="`Enable ${ext.name}`"
              @change="onToggle(ext.id, $event)"
            />
            <span class="switch-ui" aria-hidden="true" />
          </label>
        </div>

        <p v-if="ext.status !== 'ready'" class="runtime-ext-alert runtime-ext-alert--error">
          Could not load{{ ext.error ? `: ${ext.error}` : "." }}
        </p>

        <div
          v-if="needsReview(ext.id) && pendingConsent !== ext.id"
          class="runtime-ext-alert runtime-ext-alert--warn"
        >
          <span>
            This widget changed what it calls since you turned it on. Its
            requests are blocked until you review the change.
          </span>
          <button type="button" class="runtime-ext-btn" @click="pendingConsent = ext.id">
            Review changes…
          </button>
        </div>

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
              <span class="runtime-ext-endpoint-host">
                {{ endpoint.method }} {{ endpoint.hosts.join(", ") }}
              </span>
              <span v-if="endpoint.credential" class="runtime-ext-endpoint-cred">
                using your {{ credentialName(endpoint.credential) }} account — the
                package never sees the secret
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

        <div v-if="openId === ext.id" :id="`runtime-ext-body-${ext.id}`" class="runtime-ext-body">
          <section v-if="reach(ext).credentials.length > 0" class="runtime-ext-block">
            <h4 class="runtime-ext-block-title">Account</h4>
            <div v-for="typeId in reach(ext).credentials" :key="typeId" class="runtime-ext-account">
              <span class="runtime-ext-tile">
                <BrandMark v-if="brandMarkFor(typeId)" :provider="typeId" :size="18" />
                <KeyRoundIcon v-else :size="16" />
              </span>
              <span class="runtime-ext-account-copy">
                <span class="runtime-ext-account-name">{{ credentialName(typeId) }}</span>
                <span class="runtime-ext-account-status" :data-tone="accountStatus(typeId).tone">
                  {{ accountStatus(typeId).label }}
                </span>
              </span>
              <button
                type="button"
                class="runtime-ext-btn"
                @click="settings.showSection('credentials', typeId)"
              >
                {{ accountStatus(typeId).tone === "idle" ? "Connect" : "Manage" }}
              </button>
            </div>
            <p class="runtime-ext-block-hint">
              Kavibay signs these requests. The widget never sees your login.
            </p>
          </section>

          <!--
            Descriptions come from the package author, so they are rendered as
            text and never as markup.
          -->
          <section v-if="ext.apiEndpoints.length > 0" class="runtime-ext-block">
            <h4 class="runtime-ext-block-title">Requests</h4>
            <ul class="runtime-ext-endpoints">
              <li v-for="endpoint in ext.apiEndpoints" :key="endpoint.id" class="runtime-ext-endpoint">
                <span class="runtime-ext-method">{{ endpoint.method }}</span>
                <span class="runtime-ext-endpoint-copy">
                  {{ endpoint.description }}
                  <span class="runtime-ext-endpoint-host">{{ endpoint.hosts.join(", ") }}</span>
                </span>
              </li>
            </ul>
          </section>
          <p v-else-if="ext.format === 'runtime'" class="runtime-ext-block-hint">
            Makes no network requests.
          </p>

          <div class="runtime-ext-actions">
            <button
              type="button"
              class="runtime-ext-btn runtime-ext-btn--ghost"
              v-tip="ext.path"
              @click="onReveal(ext.path)"
            >
              <FolderIcon :size="14" />
              Show files
            </button>
            <button
              v-if="ext.origin === 'custom'"
              type="button"
              class="runtime-ext-btn runtime-ext-btn--ghost"
              @click="onOpenInWizard(ext.id)"
            >
              <SquarePenIcon :size="14" />
              Open in Widget Wizard
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
              <Trash2Icon :size="14" />
              {{ pendingDelete === ext.id ? "Sure?" : "Delete" }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <section class="settings-section runtime-ext-options">
      <h3 class="settings-section-title">Options</h3>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Daily call limit</span>
          <span class="settings-row-hint">
            Requests each widget may make per day. Cached answers do not count.
          </span>
          <span v-if="budgetFeedback" class="runtime-ext-feedback">{{ budgetFeedback }}</span>
        </span>
        <input
          v-model="budgetInput"
          class="runtime-ext-budget-input"
          type="number"
          min="10"
          max="10000"
          inputmode="numeric"
          @change="onSaveBudget"
        />
      </label>

      <div v-if="developerExtensionsEnabled" class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Extensions folder</span>
          <code class="runtime-ext-path" :title="rootPath || undefined">
            {{ rootPath || (rootError ? "unavailable" : "…") }}
          </code>
          <span v-if="rootError || folderError" class="runtime-ext-error">
            {{ rootError ?? folderError }}
          </span>
        </span>
        <span class="runtime-ext-folder-actions">
          <button
            type="button"
            class="runtime-ext-btn runtime-ext-btn--ghost"
            :disabled="!rootPath"
            @click="onReveal(rootPath)"
          >
            Show folder
          </button>
          <button
            type="button"
            class="runtime-ext-btn"
            :disabled="scanning"
            @click="onRescan"
          >
            {{ scanning ? "Scanning…" : "Rescan" }}
          </button>
        </span>
      </div>

      <div v-else class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Packages from a folder</span>
          <span class="settings-row-hint">
            Turn on <strong>Settings → Behavior → Developer Extensions</strong> to
            load packages dropped into the extensions folder.
          </span>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.runtime-ext {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

.runtime-ext-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.runtime-ext-empty {
  margin: 0;
  padding: 16px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.03);
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.45);
  text-align: center;
}

.runtime-ext-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(14 * 80px + 13 * 6px);
  overflow-y: auto;
  flex-shrink: 0;
}

/* One package: a card like the Built-in tab's, that opens in place. */
.runtime-ext-item {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  box-sizing: border-box;
  min-height: 80px;
  flex-shrink: 0;
}

.runtime-ext-item:hover,
.runtime-ext-item--open {
  background: rgba(var(--fg-rgb), 0.07);
}

.runtime-ext-item:has(.switch input:focus-visible) {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.runtime-ext-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
}

/* The row opens; the switch does not — same split as the Built-in tab. */
.runtime-ext-open {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.runtime-ext-open:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 4px;
  border-radius: 8px;
}

/* Same dimming as an off row on the Built-in tab. */
.runtime-ext-item--off .runtime-ext-open {
  opacity: 0.58;
}

.runtime-ext-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.runtime-ext-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.runtime-ext-desc {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.38);
}

.runtime-ext-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 6px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.72);
}

.runtime-ext-chevron {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: rgba(var(--fg-rgb), 0.45);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 150ms ease;
}

.runtime-ext-item--open .runtime-ext-chevron {
  transform: rotate(180deg);
}

/* Everything under the head is indented to the text column (28px tile + gap). */
.runtime-ext-alert,
.runtime-ext-consent,
.runtime-ext-body {
  margin-left: 40px;
}

.runtime-ext-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  margin-bottom: 0;
  font-size: 12px;
  line-height: 1.4;
}

.runtime-ext-alert--error {
  color: rgba(255, 140, 140, 0.95);
}

.runtime-ext-alert--warn {
  color: rgba(255, 205, 120, 0.9);
}

.runtime-ext-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 12px;
  padding: 14px 0 2px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.runtime-ext-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.runtime-ext-block-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.runtime-ext-block-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.runtime-ext-account {
  display: flex;
  align-items: center;
  gap: 10px;
}

.runtime-ext-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.75);
}

.runtime-ext-account-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.runtime-ext-account-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.9);
}

.runtime-ext-account-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.runtime-ext-account-status::before {
  content: "";
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.25);
}

.runtime-ext-account-status[data-tone="ok"]::before {
  background: #4ade80;
}

.runtime-ext-account-status[data-tone="warn"]::before {
  background: #fbbf24;
}

.runtime-ext-endpoints {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.runtime-ext-endpoint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.runtime-ext-method {
  flex: none;
  min-width: 34px;
  padding: 2px 0;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.08);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  color: rgba(var(--fg-rgb), 0.7);
}

.runtime-ext-endpoint-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.78);
}

.runtime-ext-endpoint-host {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.runtime-ext-endpoint-cred {
  font-size: 10px;
  color: rgba(255, 205, 120, 0.9);
}

.runtime-ext-actions {
  display: flex;
  gap: 4px;
  margin-left: -12px;
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

.runtime-ext-consent-list .runtime-ext-endpoint-host,
.runtime-ext-consent-list .runtime-ext-endpoint-cred {
  display: block;
  font-size: 10px;
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

.runtime-ext-options {
  margin-top: 14px;
}

.runtime-ext-options strong {
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.75);
}

.runtime-ext-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.runtime-ext-budget-input {
  flex: none;
  width: 88px;
  padding: 6px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
}

.runtime-ext-budget-input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.runtime-ext-folder-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.runtime-ext-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
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

.runtime-ext-btn--ghost {
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
}

/* After --ghost, so an armed Delete turns red. */
.runtime-ext-btn--danger {
  background: rgba(255, 120, 120, 0.16);
  color: rgba(255, 157, 157, 0.95);
}

.runtime-ext-feedback {
  font-size: 12px;
  color: rgba(160, 220, 180, 0.9);
}

.runtime-ext-error {
  font-size: 12px;
  color: rgba(255, 140, 140, 0.95);
}

@media (prefers-reduced-motion: reduce) {
  .runtime-ext-chevron {
    transition: none;
  }
}
</style>
