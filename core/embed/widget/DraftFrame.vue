<script setup lang="ts">
import { computed } from "vue";
import RUNTIME_SOURCE from "../../../sdk/runtime/kavibay-runtime.js?raw";
import { buildPreviewDocument } from "./wizardPreviewDocument";
import { demoDraftFiles } from "./wizardFixture";

/**
 * A generated package, running in a card on the desk.
 *
 * The same document `EmbedWizardPreview` builds — the draft's own files plus
 * the real runtime SDK, in a `sandbox="allow-scripts"` frame with no
 * `allow-same-origin` — but mounted as a widget rather than inside the
 * Wizard's preview pane. That is the difference between "look what it made"
 * and "here it is, on your desk", and it is the last step of the tour.
 *
 * The isolation is not decoration: this is code a model wrote. It sits in an
 * opaque origin and can reach nothing on this page, which is the same rule the
 * app applies to every package it did not compile itself.
 */
const props = defineProps<{
  /** Draft id, as the Wizard wrote it in this tab. */
  draft: string;
  title: string;
}>();

const srcdoc = computed(() => buildPreviewDocument(demoDraftFiles(props.draft), RUNTIME_SOURCE));
</script>

<template>
  <iframe
    v-if="srcdoc"
    class="draft-frame"
    sandbox="allow-scripts"
    :srcdoc="srcdoc"
    :title="title"
  ></iframe>

  <!--
    A card for a package this tab never built. Not an error: the tour opens
    this card only after the Wizard has run, and a visitor who opens it early
    should be told, not shown an empty rectangle.
  -->
  <p v-else class="draft-frame__empty">Build this widget in the Wizard first.</p>
</template>

<style scoped>
.draft-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  /* Same reason as `EmbedWizardPreview.vue`: an inherited `color-scheme` makes
     Chrome paint an opaque light base behind a transparent frame. */
  color-scheme: normal;
}

.draft-frame__empty {
  margin: 0;
  align-self: center;
  text-align: center;
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.55);
}
</style>
