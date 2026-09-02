<script setup lang="ts">
import { computed } from "vue";
import type { ProviderId, ProviderStatus } from "@sdk/contract/sdk";
import { BrandMark } from "@sdk/brand";

/**
 * Gate state `provider`. The connect screen belongs to the runtime, not to the
 * widget: the gate a user meets is *connect*, not install, and two widgets on
 * the same provider must not disagree about how to ask for it.
 *
 * Copy comes from `ProviderStatus`, which is why the contract models it as a
 * discriminated union rather than a boolean — "connecting" and "auth-expired"
 * need different words and different affordances from "disconnected".
 */
const props = defineProps<{
  provider: ProviderId;
  status: ProviderStatus;
  /** Display name from the manifest; the provider id is a fallback. */
  displayName?: string;
}>();

defineEmits<{ connect: [] }>();

const name = computed(() => props.displayName ?? props.provider.split("/").pop() ?? props.provider);

const copy = computed(() => {
  switch (props.status.state) {
    case "connecting":
      return { line: `Connecting to ${name.value}…`, action: undefined };
    case "auth-expired":
      return { line: `Your ${name.value} sign-in expired.`, action: "Sign in again" };
    case "not-installed":
      return { line: `${name.value} is not installed.`, action: undefined };
    case "error":
      return { line: props.status.message, action: "Try again" };
    default:
      return { line: `Connect ${name.value} to use this widget.`, action: `Connect ${name.value}` };
  }
});
</script>

<template>
  <div class="connect">
    <!-- Renders only for the providers we ship a logo for; see BrandMark. -->
    <BrandMark :provider="provider" :size="28" />
    <p class="line">{{ copy.line }}</p>
    <button v-if="copy.action" type="button" class="action" @click="$emit('connect')">
      {{ copy.action }}
    </button>
  </div>
</template>

<style scoped>
.connect {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  text-align: center;
}

.line {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.75);
}

.action {
  padding: 6px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
  cursor: pointer;
}

.action:hover { background: rgba(var(--fg-rgb), 0.16); }
</style>
