<script setup lang="ts">
/**
 * The approval dialog for a widget package.
 *
 * It renders a `PermissionRequest` and hands back a grant. It decides nothing —
 * `permissionRequest.ts` does, and is tested, because a dialog that looks right
 * and returns a grant nobody ticked is not something a screenshot catches.
 *
 * Two things it must never become: a summary of what the widget already has,
 * and a dialog with a pre-ticked box. Both turn consent into a formality, and
 * the second one is a grant the user did not make.
 */
import { computed, ref } from "vue";
import type { ApprovedGrant } from "../widgetPackage";
import { grantFrom, type PermissionRequest } from "../permissionRequest";
import { BrandMark } from "@sdk/brand";

const props = defineProps<{
  /** What the package is called, for the sentence at the top. */
  displayName: string;
  request: PermissionRequest;
  /** Replaces "Add …?", for a caller whose question is a different one. */
  title?: string;
  /** Replaces the counted "Add with …" label on the approve button. */
  confirmLabel?: string;
}>();

const emit = defineEmits<{
  approve: [grant: ApprovedGrant];
  cancel: [];
}>();

/**
 * Local copy, so cancelling leaves the caller's object untouched. `actions` is
 * an object of its own, so it is copied too, or ticking it would write into
 * the caller's request.
 */
const choices = ref(
  props.request.choices.map((c) => ({ ...c, ...(c.actions ? { actions: { ...c.actions } } : {}) })),
);

/** Each ticked account counts, and so does each change allowed on one. */
const granted = computed(
  () =>
    choices.value.filter((c) => c.granted).length +
    choices.value.filter((c) => c.granted && c.actions?.granted).length,
);

const asksForChanges = computed(() => choices.value.some((c) => c.actions));

function approve() {
  emit("approve", grantFrom({ ...props.request, choices: choices.value }));
}
</script>

<template>
  <section class="permission">
    <header>
      <h2 class="title">{{ title ?? `Add ${displayName}?` }}</h2>
      <p class="sub">
        <template v-if="choices.length">
          Choose which accounts it may read from<template v-if="asksForChanges">,
          and where it may also make changes</template>.
        </template>
        <template v-else>This widget asks for nothing.</template>
      </p>
    </header>

    <ul v-if="choices.length" class="list">
      <li v-for="choice in choices" :key="choice.provider">
        <label class="row">
          <input v-model="choice.granted" type="checkbox" />
          <BrandMark :provider="choice.provider" :size="16" class="mark" />
          <span class="label">
            {{ choice.providerName }}
            <em v-if="choice.note">{{ choice.note }}</em>
            <small>{{ choice.summary }}</small>
          </span>
        </label>
        <!--
          A second answer on the same account, never a pre-ticked one, and only
          once the account itself is ticked: a change on something the widget
          may not read is not a state this dialog can hand back.
        -->
        <label v-if="choice.actions" class="row changes" :class="{ off: !choice.granted }">
          <input v-model="choice.actions.granted" type="checkbox" :disabled="!choice.granted" />
          <span class="label">
            May also make changes
            <small>{{ choice.actions.summary }}</small>
          </span>
        </label>
      </li>
    </ul>

    <!--
      Shown rather than hidden. A package asking for something it cannot have is
      worth seeing — it is the clearest signal a user gets about what was
      generated, and hiding it would leave them wondering what the rest does.
    -->
    <p v-if="request.refused.length" class="refused">
      Not available to a generated widget, and not granted:
      {{ request.refused.join(", ") }}
    </p>

    <!-- What the caller has to add, such as the endpoints an imported widget calls. -->
    <slot />

    <footer class="actions">
      <button type="button" class="ghost" @click="emit('cancel')">Cancel</button>
      <button type="button" class="primary" @click="approve">
        {{
          confirmLabel ??
          (granted === 0 ? "Add without access" : `Add with ${granted} permission${granted === 1 ? "" : "s"}`)
        }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.permission {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  max-width: 420px;
}

.title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted, rgba(255, 255, 255, 0.55));
}

.label small {
  display: block;
  opacity: 0.65;
}

.label em {
  font-style: normal;
  opacity: 0.65;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13px;
  line-height: 1.45;
  cursor: pointer;
}

.label { flex: 1 1 auto; }

/* Indented under the account it belongs to: the mark's width plus the gap. */
.changes {
  margin-top: 6px;
  padding-left: 25px;
}

.changes.off {
  opacity: 0.45;
  cursor: default;
}

.mark { margin-top: 1px; }

.refused {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-faint, rgba(255, 255, 255, 0.4));
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.actions button {
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  border-radius: 8px;
  cursor: pointer;
}

.ghost {
  background: transparent;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
}

.primary {
  background: var(--fill, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.28));
}

.actions button:hover { background: var(--fill-hover, rgba(255, 255, 255, 0.16)); }
</style>
