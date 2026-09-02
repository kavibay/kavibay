<script setup lang="ts">
import { computed } from "vue";
import type { ProviderError } from "@sdk/contract/sdk";

/**
 * The one error state. Driven by the typed `ProviderError` kind rather than by
 * a message string, so the wording is the runtime's and an extension cannot
 * put arbitrary prose in front of the user.
 */
/**
 * `error` is optional even though the gate only renders this branch when there
 * is one. Retry lives *inside* this panel: clicking it clears the failure, and
 * the computeds below re-evaluate in that same tick — with the prop already
 * gone — before the parent unmounts the branch. A panel that crashes on its own
 * "try again" button is worse than no panel, so the last render is allowed to
 * be empty-handed.
 */
const props = defineProps<{ error?: ProviderError | null }>();
defineEmits<{ retry: [] }>();

const headline = computed(() => {
  switch (props.error?.kind) {
    case "disconnected": return "Not connected";
    case "auth-expired": return "Sign-in expired";
    case "permission-denied": return "Not permitted";
    case "rate-limited": return "Too many requests";
    case "offline": return "Offline";
    case "not-found": return "Not found";
    default: return "Something went wrong";
  }
});

/** Only a rate limit gives us something concrete to say about waiting. */
const detail = computed(() => {
  const error = props.error;
  if (!error) return "no error was reported";
  if (error.kind === "rate-limited" && error.retryAfterMs) {
    return `Try again in ${Math.ceil(error.retryAfterMs / 1000)}s.`;
  }
  // A blank message is the unhelpful case this panel kept producing: the
  // headline is generic by design, so with nothing underneath it said only
  // "something failed". The kind is always present and always says more.
  return error.message?.trim() || `(${error.kind}, no message)`;
});
</script>

<template>
  <div class="error" role="alert">
    <p class="headline">{{ headline }}</p>
    <p class="detail">{{ detail }}</p>
    <button type="button" class="retry" @click="$emit('retry')">Retry</button>
  </div>
</template>

<style scoped>
.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  text-align: center;
}

.headline {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.detail {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.6);
  overflow-wrap: anywhere;
}

.retry {
  margin-top: 4px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.08);
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 6px;
  cursor: pointer;
}

.retry:hover { background: rgba(var(--fg-rgb), 0.14); }
</style>
