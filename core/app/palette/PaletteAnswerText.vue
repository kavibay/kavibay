<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ text: string }>();
const parts = computed(() => {
  const result: { text: string; bold: boolean }[] = [];
  let offset = 0;
  // Skip escaped characters and code spans; incomplete streamed markers stay literal.
  const pattern = /\\[\s\S]|(`+)[\s\S]*?\1|\*\*(?=\S)([\s\S]*?\S)\*\*/g;
  for (const match of props.text.matchAll(pattern)) {
    if (match[2] === undefined) continue;
    result.push({ text: props.text.slice(offset, match.index), bold: false });
    result.push({ text: match[2], bold: true });
    offset = match.index + match[0].length;
  }
  result.push({ text: props.text.slice(offset), bold: false });
  return result;
});
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template>
  </template>
</template>

<style scoped>
strong { font-weight: 700; }
</style>
