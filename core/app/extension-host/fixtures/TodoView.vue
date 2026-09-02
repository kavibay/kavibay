<script setup lang="ts">
import { ref } from "vue";

/**
 * The view half of the Todo widget. Pure presentation over the model that
 * `todo.ts` returned from `setup(ctx)`.
 *
 * Note what is absent: no `onMounted`, no loading flag, no error branch, no
 * connect screen. The runtime resolved all of that before this component was
 * created — it only ever renders when there is something to render. Compare
 * `extensions/clock/ClockWidget.vue`, which owns its own mount and unmount.
 */
interface Todo { id: string; text: string; done: boolean }

defineProps<{
  model: {
    todos: Todo[];
    add(text: string): Promise<number>;
    toggle(id: string): Promise<void>;
  };
}>();

const draft = ref("");

async function submit(add: (text: string) => Promise<number>) {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = "";
  await add(text);
}
</script>

<template>
  <div class="todo">
    <!--
      Deliberately NOT a <form>, and this is a rule for every widget view rather
      than a quirk of this one.

      A widget runs inside `sandbox="allow-scripts"`, and the HTML form
      submission algorithm checks the sandbox flag *before* it fires the submit
      event. So in a frame without `allow-forms` the event never arrives and
      `@submit.prevent` never runs — the handler is not prevented, it is
      skipped. The widget looks fine and does nothing, which is the worst shape
      a failure can take.

      Both affordances are wired explicitly instead. The button is not
      decoration: without it the only way to add an item is Enter in a lone text
      field, which has no visible or clickable path.
    -->
    <div class="add">
      <input
        v-model="draft"
        class="input"
        type="text"
        placeholder="Add an item…"
        @keyup.enter="submit(model.add)"
      />
      <button type="button" class="add-btn" aria-label="Add item" :disabled="!draft.trim()" @click="submit(model.add)">+</button>
    </div>

    <p v-if="model.todos.length === 0" class="empty">Nothing yet.</p>

    <ul v-else class="list">
      <li v-for="item in model.todos" :key="item.id" class="item">
        <label class="row">
          <input type="checkbox" :checked="item.done" @change="model.toggle(item.id)" />
          <span :class="{ done: item.done }">{{ item.text }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.todo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  min-height: 0;
}

.add {
  display: flex;
  gap: 6px;
}

.input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.06);
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
  box-sizing: border-box;
}

.add-btn {
  flex: 0 0 auto;
  width: 26px;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.08);
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
  cursor: pointer;
}

.add-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.add-btn:not(:disabled):hover { background: rgba(var(--fg-rgb), 0.15); }

.empty {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 0;
}

.item + .item { margin-top: 4px; }

.row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  cursor: pointer;
}

.done {
  text-decoration: line-through;
  color: rgba(var(--fg-rgb), 0.45);
}
</style>
