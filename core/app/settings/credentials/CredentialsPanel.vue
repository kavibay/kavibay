<script setup lang="ts">
/**
 * Settings → Credentials.
 *
 * A searchable list of every type in the Rust registry, with one editor open
 * at a time. Stacking a full form per type was fine for a handful; it does
 * not survive a long catalog — search, a status filter, and a capped list
 * keep the form on screen while the registry grows.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { BrandMark } from "@sdk/brand";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import CredentialConnections from "./CredentialConnections.vue";
import {
  listCredentials,
  listCredentialTypes,
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
  type CredentialStatusFilter,
} from "./credentialsPanelLogic";
import { useSettingsModal } from "../useSettingsModal";

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

const selectedType = computed(
  () => visible.value.find((type) => type.id === selectedId.value) ?? null,
);

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
    document.querySelector(".creds-row--active")?.scrollIntoView({ block: "nearest" });
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

watch(focusType, (requested) => {
  if (requested && types.value.length > 0) applyFocus(requested);
});

onMounted(reload);
</script>

<template>
  <div class="creds">
    <header class="creds-head">
      <h2 class="creds-title">Credentials</h2>
      <p class="creds-lead">
        API keys and tokens for integrations. Values are encrypted for this Windows
        user and never leave the backend — the app only reports whether a secret is set.
      </p>
    </header>

    <p v-if="loading" class="creds-note">Loading…</p>
    <p v-else-if="error" class="creds-error">{{ error }}</p>

    <template v-else>
      <section class="creds-block">
        <div class="creds-filters">
          <input
            v-model="query"
            type="search"
            class="creds-search"
            placeholder="Search providers"
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
        <p class="creds-count">{{ visible.length }} of {{ types.length }}</p>

        <div class="creds-list" role="listbox" aria-label="Credential providers">
          <button
            v-for="type in visible"
            :key="type.id"
            type="button"
            role="option"
            class="creds-row"
            :class="{ 'creds-row--active': selectedId === type.id }"
            :aria-selected="selectedId === type.id"
            @click="selectedId = type.id"
          >
            <span class="creds-mark">
              <BrandMark :provider="type.id" :size="18" />
            </span>
            <span class="creds-row-text">
              <span class="creds-row-title">{{ type.displayName }}</span>
              <span class="creds-row-hint">{{ type.description }}</span>
            </span>
            <span
              class="creds-pill"
              :class="`creds-pill--${typeTone(summariesForType(credentials, type.id))}`"
            >
              {{ rowStatusLabel(summariesForType(credentials, type.id)) }}
            </span>
          </button>
          <p v-if="visible.length === 0" class="creds-empty">
            No providers match this filter.
          </p>
        </div>
      </section>

      <CredentialConnections
        v-if="selectedType"
        :key="selectedType.id"
        :type="selectedType"
        :credentials="credentials"
        @changed="reload"
      />
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
.creds-note,
.creds-empty {
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

.creds-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.creds-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168px;
  gap: 8px;
}

.creds-search {
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
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
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.creds-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(280px, 42vh);
  overflow-y: auto;
}

.creds-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.creds-row:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.creds-row--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.creds-row--active:hover {
  background: var(--row-selected-sheen), var(--row-selected-bg);
}

.creds-mark {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.creds-row-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.creds-row-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creds-row-hint {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creds-row--active .creds-row-hint {
  color: rgba(var(--fg-rgb), 0.55);
}

.creds-pill {
  flex: none;
  max-width: 42%;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creds-pill--ok {
  background: rgba(120, 200, 150, 0.16);
  color: rgba(160, 220, 180, 0.95);
}

.creds-pill--warn {
  background: rgba(255, 205, 120, 0.16);
  color: rgba(255, 205, 120, 0.95);
}

.creds-empty {
  padding: 12px 4px;
}
</style>
