<script setup lang="ts">
import { computed } from "vue";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import type { LlmWebCitation } from "../extension-host/widgetCapabilityTransport";

const props = defineProps<{ text: string; citations?: LlmWebCitation[] }>();
const parts = computed(() => {
  const result: ({ text: string; bold: boolean; url?: string } | { citation: LlmWebCitation })[] = [];
  const sources = [...(props.citations ?? [])].sort((a, b) => a.endIndex - b.endIndex);
  const offsets = [0];
  if (sources.length) {
    for (const character of props.text) offsets.push(offsets[offsets.length - 1] + character.length);
  }
  let sourceIndex = 0;
  function append(start: number, end: number, bold: boolean, rawEnd = end) {
    let cursor = start;
    while (sourceIndex < sources.length) {
      const source = sources[sourceIndex];
      const position = offsets[source.endIndex];
      if (position === undefined || position > rawEnd) break;
      const split = Math.max(cursor, Math.min(position, end));
      if (split > cursor) result.push({ text: props.text.slice(cursor, split), bold });
      result.push({ citation: source });
      sourceIndex++;
      cursor = split;
    }
    if (cursor < end) result.push({ text: props.text.slice(cursor, end), bold });
  }

  function format(start: number, end: number, bold: boolean, rawEnd = end) {
    let offset = start;
    // Skip escapes and code spans. Leave unfinished links visible while streaming.
    const pattern = /\\[\s\S]|(`+)[\s\S]*?\1|\[([^\][\r\n]+)\]\((<https:\/\/[^<>\s]+>|https:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)\)|\*\*(?=\S)([\s\S]*?\S)\*\*/gi;
    for (const match of props.text.slice(start, end).matchAll(pattern)) {
      const from = start + match.index;
      const to = from + match[0].length;
      if (match[3]) {
        const href = match[3].startsWith("<") ? match[3].slice(1, -1) : match[3];
        const url = URL.parse(href);
        if (!url || url.protocol !== "https:" || url.username || url.password) continue;
        append(offset, from, bold);
        result.push({ text: match[2], bold, url: url.href });
        append(to, to, bold);
      } else if (!bold && match[4] !== undefined) {
        append(offset, from, false);
        format(from + 2, to - 2, true, to);
      } else {
        continue;
      }
      offset = to;
    }
    append(offset, end, bold, rawEnd);
  }

  format(0, props.text.length, false);
  return result;
});

function openLink(url: string) {
  void tauriWidgetCapabilityTransport.openExternal(url).catch((error) => console.error("[kavibay] open answer link:", error));
}
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <a
      v-if="'citation' in part"
      class="palette-answer-citation"
      :href="part.citation.url"
      :title="part.citation.title || part.citation.url"
      target="_blank"
      rel="noopener noreferrer"
      @click.prevent="openLink(part.citation.url)"
      @auxclick.middle.prevent="openLink(part.citation.url)"
    >{{ part.citation.title || part.citation.url }}</a><a
      v-else-if="part.url"
      class="palette-answer-link"
      :href="part.url"
      target="_blank"
      rel="noopener noreferrer"
      @click.prevent="openLink(part.url)"
      @auxclick.middle.prevent="openLink(part.url)"
    ><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></a><strong v-else-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template>
  </template>
</template>

<style scoped>
strong { font-weight: 700; }
.palette-answer-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.palette-answer-citation {
  display: inline-block;
  vertical-align: middle;
  max-width: min(180px, 100%);
  margin-inline: 4px;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.09);
  color: inherit;
  font-size: 11px;
  line-height: 1.4;
}
</style>
