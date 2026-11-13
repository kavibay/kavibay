<script setup lang="ts">
/**
 * The connections of one provider row, in Settings → AI and on setup page 2.
 *
 * A row is usually one provider and one connection form. The OpenAI row also
 * holds ChatGPT sign-in, which the catalog keeps as a provider of its own
 * (one provider, one credential type): its form comes first, under the row's
 * sign-in heading, and the API key waits behind "Use an API key instead" — open
 * from the start when a key is already saved, so nobody hunts for their own
 * connection. Which providers a row shows is the row's data (`alsoProviders`),
 * not a switch on ids here.
 */
import { computed, ref } from "vue";
import { t } from "../../i18n/i18n";
import CredentialAccounts from "../credentials/CredentialAccounts.vue";
import type { CredentialSummary, CredentialTypeSchema } from "../credentials/credentialsApi";
import type { LlmModelOption, LlmProviderId } from "./aiApi";
import {
  credentialTypeForProvider,
  providerHasKey,
  tabProviders,
  type AiProviderTab,
} from "./aiPanelLogic";

const props = defineProps<{
  tab: AiProviderTab;
  models: LlmModelOption[];
  types: CredentialTypeSchema[];
  credentials: CredentialSummary[];
}>();
const emit = defineEmits<{ changed: [] }>();

function typeOf(provider: LlmProviderId): CredentialTypeSchema | null {
  const typeId = credentialTypeForProvider(props.models, provider);
  return props.types.find((type) => type.id === typeId) ?? null;
}

const first = computed(() => tabProviders(props.tab)[0]);
const rest = computed(() => tabProviders(props.tab).slice(1));
const restOpen = ref(rest.value.some((provider) => providerHasKey(props.models, provider)));
</script>

<template>
  <div class="connections">
    <template v-if="tab.signIn">
      <p class="connections-title">{{ t(tab.signIn.title) }}</p>
      <p class="connections-hint">{{ t(tab.signIn.hint) }}</p>
    </template>
    <CredentialAccounts
      v-if="typeOf(first)"
      :key="typeOf(first)!.id"
      :type="typeOf(first)!"
      :credentials="credentials"
      @changed="emit('changed')"
    />

    <template v-if="rest.length">
      <button
        v-if="!restOpen"
        type="button"
        class="connections-more"
        @click="restOpen = true"
      >
        {{ t("ai.connect.useApiKey") }}
      </button>
      <template v-else>
        <template v-for="provider in rest" :key="provider">
          <p class="connections-title connections-title--rest">{{ t("ai.connect.useApiKey") }}</p>
          <CredentialAccounts
            v-if="typeOf(provider)"
            :type="typeOf(provider)!"
            :credentials="credentials"
            @changed="emit('changed')"
          />
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.connections {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connections-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.connections-title--rest {
  margin-top: 10px;
}

.connections-hint {
  margin: -4px 0 2px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.6);
}

.connections-more {
  align-self: flex-start;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.75);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.connections-more:hover,
.connections-more:focus-visible {
  color: rgba(var(--fg-rgb), 0.95);
  outline: none;
}
</style>
