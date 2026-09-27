<script setup lang="ts">
import { LayoutGridIcon } from "@sdk/icons";
import type { PaletteTypeCatalogEntry } from "./paletteResults";

withDefaults(defineProps<{ widget: PaletteTypeCatalogEntry; size?: number; animated?: boolean }>(), {
  size: 16,
  animated: false,
});
</script>

<template>
  <span class="widget-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <component v-if="widget.iconComponent" :is="widget.iconComponent" :size="size" :animated="animated" />
    <span v-else-if="widget.iconUrl" class="widget-icon-mask" :style="{ '--widget-icon': `url(${JSON.stringify(widget.iconUrl)})` }" />
    <LayoutGridIcon v-else :size="size" :animated="animated" />
  </span>
</template>

<style scoped>
.widget-icon { display: grid; place-items: center; flex-shrink: 0; }
.widget-icon-mask { width: 100%; height: 100%; background: currentColor; mask: var(--widget-icon) center / contain no-repeat; }
</style>
