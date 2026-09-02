<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * The brand logo for a provider, wherever a provider is named to the user.
 *
 * Renders *nothing* when we ship no mark for it. That is the whole point of
 * routing every call site through one component: the connect prompt, the
 * credential card and the consent dialog must all agree on the same mark or
 * fallback. A generic placeholder would be worse than nothing; it reads as a
 * failed image load.
 *
 * The lookup lives in `brandMarks.ts` (and is asserted there); this file is
 * only the picture.
 */
import { computed } from "vue";
import { brandMarkFor } from "./brandMarks";
import AnthropicMark from "./AnthropicMark.vue";
import CloudflareMark from "./CloudflareMark.vue";
import GitHubMark from "./GitHubMark.vue";
import GoogleMark from "./GoogleMark.vue";
import LinearMark from "./LinearMark.vue";
import TrelloMark from "./TrelloMark.vue";
import N8nMark from "./N8nMark.vue";
import SpotifyMark from "./SpotifyMark.vue";
import FitbitMark from "./FitbitMark.vue";
import NotionMark from "./NotionMark.vue";
import OpenAiMark from "./OpenAiMark.vue";
import OpenMeteoMark from "./OpenMeteoMark.vue";
import TadoMark from "./TadoMark.vue";

const props = withDefaults(
  defineProps<{
    /**
     * A `ProviderId` (`kavibay.tado/tado`) or a credential type id
     * (`tadoOAuth2`) — both name the same account to the user.
     */
    provider?: string | null;
    /** Rendered box in px, like the Lucide icons in `@sdk/icons`. */
    size?: number | string;
  }>(),
  { provider: null, size: 20 },
);

const mark = computed(() => {
  switch (brandMarkFor(props.provider)) {
    case "tado":
      return TadoMark;
    case "github":
      return GitHubMark;
    case "linear":
      return LinearMark;
    case "trello":
      return TrelloMark;
    case "n8n":
      return N8nMark;
    case "spotify":
      return SpotifyMark;
    case "fitbit":
      return FitbitMark;
    case "notion":
      return NotionMark;
    case "google":
      return GoogleMark;
    case "open-meteo":
      return OpenMeteoMark;
    case "anthropic":
      return AnthropicMark;
    case "openai":
      return OpenAiMark;
    case "cloudflare":
      return CloudflareMark;
    default:
      return undefined;
  }
});
</script>

<template>
  <component :is="mark" v-if="mark" class="brand-mark" :size="size" />
</template>

<style scoped>
.brand-mark {
  flex: none;
  display: block;
}
</style>
