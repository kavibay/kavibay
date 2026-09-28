<script setup lang="ts">
import { computed, ref } from "vue";
import { durableStorageFailures, retryDurableStorage } from "./durableStorage";

const retrying = ref(false);
const loadFailed = computed(() => durableStorageFailures.value.some((failure) => failure.operation === "load"));
const saveFailed = computed(() => durableStorageFailures.value.some((failure) => failure.operation === "save"));

/** Keep the warning visible until the write has actually succeeded. */
async function retry(): Promise<void> {
  if (retrying.value) return;
  retrying.value = true;
  try { await retryDurableStorage(); }
  finally { retrying.value = false; }
}
</script>

<template>
  <aside v-if="durableStorageFailures.length" class="storage-notice" data-interactive aria-label="Storage problem">
    <div role="alert">
      <strong>{{ loadFailed ? 'Saved data could not be loaded' : 'Changes could not be saved' }}</strong>
      <p v-if="loadFailed">The saved copy has been left untouched. Copy any new work somewhere safe before restarting Kavibay to retry.</p>
      <p v-else>Your latest changes may be lost when Kavibay closes. Try saving again.</p>
    </div>
    <button v-if="saveFailed" type="button" :disabled="retrying" @click="retry">
      {{ retrying ? 'Saving…' : 'Try saving again' }}
    </button>
    <details>
      <summary>Details</summary>
      <p v-for="failure in durableStorageFailures" :key="failure.file">
        {{ failure.file === 'state' ? 'Widget data and layout' : 'Settings' }}: {{ failure.detail }}
      </p>
    </details>
  </aside>
</template>

<style scoped>
.storage-notice {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1050;
  width: min(440px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 12px 16px;
  border: 1px solid #e07a5f;
  border-radius: 12px;
  background: rgb(var(--surface-bg-rgb));
  color: rgb(var(--fg-rgb));
  box-shadow: var(--surface-box-shadow);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
}
p { margin: 6px 0; overflow-wrap: anywhere; }
button {
  padding: 5px 10px;
  margin: 4px 0;
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: wait; }
details { margin-top: 6px; color: rgba(var(--fg-rgb), 0.7); }
summary { cursor: pointer; }
</style>
