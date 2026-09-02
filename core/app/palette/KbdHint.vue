<script setup lang="ts">
/**
 * Keyboard hint for palette rows: one cap per physical key.
 *
 * A chord used to render as a single cap reading "Ctrl+R", which is a keycap
 * shape wrapped around something that is not a key. Two caps say the same thing
 * and let every cap share one padding rule.
 *
 * Glyph keys are drawn, not typed: ↵ and ⇥ come out at different sizes and
 * baselines depending on which font ends up resolving them, which is what made
 * the Enter cap look off next to a lettered one.
 */
defineProps<{
  /** Key names in press order; "enter" and "tab" render as glyphs. */
  keys: readonly string[];
}>();

const GLYPH_LABELS: Record<string, string> = {
  enter: "Enter",
  tab: "Tab",
};
</script>

<template>
  <span class="kbd-hint">
    <kbd
      v-for="(key, index) in keys"
      :key="`${key}-${index}`"
      class="kbd-key"
      :class="{ 'kbd-key--glyph': key === 'enter' || key === 'tab' }"
      :aria-label="GLYPH_LABELS[key]"
    >
      <svg v-if="key === 'enter'" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path
          d="M12 4V9H4M7 6L4 9L7 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else-if="key === 'tab'" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path
          d="M3 8h7M8 5l3 3-3 3M13 4v8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <template v-else>{{ key }}</template>
    </kbd>
  </span>
</template>

<style scoped>
.kbd-hint {
  display: inline-flex;
  align-items: center;
  /* Tight enough that a chord reads as one unit, not as two hints. */
  gap: 3px;
}

/*
 * One padding rule for every cap. `min-width` is only a floor for the narrowest
 * glyph — the 5px inset is what actually sets the width, so a lettered cap and
 * a "Ctrl" cap carry identical breathing room.
 */
.kbd-key {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid rgba(var(--fg-rgb), 0.28);
  border-radius: 6px;
  corner-shape: squircle;
  background: rgba(var(--fg-rgb), 0.08);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: rgba(var(--fg-rgb), 0.88);
}

/* Drawn glyphs carry their own optical padding; the letter inset would double it. */
.kbd-key--glyph {
  padding: 0 3px;
}
</style>
