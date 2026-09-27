<script setup lang="ts">
/**
 * Runs one contract widget inside a sandboxed iframe.
 *
 * This is the boundary `bridge.ts` says it was built for. Nothing above the
 * transport changed to get here: `BridgeConnection` already spoke strings, so
 * the widget on the far side gets the same `WidgetContext` it gets in-process
 * and cannot tell which side it is on.
 *
 * Isolation notes, the same ones RuntimeExtensionFrame.vue records because they
 * were learned the same way:
 * - sandbox="allow-scripts" only, never widened with allow-same-origin. The
 *   guest document is served from this app's own origin, so without the opaque
 *   origin the sandbox grants it would be reading the cockpit's localStorage
 *   and calling tauri's invoke directly.
 * - Messages are accepted only from this iframe's contentWindow. `event.origin`
 *   is "null" for an opaque origin and so says nothing about who sent it;
 *   identity here is the window reference, not a string in the message.
 * - Which instance this frame is comes from props — the host's own record —
 *   and is never read back out of a payload. Finding 16.
 * - CI: scripts/extensionHostSandboxGuard.assert.mjs greps this file for all of
 *   the above.
 */
import { forwardFrameZoom } from "../../host/contentZoom";
import "../../runtime/frameViewport.css";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { ProviderError, QueryState, WidgetInstance } from "@sdk/contract/sdk";
import type { JsonBridge } from "../bridge";
import {
  SandboxHostPort, initMessage, isMounted, isReady, readFailure, readFault, themeMessage,
} from "../sandboxTransport";
import { readTheme } from "../sandboxTheme";
import { resolveBodyError, resolveBodyPhase } from "../widgetPhase";
import WidgetSkeleton from "./WidgetSkeleton.vue";
import WidgetError from "./WidgetError.vue";

import { reportContentOverflow } from "../../host/contentOverflow";

const props = defineProps<{
  bridge: JsonBridge;
  instance: WidgetInstance<any>;
  /**
   * The guest document. A prop rather than a constant because the only thing
   * that changes when generated widgets arrive is where this points — the
   * package root instead of the app's own.
   */
  entryUrl: string;
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
let port: SandboxHostPort | undefined;

/**
 * The gate, for a widget that runs somewhere else.
 *
 * The rules are `widgetPhase.ts`'s, shared with the in-process runtime, and the
 * panels are the same components — so a sandboxed widget's skeleton and error
 * are not merely similar to an in-process one's, they are the same thing. Two
 * implementations of "what does loading look like" is the breakage the runtime
 * owns this to prevent.
 *
 * Query states come from the connection, not from the guest: they already cross
 * it, so there is nothing to ask for and nothing to believe.
 */
const mounting = ref(true);
const setupFailure = shallowRef<ProviderError | undefined>(undefined);
const queryStates = shallowRef<ReadonlyMap<string, QueryState<unknown>>>(new Map());

const bodyInput = computed(() => ({
  mounting: mounting.value,
  setupFailure: setupFailure.value,
  queryStates: [...queryStates.value.values()],
}));

const phase = computed(() => resolveBodyPhase(bodyInput.value));
const error = computed(() => resolveBodyError(bodyInput.value));

function postToGuest(message: unknown) {
  // "*" because an opaque origin cannot be named as a target. The reference to
  // contentWindow is what makes this reach one frame and no other.
  iframeRef.value?.contentWindow?.postMessage(message, "*");
}

/**
 * Reads the tokens as they are actually rendering, rather than from a table
 * somewhere. `appearanceLogic` writes straight onto documentElement, so the
 * computed value is the only place the truth is complete.
 */
function pushTheme() {
  const computed = getComputedStyle(document.documentElement);
  postToGuest(themeMessage(readTheme((token) => computed.getPropertyValue(token))));
}

function onMessage(event: MessageEvent) {
  const frameWin = iframeRef.value?.contentWindow;
  if (!frameWin || event.source !== frameWin) return;
  if (forwardFrameZoom(iframeRef.value, event)) return;

  /**
   * How much taller the package's content is than the box it was given.
   *
   * The twin of the same branch in `RuntimeExtensionFrame`: the guest measures
   * what it cannot see the frame for, and the difference is computed here where
   * both numbers exist. Only the wizard's preview acts on it.
   */
  const data = event.data as { type?: unknown; height?: unknown };
  if (data?.type === "kavibay.ext.content-size" && typeof data.height === "number") {
    reportContentOverflow(iframeRef.value, data.height);
    return;
  }

  if (isReady(event.data)) {
    // Theme first: init is what starts the widget, and arriving styled beats
    // arriving and then restyling in front of the user.
    pushTheme();
    /**
     * The declared providers travel with the instance, from the registry the
     * bridge already holds. The guest cannot read a manifest, so without this
     * `ctx.providers` is empty in every sandboxed package and every lookup
     * comes back undefined — the widget then fails on its first query with a
     * TypeError instead of anything that names a cause.
     *
     * Told, not trusted: the bridge re-checks each request against the same
     * declaration, so a frame that ignored this list gains nothing.
     */
    const declared =
      props.bridge.host.registry.widget(props.instance.definitionId)?.widget.requires?.providers ??
      [];
    postToGuest(initMessage(props.instance, declared));
    return;
  }
  if (isMounted(event.data)) {
    mounting.value = false;
    return;
  }
  const failure = readFailure(event.data);
  if (failure) {
    setupFailure.value = failure;
    mounting.value = false;
    return;
  }
  /**
   * A fault is passed on and nothing else. It does not end the mount and it
   * does not become an error panel: a widget that logs a failed refresh every
   * minute is still a working widget, and a `console.error` is not the guest
   * saying it gave up — `failedMessage` above is the one that means that.
   */
  const fault = readFault(event.data);
  if (fault) {
    props.bridge.onFault?.(props.instance.id, fault);
    return;
  }
  port?.accept(event.data);
}

/**
 * Colour mode is an attribute on `html`, and every Appearance control is an
 * inline custom property on the same element, so watching its attributes covers
 * both. The media query covers the system switching underneath a mode of
 * "auto", which changes no attribute here at all.
 */
let themeObserver: MutationObserver | undefined;
const systemScheme = typeof matchMedia === "function"
  ? matchMedia("(prefers-color-scheme: dark)")
  : undefined;

function open() {
  port?.dispose();
  mounting.value = true;
  setupFailure.value = undefined;
  queryStates.value = new Map();
  props.bridge.register(props.instance);
  port = new SandboxHostPort(
    postToGuest,
    (emit) => props.bridge.connect(props.instance.id, emit, (slot, state) => {
      // Copy-on-write: shallowRef notifies on assignment, not mutation.
      queryStates.value = new Map(queryStates.value).set(slot, state);
    }),
  );
}

/**
 * Tears the guest down and loads it again. The in-process runtime remounts the
 * component for this; here the document is the unit, so the frame reloads.
 */
function retry() {
  open();
  const frame = iframeRef.value;
  if (frame) frame.src = props.entryUrl;
}

// A configuration change remounts the widget in-process; here it reloads the
// frame, which is the same decision — `ctx.config` is read once by setup.
watch(
  () => JSON.stringify(props.instance.configuration ?? {}),
  (next, previous) => {
    if (next === previous) return;
    open();
    if (iframeRef.value) iframeRef.value.src = props.entryUrl;
  },
);

onMounted(() => {
  window.addEventListener("message", onMessage);
  open();

  themeObserver = new MutationObserver(pushTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-color-mode"],
  });
  systemScheme?.addEventListener("change", pushTheme);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  themeObserver?.disconnect();
  themeObserver = undefined;
  systemScheme?.removeEventListener("change", pushTheme);
  // Closing the port unsubscribes everything the frame opened. Since finding 15
  // a subscribed query schedules its own refresh, so skipping this would keep
  // calling the provider for a widget that is no longer on screen.
  port?.dispose();
  port = undefined;
  props.bridge.unregister(props.instance.id);
});
</script>

<template>
  <div class="sandboxed-widget">
    <WidgetSkeleton v-if="phase === 'loading'" />
    <WidgetError v-else-if="phase === 'error' && error" :error="error" @retry="retry" />

    <!--
      Hidden rather than unmounted while the gate covers it. The guest is the
      thing doing the loading, so removing the element to show a skeleton would
      destroy the document whose progress the skeleton is reporting — and on
      retry it would restart forever. `display: none` keeps it running.
    -->
    <div class="widget-frame-viewport" :class="{ 'is-hidden': phase !== 'ready' }">
      <iframe
        ref="iframeRef"
        class="sandboxed-widget-frame"
        :src="entryUrl"
        :title="`Widget ${instance.definitionId}`"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
      />
    </div>
  </div>
</template>

<style scoped>
.sandboxed-widget {
  width: 100%;
  height: 100%;
}

.widget-frame-viewport.is-hidden {
  display: none;
}
</style>
