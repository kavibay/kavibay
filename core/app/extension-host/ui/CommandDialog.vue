<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ArgSpec } from "@sdk/contract/sdk";
import { holdHostDismiss } from "@sdk/hostDismiss";

/**
 * PHASE 5 — the runtime's own `HostUi`, for the two questions a command can ask
 * and the one thing it can say.
 *
 * Why the extension host renders this instead of reusing the palette's argument
 * chips: chips are declared up front with fixed `enum` options, and a
 * provider-sourced argument cannot be. Its options come from a live query at
 * invocation, because a calendar list does not exist before the account is
 * connected (finding 3, and Phase 5 says so in as many words). Declaring them
 * at load would either be empty or stale.
 *
 * A command never draws this itself. It calls `ctx.ui.prompt`, and what appears
 * is the runtime's, for the same reason the connect prompt and the error panel
 * are: one shape for every extension.
 */
export type PromptSpec = ArgSpec & {
  name: string;
  options?: { value: string | number; label: string }[];
};

const props = defineProps<{
  /** Set while a command waits on an answer; null when nothing is asked. */
  request:
    | { kind: "prompt"; spec: PromptSpec }
    | { kind: "confirm"; message: string }
    | null;
}>();

const emit = defineEmits<{
  /** `undefined` means cancelled — `runCommand` treats that as "do nothing". */
  answer: [value: string | number | boolean | undefined];
  confirm: [ok: boolean];
}>();

const draft = ref<string>("");
const field = ref<HTMLInputElement | HTMLSelectElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

const spec = computed(() => (props.request?.kind === "prompt" ? props.request.spec : undefined));
const options = computed(() => spec.value?.options ?? []);

watch(
  () => props.request,
  async (request, _previous, onCleanup) => {
    if (!request) return;
    const previousFocus = document.activeElement;
    const release = holdHostDismiss("command dialog");
    onCleanup(() => {
      release();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    });
    draft.value = "";
    await nextTick();
    if (props.request === request) (field.value ?? cancelButton.value)?.focus();
  },
  { immediate: true },
);

function submit() {
  const current = spec.value;
  if (!current) return;

  const text = draft.value.trim();
  if (!text) {
    // Required is the default for a declared arg; an empty answer is a cancel
    // rather than an empty string, so the command does not write "" somewhere.
    emit("answer", current.required === false ? undefined : undefined);
    return;
  }
  if (current.type === "number") {
    const parsed = Number(text);
    if (Number.isNaN(parsed)) return; // keep the dialog open rather than send junk
    emit("answer", parsed);
    return;
  }
  if (current.type === "boolean") {
    emit("answer", text === "true" || text === "1" || text.toLowerCase() === "yes");
    return;
  }
  emit("answer", text);
}

function cancel() {
  if (props.request?.kind === "confirm") emit("confirm", false);
  else emit("answer", undefined);
}

/** Keep Tab inside the question and keep Escape from dismissing the cockpit. */
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  } else if (event.key === "Tab") {
    const controls = [...(dialog.value?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select") ?? [])];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
</script>

<template>
  <div v-if="request" class="scrim" data-interactive @click.self="cancel" @keydown="onKeydown">
    <div ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="command-question">
      <template v-if="request.kind === 'confirm'">
        <p id="command-question" class="question">{{ request.message }}</p>
        <div class="row">
          <button ref="cancelButton" type="button" class="btn" @click="emit('confirm', false)">Cancel</button>
          <button type="button" class="btn primary" @click="emit('confirm', true)">Confirm</button>
        </div>
      </template>

      <form v-else class="form" @submit.prevent="submit">
        <label id="command-question" class="question" :for="'arg-' + spec!.name">{{ spec!.label }}</label>

        <!-- Options come from a query the runtime ran a moment ago, not from
             the manifest — that is the whole point of asking here. -->
        <select
          v-if="options.length > 0"
          :id="'arg-' + spec!.name"
          ref="field"
          v-model="draft"
          class="input"
        >
          <option value="" disabled>Choose…</option>
          <option v-for="opt in options" :key="String(opt.value)" :value="String(opt.value)">
            {{ opt.label }}
          </option>
        </select>

        <input
          v-else
          :id="'arg-' + spec!.name"
          ref="field"
          v-model="draft"
          class="input"
          :type="spec!.type === 'number' ? 'number' : 'text'"
        />

        <div class="row">
          <button type="button" class="btn" @click="cancel">Cancel</button>
          <button type="submit" class="btn primary" :disabled="!draft.trim()">OK</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 1100;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.dialog {
  min-width: 280px;
  max-width: 380px;
  padding: 16px;
  border-radius: 12px;
  background: rgb(var(--surface-bg-rgb));
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.question {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}

.input {
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.07);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
}

.row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  padding: 5px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.09);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
  cursor: pointer;
}

.btn:hover { background: rgba(var(--fg-rgb), 0.15); }
.btn:disabled { opacity: 0.4; cursor: default; }
.primary { background: rgba(var(--fg-rgb), 0.18); }
</style>
