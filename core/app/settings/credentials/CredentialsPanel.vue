<script setup lang="ts">
/**
 * Settings → Credentials.
 *
 * A searchable list of every type in the Rust registry; a row opens in place
 * to show its connections, one at a time. Stacking a full form per type was
 * fine for a handful; it does not survive a long catalog — search and a status
 * filter keep the list short while the registry grows.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { BrandMark, brandMarkFor } from "@sdk/brand";
import { KeyRoundIcon } from "@sdk/icons";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import CredentialAccounts from "./CredentialAccounts.vue";
import {
  listCredentials,
  listCredentialTypes,
  retryCredentialAccess,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "./credentialsApi";
import {
  ALL_STATUSES,
  CREDENTIAL_STATUS_FILTERS,
  applyCredentialFocus,
  filterCredentialTypes,
  resolveSelectedTypeId,
  rowStatusLabel,
  summariesForType,
  typeTone,
  needsDeveloperApp,
  type CredentialStatusFilter,
} from "./credentialsPanelLogic";
import { useSettingsModal } from "../useSettingsModal";
import { keyPlatform } from "../../host/shortcutHints";

const sealedFor =
  keyPlatform() === "mac"
    ? "encrypted with a key in your macOS login keychain"
    : "encrypted for this Windows user";

const types = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const query = ref("");
const statusFilter = ref<CredentialStatusFilter>(ALL_STATUSES);
const selectedId = ref<string | null>(null);
const { credentialType: focusType } = useSettingsModal();

const visible = computed(() =>
  filterCredentialTypes(types.value, credentials.value, query.value, statusFilter.value),
);

/** Open a row, or close it when it is the open one. */
function toggle(typeId: string) {
  selectedId.value = selectedId.value === typeId ? null : typeId;
}

const statusOptions = CREDENTIAL_STATUS_FILTERS.map((entry) => ({
  value: entry.value,
  label: entry.label,
}));

/** Restrict the list to one status bucket from the dropdown. */
function onPickStatus(value: string | number) {
  const next = String(value);
  if (CREDENTIAL_STATUS_FILTERS.some((entry) => entry.value === next)) {
    statusFilter.value = next as CredentialStatusFilter;
  }
}

watch(
  () => visible.value.map((type) => type.id).join("\0"),
  () => {
    selectedId.value = resolveSelectedTypeId(
      visible.value,
      credentials.value,
      selectedId.value,
    );
  },
);

/** Select the type a caller named, after the catalog is on screen. */
function applyFocus(requested: string | null): void {
  const next = applyCredentialFocus(types.value, requested);
  if (!next.selectedId) return;
  if (next.resetFilters) {
    query.value = "";
    statusFilter.value = ALL_STATUSES;
  }
  selectedId.value = next.selectedId;
  focusType.value = null;
  void nextTick(() => {
    document.querySelector(".creds-item--open")?.scrollIntoView({ block: "nearest" });
  });
}

async function reload() {
  error.value = null;
  try {
    const [loadedTypes, loadedCredentials] = await Promise.all([
      listCredentialTypes(),
      listCredentials(),
    ]);
    types.value = loadedTypes;
    credentials.value = loadedCredentials;
    applyFocus(focusType.value);
  } catch (cause) {
    error.value = String(cause);
  } finally {
    loading.value = false;
  }
}

/** Load again; after a denied keychain prompt, macOS asks once more. */
async function retry() {
  loading.value = true;
  try {
    await retryCredentialAccess();
  } finally {
    await reload();
  }
}

watch(focusType, (requested) => {
  if (requested && types.value.length > 0) applyFocus(requested);
});

onMounted(reload);
</script>

<template>
  <div class="creds">
    <Teleport to=".settings-sticky">
    <header class="creds-head">
      <h2 class="creds-title">Credentials</h2>
      <p class="creds-lead">
        API keys and tokens for integrations. Values are {{ sealedFor }} and never
        leave the backend — the app only reports whether a secret is set.
      </p>
    </header>
    </Teleport>

    <p v-if="loading" class="creds-note">Loading…</p>
    <div v-else-if="error" class="creds-failed">
      <p class="creds-error">{{ error }}</p>
      <button type="button" class="creds-retry" @click="retry">Try again</button>
    </div>

    <template v-else>
      <section class="settings-section">
        <div class="creds-filters">
          <input
            v-model="query"
            type="search"
            class="creds-search"
            placeholder="Search integrations"
            aria-label="Search credential providers"
          />
          <KavibaySelect
            class="creds-status"
            size="md"
            align="right"
            aria-label="Filter by status"
            :options="statusOptions"
            :model-value="statusFilter"
            @update:model-value="onPickStatus"
          />
        </div>
        <p class="settings-section-hint creds-count">
          {{ visible.length === types.length ? `${types.length} integrations` : `${visible.length} of ${types.length}` }}
        </p>

        <div
          v-for="type in visible"
          :key="type.id"
          class="creds-item"
          :class="{ 'creds-item--open': selectedId === type.id }"
        >
          <button
            type="button"
            class="creds-row"
            :aria-expanded="selectedId === type.id"
            @click="toggle(type.id)"
          >
            <span class="creds-tile">
              <BrandMark v-if="brandMarkFor(type.id)" :provider="type.id" :size="18" />
              <KeyRoundIcon v-else :size="16" />
            </span>
            <span class="settings-row-copy creds-row-copy">
              <span class="settings-row-title">
                {{ type.displayName }}
                <span
                  v-if="needsDeveloperApp(type)"
                  class="creds-devapp"
                  :title="`Needs an app you register with ${type.displayName} first`"
                >
                  Developer app
                </span>
              </span>
              <span class="settings-row-hint creds-row-hint">{{ type.description }}</span>
            </span>
            <span
              v-if="typeTone(summariesForType(credentials, type.id)) !== 'idle'"
              class="creds-state"
              :class="`creds-state--${typeTone(summariesForType(credentials, type.id))}`"
            >
              {{ rowStatusLabel(summariesForType(credentials, type.id)) }}
            </span>
            <span v-else-if="selectedId !== type.id" class="creds-setup">Set up</span>
            <svg class="creds-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <div v-if="selectedId === type.id" class="creds-body">
            <CredentialAccounts
              :key="type.id"
              :type="type"
              :credentials="credentials"
              @changed="reload"
            />
          </div>
        </div>

        <p v-if="visible.length === 0" class="settings-section-hint creds-empty">
          No integrations match this filter.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.creds {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-bottom: 8px;
}

.creds-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.creds-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.creds-lead,
.creds-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.creds-error {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 140, 140, 0.95);
}

.creds-failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.creds-retry {
  padding: 6px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.creds-retry:hover {
  background: rgba(var(--fg-rgb), 0.06);
}

.creds-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168px;
  gap: 8px;
}

.creds-search {
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 8px;
  background: rgba(var(--inset-rgb), 0.25);
  color: rgba(var(--fg-rgb), 0.88);
  font: inherit;
  font-size: 13px;
}

.creds-search::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.creds-search:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
}

.creds-status {
  min-width: 0;
}

.creds-count {
  margin: 8px 0 2px;
}

/* One integration: a row that opens in place, as on Settings → AI. */
.creds-item {
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
}

.creds-item:last-of-type {
  border-bottom: 0;
}

.creds-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 12px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.creds-row:hover,
.creds-row:focus-visible {
  outline: none;
  background: rgba(var(--fg-rgb), 0.04);
}

.creds-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.75);
}

.creds-row-copy {
  flex: 1;
}

.creds-row-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Marks the integrations whose setup starts outside Kavibay, in the provider's console. */
.creds-devapp {
  margin-left: 6px;
  padding: 1px 7px;
  border: 1px solid rgba(167, 139, 250, 0.35);
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.16);
  color: #ddd6fe;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

:global(html[data-color-mode="light"]) .creds-devapp {
  background: rgba(139, 92, 246, 0.1);
  color: #5b21b6;
}

/* Open, the description is the setup help — show all of it. */
.creds-item--open .creds-row-hint {
  white-space: normal;
}

.creds-state {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 40%;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creds-state::before {
  content: "";
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.creds-state--ok::before {
  background: #4ade80;
}

.creds-state--warn::before {
  background: #fbbf24;
}

.creds-setup {
  flex: none;
  padding: 4px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.85);
}

.creds-chevron {
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

.creds-item--open .creds-chevron {
  transform: rotate(180deg);
}

/* Indented to the text column, so it reads as belonging to the row above. */
.creds-body {
  padding: 4px 0 18px 46px;
}

.creds-empty {
  padding: 12px 0;
}

@media (prefers-reduced-motion: reduce) {
  .creds-chevron {
    transition: none;
  }
}
</style>
