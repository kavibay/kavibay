<script setup lang="ts">
/**
 * Crisp SVG face for a launcher virtual-key id (24×24 viewBox, currentColor).
 */
defineProps<{
  keyId: string;
}>();
</script>

<template>
  <svg
    class="key-icon"
    viewBox="0 0 24 24"
    width="100%"
    height="100%"
    aria-hidden="true"
    fill="currentColor"
  >
    <!-- Play / Pause -->
    <template v-if="keyId === 'media_play_pause'">
      <path d="M4 4.5v15l9.5-7.5L4 4.5z" />
      <rect x="15.5" y="5" width="2.2" height="14" rx="0.6" />
      <rect x="19.3" y="5" width="2.2" height="14" rx="0.6" />
    </template>

    <!-- Next -->
    <template v-else-if="keyId === 'media_next'">
      <path d="M4 5.2v13.6l9.2-6.8L4 5.2z" />
      <rect x="15.8" y="5" width="2.6" height="14" rx="0.7" />
    </template>

    <!-- Previous -->
    <template v-else-if="keyId === 'media_prev'">
      <rect x="5.6" y="5" width="2.6" height="14" rx="0.7" />
      <path d="M20 5.2v13.6L10.8 12 20 5.2z" />
    </template>

    <!-- Stop -->
    <template v-else-if="keyId === 'media_stop'">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </template>

    <!-- Mute -->
    <template v-else-if="keyId === 'vol_mute'">
      <path
        d="M4.5 9.2h3.1L12 5.4v13.2l-4.4-3.8H4.5c-.8 0-1.5-.7-1.5-1.5v-2.6c0-.8.7-1.5 1.5-1.5z"
      />
      <path
        d="M15.2 9.1l5.7 5.7M20.9 9.1l-5.7 5.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </template>

    <!-- Volume Up -->
    <template v-else-if="keyId === 'vol_up'">
      <path
        d="M3.8 9.2h3.1L11.2 5.5v13l-4.3-3.7H3.8c-.8 0-1.5-.7-1.5-1.5v-2.6c0-.8.7-1.5 1.5-1.5z"
      />
      <path
        d="M15.2 9.2c1.4 1.1 1.4 4.5 0 5.6M17.8 7c2.5 2.1 2.5 7.9 0 10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </template>

    <!-- Volume Down -->
    <template v-else-if="keyId === 'vol_down'">
      <path
        d="M4.2 9.2h3.1L11.6 5.5v13l-4.3-3.7H4.2c-.8 0-1.5-.7-1.5-1.5v-2.6c0-.8.7-1.5 1.5-1.5z"
      />
      <path
        d="M15.4 9.4c1.3 1 1.3 4.2 0 5.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </template>

    <!-- Browser Back -->
    <template v-else-if="keyId === 'browser_back'">
      <path
        d="M13.8 5.5L7 12l6.8 6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8.2 12h10.3"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Browser Forward -->
    <template v-else-if="keyId === 'browser_forward'">
      <path
        d="M10.2 5.5L17 12l-6.8 6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M5.5 12h10.3"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Refresh -->
    <template v-else-if="keyId === 'browser_refresh'">
      <path
        d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path d="M20 3.8v5.6h-5.6z" />
    </template>

    <!-- Home -->
    <template v-else-if="keyId === 'browser_home'">
      <path
        d="M12 3.8L3.5 11h2.2v8.7c0 .7.6 1.3 1.3 1.3H9.8v-5.2h4.4v5.2h2.8c.7 0 1.3-.6 1.3-1.3V11h2.2L12 3.8z"
      />
    </template>

    <!-- Search -->
    <template v-else-if="keyId === 'browser_search'">
      <circle
        cx="10.5"
        cy="10.5"
        r="5.8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.1"
      />
      <path
        d="M15.2 15.2L20.2 20.2"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </template>

    <!-- Mail -->
    <template v-else-if="keyId === 'launch_mail'">
      <rect
        x="3"
        y="5.5"
        width="18"
        height="13"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
      />
      <path
        d="M4.2 7.2L12 13.2l7.8-6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>

    <!-- Media player -->
    <template v-else-if="keyId === 'launch_media'">
      <circle
        cx="12"
        cy="12"
        r="8.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
      />
      <path d="M10 8.8v6.4l5.6-3.2L10 8.8z" />
    </template>

    <!-- Print Screen -->
    <template v-else-if="keyId === 'print_screen'">
      <rect
        x="3.5"
        y="6"
        width="17"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect x="15.8" y="8" width="2.4" height="1.6" rx="0.4" />
    </template>

    <!-- Escape -->
    <template v-else-if="keyId === 'escape'">
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
      />
      <path
        d="M8.2 9.2l7.6 7.6M15.8 9.2l-7.6 7.6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </template>

    <!-- Fallback -->
    <template v-else>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path d="M9.5 10.5h5v5h-5z" />
    </template>
  </svg>
</template>

<style scoped>
.key-icon {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
