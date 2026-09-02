<script setup lang="ts">
import type { WeatherIconKey } from "../weatherLogic";

defineProps<{ icon: WeatherIconKey }>();
</script>

<template>
  <svg class="weather-icon" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
    <g v-if="icon === 'clear'">
      <circle cx="32" cy="32" r="12" fill="#F5C542" />
      <g stroke="#F5C542" stroke-width="3" stroke-linecap="round">
        <line x1="32" y1="6" x2="32" y2="14" />
        <line x1="32" y1="50" x2="32" y2="58" />
        <line x1="6" y1="32" x2="14" y2="32" />
        <line x1="50" y1="32" x2="58" y2="32" />
        <line x1="12" y1="12" x2="18" y2="18" />
        <line x1="46" y1="46" x2="52" y2="52" />
        <line x1="12" y1="52" x2="18" y2="46" />
        <line x1="46" y1="18" x2="52" y2="12" />
      </g>
    </g>

    <g v-else-if="icon === 'partly-cloudy'">
      <circle cx="22" cy="22" r="9" fill="#F5C542" />
      <path
        d="M20 44h26a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 20 44z"
        fill="#E8EEF7"
      />
    </g>

    <g v-else-if="icon === 'cloudy'">
      <path
        d="M18 46h30a11 11 0 0 0 0-22 13 13 0 0 0-25-4A10 10 0 0 0 18 46z"
        fill="#C5D0E0"
      />
    </g>

    <g v-else-if="icon === 'fog'">
      <path
        d="M18 30h30a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 30z"
        fill="#B8C4D4"
        opacity="0.85"
      />
      <g stroke="#D0D8E4" stroke-width="3" stroke-linecap="round">
        <line x1="14" y1="40" x2="50" y2="40" />
        <line x1="18" y1="48" x2="46" y2="48" />
        <line x1="16" y1="56" x2="48" y2="56" />
      </g>
    </g>

    <g v-else-if="icon === 'drizzle'">
      <path
        d="M18 34h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 34z"
        fill="#C5D0E0"
      />
      <g stroke="#6EB6E0" stroke-width="2.5" stroke-linecap="round">
        <line x1="24" y1="42" x2="22" y2="52" />
        <line x1="34" y1="42" x2="32" y2="52" />
        <line x1="44" y1="42" x2="42" y2="52" />
      </g>
    </g>

    <g v-else-if="icon === 'rain'">
      <path
        d="M18 32h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 32z"
        fill="#9AA8BC"
      />
      <g stroke="#4A9FE0" stroke-width="3" stroke-linecap="round">
        <line x1="22" y1="40" x2="18" y2="54" />
        <line x1="32" y1="40" x2="28" y2="54" />
        <line x1="42" y1="40" x2="38" y2="54" />
      </g>
    </g>

    <g v-else-if="icon === 'snow'">
      <path
        d="M18 32h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 18 32z"
        fill="#D8E2F0"
      />
      <g fill="#A8D4F0">
        <circle cx="24" cy="46" r="2.5" />
        <circle cx="34" cy="50" r="2.5" />
        <circle cx="44" cy="46" r="2.5" />
        <circle cx="28" cy="56" r="2" />
        <circle cx="40" cy="56" r="2" />
      </g>
    </g>

    <g v-else>
      <path
        d="M16 30h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 16 30z"
        fill="#6B7A90"
      />
      <polygon points="30,34 22,48 29,48 26,58 40,42 32,42 36,34" fill="#F5C542" />
    </g>
  </svg>
</template>

<style scoped>
.weather-icon {
  display: block;
  flex-shrink: 0;
}
</style>
