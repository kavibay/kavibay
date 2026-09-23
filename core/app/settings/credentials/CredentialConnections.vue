<script setup lang="ts">
/**
 * One platform's accounts: the list, and the editor for the selected one.
 *
 * A list rather than a dropdown, because the question this panel answers is
 * "which accounts do I have on Linear" and a closed `<select>` answers it only
 * after a click — on the screen where you go *because* you are not sure.
 *
 * The app-wide default is a property of a row for the same reason. As its own
 * control under the editor it was a second dropdown carrying the same label as
 * the first, and nothing said which of the two you were looking at.
 */
import { computed, ref, watch } from "vue";
import CredentialEditor from "./CredentialEditor.vue";
import {
  connectionEpoch,
  connectionsChanged,
  connectionSelection,
  HOST_OWNER,
  selectConnection,
} from "./connections";
import { statusTone } from "./credentialsLogic";
import { rowStatusLabel } from "./credentialsPanelLogic";
import type { CredentialSummary, CredentialTypeSchema } from "./credentialsApi";

const props = defineProps<{ type: CredentialTypeSchema; credentials: CredentialSummary[] }>();
const emit = defineEmits<{ changed: [] }>();

const selected = ref<string | null>(null);
const creating = ref(false);
const defaultId = ref<string | null>(null);
const error = ref("");

const entries = computed(() => props.credentials.filter((entry) => entry.typeId === props.type.id));

/** The row the editor is showing; `null` while adding a new one. */
const summary = computed(() =>
  creating.value
    ? null
    : (entries.value.find((entry) => entry.id === selected.value) ?? entries.value[0] ?? null),
);

/**
 * A second connection must not arrive named like the first. The name is the
 * only thing telling two API keys apart — Linear's are per workspace and look
 * identical everywhere else — so defaulting it to the type name again would
 * produce two rows called "Linear API Key".
 */
const suggestedName = computed(() =>
  entries.value.length === 0 ? "" : `${props.type.displayName} ${entries.value.length + 1}`,
);

watch(
  () => [props.type.id, connectionEpoch.value],
  async () => {
    try {
      defaultId.value = (await connectionSelection(HOST_OWNER, props.type.id)).credentialId;
      error.value = "";
    } catch (cause) {
      error.value = String(cause);
    }
  },
  { immediate: true },
);

async function makeDefault(id: string) {
  try {
    await selectConnection(HOST_OWNER, props.type.id, id);
  } catch (cause) {
    error.value = String(cause);
  }
}

function pick(id: string) {
  selected.value = id;
  creating.value = false;
}

function saved(id: string) {
  pick(id);
}

function changed() {
  connectionsChanged();
  emit("changed");
}
</script>

<template>
  <section class="conns">
    <!-- With nothing saved yet the editor *is* the add form; a list of one
         empty state above it would only push it down. -->
    <template v-if="entries.length > 0">
      <h3 class="conns-title">Accounts</h3>
      <div class="conns-list" role="listbox" :aria-label="`${type.displayName} connections`">
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="conn-row"
          :class="{ 'conn-row--active': !creating && summary?.id === entry.id }"
        >
          <button
            type="button"
            role="option"
            class="conn-pick"
            :aria-selected="!creating && summary?.id === entry.id"
            @click="pick(entry.id)"
          >
            <span class="conn-name">{{ entry.name }}</span>
            <span class="conn-pill" :class="`conn-pill--${statusTone(entry)}`">
              {{ rowStatusLabel([entry]) }}
            </span>
          </button>

          <!--
            Sibling of the row button, not inside it: a button within a button
            is invalid, and the two are genuinely different actions.
          -->
          <span v-if="defaultId === entry.id" class="conn-default" title="Used by app-wide actions">
            Default
          </span>
          <button
            v-else-if="entries.length > 1"
            type="button"
            class="conn-make-default"
            @click="makeDefault(entry.id)"
          >
            Make default
          </button>
        </div>

        <button
          type="button"
          class="conn-add"
          :class="{ 'conn-add--active': creating }"
          @click="creating = true"
        >
          + Add connection
        </button>
      </div>

      <p class="conns-note">
        Each widget picks its own connection in its settings. The default is what
        the command palette, quick AI actions and the Wizard use.
      </p>
    </template>

    <p v-if="error" class="conns-error" role="alert">{{ error }}</p>

    <CredentialEditor
      :key="summary?.id ?? 'new'"
      :type="type"
      :summary="summary"
      :suggested-name="suggestedName"
      @saved="saved"
      @changed="changed"
    />
  </section>
</template>

<style scoped>
.conns {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Without a heading the rows read as more of the provider list above them:
   same width, same row shape, no break. */
.conns-title {
  margin: 4px 2px 0;
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.55);
}

.conns-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
}

.conn-row:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.conn-row--active,
.conn-row--active:hover {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.conn-pick {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
  padding: 10px 12px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.conn-name {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn-pill {
  flex: none;
  max-width: 45%;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn-pill--ok {
  background: rgba(120, 200, 150, 0.16);
  color: rgba(160, 220, 180, 0.95);
}

.conn-pill--warn {
  background: rgba(255, 205, 120, 0.16);
  color: rgba(255, 205, 120, 0.95);
}

.conn-default {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.7);
  font-size: 11px;
  white-space: nowrap;
}

.conn-make-default {
  flex: none;
  padding: 3px 8px;
  border: none;
  border-radius: 999px;
  background: none;
  color: rgba(var(--fg-rgb), 0.5);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.conn-make-default:hover,
.conn-make-default:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.1);
  outline: none;
}

.conn-add {
  padding: 9px 12px;
  border: 1px dashed rgba(var(--fg-rgb), 0.16);
  border-radius: 12px;
  background: none;
  color: rgba(var(--fg-rgb), 0.55);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.conn-add:hover,
.conn-add:focus-visible,
.conn-add--active {
  border-color: rgba(var(--fg-rgb), 0.3);
  color: rgba(var(--fg-rgb), 0.9);
  outline: none;
}

.conns-note {
  margin: 0 2px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.4);
}

.conns-error {
  margin: 0 2px;
  font-size: 12px;
  color: rgba(255, 140, 140, 0.95);
}
</style>
