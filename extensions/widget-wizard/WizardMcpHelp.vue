<script setup lang="ts">
import DialogCloseButton from "@sdk/ui/DialogCloseButton.vue";
import { computed, onUnmounted, ref, useId } from "vue";
import { holdHostDismiss } from "@sdk/hostDismiss";
import { PlugIcon } from "@sdk/icons";
import {
  getMcpServerStatus,
  retryMcpServer,
  setMcpServerEnabled,
  type McpServerStatus,
} from "@sdk/mcp/mcpServerApi";
import {
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildMcpUrl,
  MCP_DEFAULT_PORT,
  MCP_STATUS_POLL_MS,
  MCP_TOKEN_ENV_VAR,
  MCP_TOKEN_PLACEHOLDER,
  mcpStatusPresentationFor,
} from "@sdk/mcp/mcpServerLogic";

const emit = defineEmits<{ openSettings: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
let releaseDismiss: (() => void) | undefined;
const status = ref<McpServerStatus | null>(null);
const requestError = ref<string | null>(null);
const pending = ref(false);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let requestVersion = 0;

const presentation = computed(() => status.value
  ? mcpStatusPresentationFor(status.value)
  : { label: requestError.value ? "Unavailable" : "Checking…", tone: "neutral" });
const serverUrl = computed(() => status.value?.url ?? buildMcpUrl(MCP_DEFAULT_PORT));
const tokenRequired = computed(() => status.value?.tokenRequired === true);
const busy = computed(() => pending.value || status.value?.state === "starting" || status.value?.state === "stopping");

/** Poll only while this dialog is open, without overlapping requests. */
function scheduleRefresh(): void {
  clearTimeout(pollTimer);
  if (dialog.value?.open) {
    pollTimer = setTimeout(() => void refreshStatus(), MCP_STATUS_POLL_MS);
  }
}

/** A response from before a toggle or close must not replace newer status. */
async function refreshStatus(): Promise<void> {
  if (pending.value) {
    scheduleRefresh();
    return;
  }
  const version = ++requestVersion;
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Server controls are available in the Kavibay desktop app.");
    }
    const next = await getMcpServerStatus();
    if (version !== requestVersion || !dialog.value?.open) return;
    status.value = next;
    requestError.value = null;
  } catch (error) {
    if (version !== requestVersion || !dialog.value?.open) return;
    status.value = null;
    requestError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (version === requestVersion) scheduleRefresh();
  }
}

/** Keep the switch authoritative: it changes only when the backend replies. */
async function runAction(operation: () => Promise<McpServerStatus>): Promise<void> {
  if (busy.value || !status.value) return;
  clearTimeout(pollTimer);
  const version = ++requestVersion;
  pending.value = true;
  requestError.value = null;
  try {
    const next = await operation();
    if (version === requestVersion && dialog.value?.open) status.value = next;
  } catch (error) {
    if (version === requestVersion && dialog.value?.open) {
      requestError.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    pending.value = false;
    scheduleRefresh();
  }
}

/** Persist the inverse of the backend's current preference. */
function toggleServer(): void {
  const enabled = !status.value?.desiredEnabled;
  void runAction(() => setMcpServerEnabled(enabled));
}

/** Keep the cockpit open while the native dialog owns focus and Escape. */
function show(): void {
  if (!dialog.value || dialog.value.open) return;
  dialog.value.showModal();
  releaseDismiss = holdHostDismiss("wizard-mcp-help");
  status.value = null;
  requestError.value = null;
  void refreshStatus();
}

/** Release the host gesture hold on every close path, including disposal. */
function release(): void {
  clearTimeout(pollTimer);
  requestVersion += 1;
  releaseDismiss?.();
  releaseDismiss = undefined;
}

/** Hand off to the existing server settings after dismissing this guide. */
function openSettings(): void {
  dialog.value?.close();
  emit("openSettings");
}

onUnmounted(release);
</script>

<template>
  <div class="mcp-help">
    <button type="button" class="mcp-help-trigger" aria-haspopup="dialog" @click="show">
      <PlugIcon :size="14" />
      Use MCP
    </button>

    <dialog
      ref="dialog"
      class="mcp-help-overlay"
      data-interactive
      :aria-labelledby="titleId"
      @close="release"
      @keydown.esc.stop
      @pointerdown.stop
      @click.self="dialog?.close()"
    >
      <div class="mcp-help-card">
        <header class="mcp-help-header">
          <div>
            <h2 :id="titleId" tabindex="-1" autofocus>Use MCP</h2>
            <p>Build Kavibay widgets with your own AI client.</p>
          </div>
          <DialogCloseButton label="Close MCP guide" @click="dialog?.close()" />
        </header>

        <ol class="mcp-help-steps">
          <li>
            <div class="mcp-help-server">
              <div>
                <h3>MCP Server</h3>
                <span class="mcp-help-status" :class="`mcp-help-status--${presentation.tone}`" role="status">
                  {{ presentation.label }}{{ pending ? ' · Updating…' : '' }}
                </span>
              </div>
              <button
                type="button"
                class="mcp-help-switch"
                role="switch"
                aria-label="Enable MCP Server"
                :aria-checked="status?.desiredEnabled === true"
                :disabled="status === null || busy"
                @click="toggleServer"
              ><span /></button>
            </div>
            <p v-if="requestError || status?.lastError" class="mcp-help-error" role="alert">
              {{ requestError || status?.lastError }}
            </p>
            <button
              v-if="status?.state === 'error' && status.desiredEnabled"
              type="button"
              class="mcp-help-settings"
              :disabled="busy"
              @click="runAction(retryMcpServer)"
            >Retry connection</button>
            <p>
              Enabled by default. Keep Kavibay open while you work.
            </p>
          </li>
          <li>
            <h3>Connect your client</h3>
            <p>
              Run the command for your client in a terminal to add Kavibay as a
              <strong>Streamable HTTP</strong> server.
            </p>
            <p v-if="!status?.url">These examples use the default port. Start the server to show its current address.</p>
            <div class="mcp-help-address">
              <span>Claude Code</span>
              <code>{{ buildClaudeCodeCommand(serverUrl, tokenRequired) }}</code>
            </div>
            <div class="mcp-help-address">
              <span>Codex</span>
              <code>{{ buildCodexCommand(serverUrl, tokenRequired) }}</code>
            </div>
            <p v-if="tokenRequired">
              This server requires a token. Put yours in place of
              <code>{{ MCP_TOKEN_PLACEHOLDER }}</code>; Codex reads it from
              <code>{{ MCP_TOKEN_ENV_VAR }}</code>. A lost token can be replaced in Settings.
            </p>
            <p>For Codex, you can also copy the configuration from Settings.</p>
          </li>
          <li>
            <h3>Ask for a widget</h3>
            <p>Try this in your connected client:</p>
            <blockquote>
              Use Kavibay MCP to read the authoring guide and create a water
              tracker widget draft.
            </blockquote>
            <p>
              The draft appears in this Wizard. Open it, review the preview,
              then choose <strong>Save</strong> or <strong>Save &amp; Run</strong>.
            </p>
          </li>
        </ol>

        <footer class="mcp-help-footer">
          <span>Connect from this computer.</span>
          <button type="button" class="mcp-help-settings" @click="openSettings">
            Open MCP settings
          </button>
        </footer>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
h2[tabindex="-1"] { outline: none; }

.mcp-help {
  flex: 0 0 auto;
}

.mcp-help-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.mcp-help-trigger:hover {
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.85);
}

/* The top layer escapes the widget's clipping; the full viewport also keeps
   backdrop clicks inside the host's interactive region. */
.mcp-help-overlay {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 20px;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font: inherit;
  pointer-events: auto;
}

.mcp-help-overlay[open] {
  display: grid;
  place-items: center;
}

.mcp-help-overlay::backdrop {
  background: rgba(0, 0, 0, 0.45);
}

.mcp-help-card {
  box-sizing: border-box;
  width: min(480px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 24px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 16px;
  background: rgb(var(--surface-bg-rgb, 28, 28, 32));
  box-shadow: 0 20px 64px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  line-height: 1.6;
}

.mcp-help-header,
.mcp-help-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  margin-bottom: 4px;
  font-size: 18px;
  font-weight: 600;
}

h3 {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
}

p,
.mcp-help-footer > span {
  color: rgba(var(--fg-rgb), 0.6);
}

strong {
  color: rgba(var(--fg-rgb), 0.8);
  font-weight: 500;
}

.mcp-help-steps {
  display: grid;
  gap: 20px;
  margin: 24px 0;
  padding-left: 20px;
}

.mcp-help-steps li {
  padding-left: 6px;
}

.mcp-help-steps li::marker {
  color: rgba(var(--fg-rgb), 0.4);
}

.mcp-help-server {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.mcp-help-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 11px;
}

.mcp-help-status::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.mcp-help-status--success { color: rgb(104, 194, 144); }
.mcp-help-status--warning { color: rgb(220, 166, 80); }
.mcp-help-status--danger,
.mcp-help-error { color: rgb(228, 112, 112); }
.mcp-help-error { margin-bottom: 8px; }

.mcp-help-switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 20px;
  padding: 3px;
  border: 0;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.2);
  cursor: pointer;
}

.mcp-help-switch span {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgb(var(--fg-rgb));
}

.mcp-help-switch[aria-checked="true"] { background: rgb(62, 142, 96); }
.mcp-help-switch[aria-checked="true"] span { transform: translateX(14px); }
.mcp-help-switch:disabled,
.mcp-help-settings:disabled { opacity: 0.45; cursor: default; }

.mcp-help-address,
blockquote {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.04);
}

.mcp-help-address span {
  display: block;
  margin-bottom: 2px;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 10px;
}

code {
  font-size: 11px;
  overflow-wrap: anywhere;
}

blockquote {
  border-left: 2px solid rgba(var(--fg-rgb), 0.16);
  color: rgba(var(--fg-rgb), 0.8);
}

.mcp-help-footer {
  align-items: center;
  flex-wrap: wrap;
  padding-top: 16px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  font-size: 11px;
}

.mcp-help-settings {
  flex-shrink: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.06);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.mcp-help-settings {
  padding: 7px 10px;
}

.mcp-help-settings:hover {
  background: rgba(var(--fg-rgb), 0.12);
}

.mcp-help-switch:focus-visible,
.mcp-help-settings:focus-visible,
.mcp-help-trigger:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.5);
  outline-offset: 3px;
}
</style>
