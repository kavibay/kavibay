<script setup lang="ts">
/**
 * A contract widget package, on the desk or in the palette's panel.
 *
 * The whole of it is one translation: the cockpit places a package by its
 * directory id, and the extension host mounts a *definition*. Nothing else here
 * is new — `CockpitWidget` and `WidgetGate` do exactly what they do for a
 * bundled widget, and `SandboxedWidgetFrame` is the same frame the dev board has
 * been running against since the boundary was built.
 *
 * The frame is chosen by format, one branch up. That is the fix: every package
 * used to be embedded with `RuntimeExtensionFrame`, whose `isExtToHost` requires
 * a `type` in the `kavibay.ext.*` vocabulary. A contract guest posts
 * `{ kind: "kavibay.widget.ready" }` — no `type` at all — so the message was
 * dropped in silence, no `init` was ever sent, `setup` never ran, and the card
 * was a black rectangle with nothing anywhere saying why.
 */
import { computed } from "vue";
import { packageDefinitionId, packageMountKey, packageRefusal, widgetBridge } from "../cockpit";
import CockpitWidget from "./CockpitWidget.vue";

const props = defineProps<{
  /** The package's directory id, which is what a placed card stores. */
  packageId: string;
  /** `kavibay-ext://<id>/index.html` — the package's own document. */
  entryUrl: string;
}>();

const definitionId = computed(() => packageDefinitionId(props.packageId));

/** Changes only when the widget has to start over — see the template. */
const mountKey = computed(() => packageMountKey(props.packageId));

/**
 * Why there is no widget, when there is no widget.
 *
 * Shown rather than logged. An approved package that renders nothing and an
 * unapproved one look identical on a desk, and telling them apart from a card
 * is the difference between "click enable again" and "this is a bug".
 */
const refusal = computed(() => packageRefusal(props.packageId));

const sandbox = computed(() => ({ bridge: widgetBridge, entryUrl: props.entryUrl }));
</script>

<template>
  <!--
    Keyed on more than the definition id. A re-approval leaves that string
    unchanged, and `setup` has already run in the guest's document with the
    permissions it had then — so without a key that moves, granting a widget one
    more query would change nothing a user can see.
  -->
  <CockpitWidget
    v-if="definitionId"
    :key="mountKey"
    :definition-id="definitionId"
    :sandbox="sandbox"
  />

  <div v-else class="unloaded" role="alert">
    <p class="headline">Widget unavailable</p>
    <code class="id">{{ packageId }}</code>
    <p class="hint">{{ refusal ?? "It is not loaded." }}</p>
  </div>
</template>

<style scoped>
.unloaded {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  text-align: center;
  border: 1px dashed rgba(var(--fg-rgb), 0.25);
  border-radius: 8px;
}

.headline {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.id {
  font-size: 11px;
  overflow-wrap: anywhere;
  color: rgba(var(--fg-rgb), 0.7);
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}
</style>
