<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { ConfigField, ConfigOption } from "@sdk/contract/sdk";
import KavibaySelect from "@sdk/KavibaySelect.vue";

/**
 * Gate state `unconfigured`. The form is generated from the widget's
 * `configuration` schema — no widget ships its own settings screen, which is
 * what keeps a generated widget from inventing UI the user has to relearn.
 *
 * `select` fields whose options come from a provider query are the reason this
 * state is ordered *after* `provider`: the option list cannot be fetched until
 * the provider is connected. That ordering is enforced in `Host.widgetGate`;
 * here it just means `loadOptions` can assume a live provider.
 */
type FieldValue = string | number | boolean | Array<string | number> | undefined;

const props = defineProps<{
  schema: Record<string, ConfigField>;
  /** Required keys still unset — used to mark them, not to filter the form. */
  missing: string[];
  values: Record<string, unknown>;
  /** Resolves provider-backed `select` options. Omitted in previews. */
  loadOptions?: (field: ConfigField) => Promise<{ value: string | number; label: string }[]>;
}>();

const emit = defineEmits<{ save: [values: Record<string, unknown>] }>();

/** Seeded from current values, falling back to the schema's declared default. */
const draft = reactive<Record<string, FieldValue>>(
  Object.fromEntries(
    Object.entries(props.schema).map(([key, field]) => [
      key,
      (props.values[key] as FieldValue) ?? (field.default as FieldValue),
    ]),
  ),
);

const initialOptions: Record<string, ConfigOption[]> = {};
for (const [key, field] of Object.entries(props.schema)) {
  if (field.options) initialOptions[key] = [...field.options];
}

const options = ref<Record<string, ConfigOption[]>>(initialOptions);
const loadFailed = ref<Record<string, boolean>>({});

onMounted(async () => {
  if (!props.loadOptions) return;
  for (const [key, field] of Object.entries(props.schema)) {
    if (field.type !== "select" || field.options || !field.source) continue;
    try {
      options.value = { ...options.value, [key]: await props.loadOptions(field) };
    } catch {
      // A failed option fetch must not throw from the form. Single selects
      // degrade to a plain input; multi-selects keep their current array and
      // show an empty option list until the provider can be queried again.
      loadFailed.value = { ...loadFailed.value, [key]: true };
    }
  }
});

const isMissing = (key: string) => props.missing.includes(key);
const asMultiSelect = (field: ConfigField) => field.type === "select" && field.multiple === true;
const asSelect = (key: string, field: ConfigField) =>
  field.type === "select" && field.multiple !== true && !loadFailed.value[key];

/** KavibaySelect only accepts the value types a select can actually emit. */
function selectValue(key: string): string | number | undefined {
  const value = draft[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function setSelectValue(key: string, value: string | number) {
  draft[key] = value;
}

function selectValues(key: string): Array<string | number> {
  const value = draft[key];
  return Array.isArray(value)
    ? value.filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    : [];
}

function isMultiSelected(key: string, value: string | number): boolean {
  return selectValues(key).some((item) => item === value);
}

function toggleMultiValue(key: string, value: string | number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const current = selectValues(key);
  draft[key] = checked
    ? [...current, value].filter((item, index, all) => all.indexOf(item) === index)
    : current.filter((item) => item !== value);
}

function submit() {
  emit("save", { ...draft });
}
</script>

<template>
  <form class="config" @submit.prevent="submit">
    <!--
      Only while something is actually missing. The same form is the widget's
      settings panel once it runs, and there "needs a few details" would be
      telling the user about a problem they do not have.
    -->
    <p v-if="missing.length > 0" class="intro">This widget needs a few details.</p>

    <label v-for="(field, key) in schema" :key="key" class="field">
      <span class="label">
        {{ field.label }}
        <span v-if="isMissing(String(key))" class="required" aria-label="required">*</span>
      </span>

      <div
        v-if="asMultiSelect(field)"
        class="multi-select"
        role="listbox"
        :aria-label="field.label"
        aria-multiselectable="true"
      >
        <label v-for="option in options[String(key)] ?? []" :key="option.value" class="multi-option">
          <input
            type="checkbox"
            :checked="isMultiSelected(String(key), option.value)"
            @change="toggleMultiValue(String(key), option.value, $event)"
          />
          <span>{{ option.label }}</span>
        </label>
        <p v-if="(options[String(key)] ?? []).length === 0" class="multi-empty">
          Nothing to choose
        </p>
      </div>

      <KavibaySelect
        v-else-if="asSelect(String(key), field)"
        :model-value="selectValue(String(key))"
        :options="options[String(key)] ?? []"
        placeholder="Choose…"
        :aria-label="field.label"
        @update:model-value="setSelectValue(String(key), $event)"
      />

      <input
        v-else-if="field.type === 'boolean'"
        v-model="draft[key]"
        type="checkbox"
        class="checkbox"
      />

      <input
        v-else-if="field.type === 'number'"
        v-model.number="draft[key]"
        type="number"
        class="input"
      />

      <input
        v-else
        v-model="draft[key]"
        type="text"
        class="input"
      />
    </label>

    <button type="submit" class="save">Save</button>
  </form>
</template>

<style scoped>
.config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  overflow-y: auto;
}

.intro {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.6);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 12px;
  font-weight: 500;
}

.required {
  color: rgba(var(--fg-rgb), 0.45);
}

.input {
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.06);
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
}

.checkbox {
  align-self: flex-start;
}

.multi-select {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.multi-option {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.multi-option:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.multi-empty {
  margin: 0;
  padding: 6px;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 12px;
}

.save {
  align-self: flex-start;
  margin-top: 2px;
  padding: 5px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
  cursor: pointer;
}

.save:hover { background: rgba(var(--fg-rgb), 0.16); }
</style>
