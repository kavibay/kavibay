<script setup lang="ts">
/**
 * Sandboxed iframe host for a runtime extension UI entry.
 * Storage/commands go through postMessage; never trust payload extId.
 *
 * Isolation notes (Windows):
 * - Custom protocol URLs become http://kavibay-ext.localhost/<extId>/… so all
 *   packages share one origin. Per-extension isolation must NOT rely on unique
 *   protocol origins.
 * - sandbox="allow-scripts" only (never widen with a same-origin flag): each
 *   iframe gets an opaque unique origin, so packages cannot read each other's
 *   DOM/storage even under the shared kavibay-ext.localhost URL. Host-mediated
 *   KV via this bridge remains the only storage path; payload extId is ignored
 *   in favor of props.
 * - CI: scripts/runtimeSandboxGuard.assert.mjs greps this file for the
 *   forbidden same-origin sandbox token and requires the static attribute.
 */
import { forwardFrameZoom } from "../host/contentZoom";
import "./frameViewport.css";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { packageFrameUrl } from "./packageFrameUrl";
import { invoke } from "@tauri-apps/api/core";
import {
  faultSourceOf,
  handleBridgeMessage,
  httpFailure,
  isExtToHost,
  NETWORK_DECLARED_PERM,
  type HostToExt,
  type HttpCallResult,
} from "./bridgeProtocol";
import { reportWidgetFault } from "../extension-host/cockpit";
import { reportContentOverflow } from "../host/contentOverflow";

const props = defineProps<{
  extId: string;
  instanceId: string;
  /** Host-owned stable namespace when draft and published code share a preview. */
  storageExtId?: string;
  entryUrl: string;
  grantedPermissions: string[];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const runId = ref(crypto.randomUUID());
const frameUrl = computed(() => packageFrameUrl(props.entryUrl, runId.value));
watch(() => props.entryUrl, () => { runId.value = crypto.randomUUID(); });

/** Post a host→ext reply into the iframe (only if still mounted). */
function postToExt(msg: HostToExt) {
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  win.postMessage(msg, "*");
}

/**
 * Run a declared endpoint call in the backend and post the result back.
 *
 * `extId` comes from this component's props — the host's frame map — never from
 * the message, so a package cannot name another package's endpoints. The
 * backend re-checks the grant against its own store regardless; this early exit
 * only saves a round trip and gives the same code either way.
 */
async function runHttpCall(requestId: string, endpointId: string, args: unknown) {
  const requestedRun = runId.value;
  if (!props.grantedPermissions.includes(NETWORK_DECLARED_PERM)) {
    postToExt(httpFailure(requestId, "permission_denied"));
    return;
  }
  try {
    const result = await invoke<HttpCallResult>("runtime_extensions_http_call", {
      extId: props.extId,
      instanceId: props.instanceId,
      endpointId,
      args: args ?? null,
    });
    // Request ids restart in a new document. A late answer belongs to the old run.
    if (runId.value === requestedRun) postToExt({ type: "kavibay.ext.http.result", requestId, result });
  } catch {
    // An invoke that throws is a host-side fault, not a provider answer.
    if (runId.value === requestedRun) postToExt(httpFailure(requestId, "network_error"));
  }
}

/**
 * Accept messages only from this iframe's contentWindow.
 * Always bind storage/http to props.extId / props.instanceId (ignore payload ids).
 */
function onMessage(event: MessageEvent) {
  const frameWin = iframeRef.value?.contentWindow;
  if (!frameWin || event.source !== frameWin) return;
  if (forwardFrameZoom(iframeRef.value, event)) return;
  if (!isExtToHost(event.data)) return;

  const message = event.data;
  if (message.type === "kavibay.ext.http.call") {
    void runHttpCall(message.requestId, message.endpointId, message.args);
    return;
  }

  /**
   * A fault gets no reply and changes nothing here; it goes straight to the
   * log the Wizard's debug panel reads.
   *
   * Reported against `props.instanceId` — the host's own frame identity — for
   * the same reason storage and http are: the payload's word about which
   * widget it is would let one package file entries under another's name.
   */
  /**
   * How much taller the content is than the box it was given.
   *
   * Computed here rather than in the guest: the guest can measure its own
   * content and cannot see the frame element, and reporting the difference is
   * what lets the card grow by exactly what does not fit — no card padding,
   * title bar or border modelled anywhere.
   *
   * Reported for this frame, never for whichever id the payload claims, for the
   * same reason faults are.
   */
  if (message.type === "kavibay.ext.content-size") {
    reportContentOverflow(iframeRef.value, message.height);
    return;
  }

  if (message.type === "kavibay.ext.fault") {
    reportWidgetFault(props.instanceId, {
      source: faultSourceOf(message.source),
      message: message.message,
      where: message.where,
      stack: message.stack,
    });
    return;
  }

  const reply = handleBridgeMessage(message, {
    extId: props.extId,
    instanceId: props.instanceId,
    storageExtId: props.storageExtId,
    grantedPermissions: props.grantedPermissions,
  });
  if (reply) postToExt(reply);
}

onMounted(() => {
  window.addEventListener("message", onMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
});
</script>

<template>
  <div class="widget-frame-viewport">
    <iframe
      ref="iframeRef"
      class="runtime-ext-frame"
      :src="frameUrl"
      :title="`Runtime extension ${extId}`"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
    />
  </div>
</template>
