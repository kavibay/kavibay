<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  getMcpServerStatus,
  retryMcpServer,
  setMcpServerEnabled,
  setMcpServerPort,
  type McpServerStatus,
} from "@sdk/mcp/mcpServerApi";
import {
  MCP_DEFAULT_PORT,
  MCP_STATUS_POLL_MS,
  buildCodexConfigSnippet,
  buildMcpUrl,
  mcpStatusPresentationFor,
  parseMcpPort,
  parseMcpUrlPort,
} from "@sdk/mcp/mcpServerLogic";

type PendingAction = "enabled" | "port" | "retry";

const status = ref<McpServerStatus | null>(null);
const portInput = ref(String(MCP_DEFAULT_PORT));
const portDirty = ref(false);
const pendingAction = ref<PendingAction | null>(null);
const requestError = ref<string | null>(null);
const copiedLabel = ref<string | null>(null);
let pollTimer: number | null = null;
let copyFeedbackTimer: number | null = null;

const parsedPort = computed(() => parseMcpPort(portInput.value));
const portError = computed(() => {
  if (!portInput.value.trim()) return "Enter a port between 1024 and 65535.";
  return parsedPort.value === null ? "Use a whole number between 1024 and 65535." : null;
});
const serverUrl = computed(() =>
  parsedPort.value === null ? "" : buildMcpUrl(parsedPort.value),
);
const codexSnippet = computed(() =>
  parsedPort.value === null ? "" : buildCodexConfigSnippet(parsedPort.value),
);
const presentation = computed(() =>
  status.value
    ? mcpStatusPresentationFor(status.value)
    : { label: "Loading…", tone: "neutral" as const },
);
const isBusy = computed(() => pendingAction.value !== null);

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyStatus(next: McpServerStatus): void {
  status.value = next;
  const runningPort = parseMcpUrlPort(next.url);
  if (runningPort !== null && !portDirty.value) {
    portInput.value = String(runningPort);
  }
}

async function refreshStatus(): Promise<void> {
  try {
    applyStatus(await getMcpServerStatus());
    requestError.value = null;
  } catch (error) {
    requestError.value = messageFor(error);
  }
}

async function runAction(
  action: PendingAction,
  operation: () => Promise<McpServerStatus>,
): Promise<void> {
  if (pendingAction.value !== null) return;
  pendingAction.value = action;
  requestError.value = null;
  try {
    applyStatus(await operation());
    if (action === "port") portDirty.value = false;
  } catch (error) {
    requestError.value = messageFor(error);
  } finally {
    pendingAction.value = null;
  }
}

function onEnabledChange(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  void runAction("enabled", () => setMcpServerEnabled(enabled));
}

function onPortApply(): void {
  const port = parsedPort.value;
  if (port === null) return;
  void runAction("port", () => setMcpServerPort(port));
}

function onRetry(): void {
  void runAction("retry", retryMcpServer);
}

async function copyText(value: string, label: string): Promise<void> {
  if (!value) return;
  try {
    if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText(value);
    copiedLabel.value = label;
    if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      copiedLabel.value = null;
      copyFeedbackTimer = null;
    }, 1_800);
  } catch (error) {
    requestError.value = messageFor(error);
  }
}

onMounted(() => {
  void refreshStatus();
  pollTimer = window.setInterval(() => void refreshStatus(), MCP_STATUS_POLL_MS);
});

onUnmounted(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
});
</script>

<template>
  <div class="mcp-panel">
    <h2 class="mcp-title">MCP Server</h2>
    <p class="mcp-subtitle">
      Let local clients such as Codex author Kavibay widget drafts through the
      embedded server.
    </p>

    <div class="mcp-card">
      <div class="mcp-card-header">
        <div>
          <div class="mcp-card-title">Embedded authoring server</div>
          <div class="mcp-card-hint">On by default · loopback only</div>
        </div>
        <span class="mcp-status" :class="`mcp-status--${presentation.tone}`">
          {{ presentation.label }}
        </span>
      </div>

      <label class="mcp-toggle-row">
        <span>
          <span class="mcp-field-title">Enable MCP Server</span>
          <span class="mcp-field-hint">
            Kavibay must be running for local clients to connect.
          </span>
        </span>
        <input
          type="checkbox"
          :checked="status?.desiredEnabled === true"
          :disabled="status === null || isBusy"
          @change="onEnabledChange"
        />
      </label>
    </div>

    <p v-if="requestError" class="mcp-error" role="alert">{{ requestError }}</p>
    <p v-if="status?.lastError" class="mcp-error" role="alert">
      {{ status.lastError }}
    </p>

    <div class="mcp-section">
      <div class="mcp-section-title">Connection</div>
      <p class="mcp-section-hint">
        The address is always local to this computer. A bind conflict is shown
        here and never moved to another port automatically.
      </p>

      <label class="mcp-label" for="mcp-port">Port</label>
      <div class="mcp-port-row">
        <input
          id="mcp-port"
          v-model="portInput"
          class="mcp-port-input"
          inputmode="numeric"
          autocomplete="off"
          :aria-invalid="portError !== null"
          @input="portDirty = true"
        />
        <button
          type="button"
          class="mcp-button"
          :disabled="isBusy || portError !== null"
          @click="onPortApply"
        >
          {{ pendingAction === "port" ? "Applying…" : "Apply" }}
        </button>
      </div>
      <p v-if="portError" class="mcp-field-error">{{ portError }}</p>

      <div class="mcp-url-row">
        <code>{{ serverUrl || "Enter a valid port" }}</code>
        <button
          type="button"
          class="mcp-button mcp-button--small"
          :disabled="!serverUrl"
          @click="copyText(serverUrl, 'URL')"
        >
          {{ copiedLabel === "URL" ? "Copied" : "Copy URL" }}
        </button>
      </div>
      <p class="mcp-field-hint">
        Backend status: {{ status?.url ?? "not listening" }}
      </p>

      <button
        v-if="status?.state === 'error'"
        type="button"
        class="mcp-button mcp-button--retry"
        :disabled="isBusy"
        @click="onRetry"
      >
        {{ pendingAction === "retry" ? "Retrying…" : "Retry on bind error" }}
      </button>
    </div>

    <div class="mcp-section">
      <div class="mcp-section-title">Client setup</div>
      <p class="mcp-section-hint">
        Add this table to Codex's <code>config.toml</code>. Codex supports
        Streamable HTTP MCP servers through a URL.
      </p>
      <pre class="mcp-snippet"><code>{{ codexSnippet }}</code></pre>
      <button
        type="button"
        class="mcp-button"
        :disabled="!codexSnippet"
        @click="copyText(codexSnippet, 'Codex')"
      >
        {{ copiedLabel === "Codex" ? "Copied" : "Copy Codex configuration" }}
      </button>
    </div>

    <div class="mcp-boundary">
      <div class="mcp-boundary-title">What clients can do</div>
      <p>
        MCP clients can read guides and edit widget drafts. Saving, permissions
        and enabling remain in the Widget Wizard, where Kavibay can show the
        final review and consent step.
      </p>
    </div>
  </div>
</template>

<style scoped>
.mcp-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mcp-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.mcp-subtitle,
.mcp-section-hint,
.mcp-field-hint,
.mcp-boundary p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.5);
}

.mcp-card,
.mcp-section,
.mcp-boundary {
  padding: 14px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
}

.mcp-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mcp-card-header,
.mcp-toggle-row,
.mcp-url-row,
.mcp-port-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mcp-card-title,
.mcp-section-title,
.mcp-boundary-title,
.mcp-field-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}

.mcp-card-hint {
  margin-top: 3px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.42);
}

.mcp-status {
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.mcp-status--neutral {
  color: rgba(var(--fg-rgb), 0.65);
  background: rgba(var(--fg-rgb), 0.1);
}

.mcp-status--success {
  color: rgba(140, 230, 170, 0.95);
  background: rgba(80, 190, 120, 0.16);
}

.mcp-status--warning {
  color: rgba(245, 195, 115, 0.95);
  background: rgba(220, 160, 70, 0.16);
}

.mcp-status--danger {
  color: rgba(250, 145, 145, 0.95);
  background: rgba(220, 80, 80, 0.16);
}

.mcp-toggle-row {
  align-items: flex-start;
  cursor: pointer;
}

.mcp-field-title,
.mcp-field-hint {
  display: block;
}

.mcp-field-hint {
  margin-top: 3px;
}

.mcp-toggle-row input {
  width: 15px;
  height: 15px;
  margin-top: 2px;
  accent-color: rgba(120, 180, 255, 0.9);
}

.mcp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mcp-label {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.72);
}

.mcp-port-row {
  justify-content: flex-start;
}

.mcp-port-input {
  width: 120px;
  padding: 9px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 8px;
  outline: none;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
}

.mcp-port-input:focus {
  border-color: rgba(120, 180, 255, 0.65);
}

.mcp-port-input[aria-invalid="true"] {
  border-color: rgba(250, 145, 145, 0.75);
}

.mcp-button {
  align-self: flex-start;
  padding: 9px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.88);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.mcp-button:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.14);
}

.mcp-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.mcp-button--small {
  padding: 6px 9px;
  flex-shrink: 0;
}

.mcp-button--retry {
  margin-top: 2px;
}

.mcp-field-error,
.mcp-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(250, 145, 145, 0.95);
}

.mcp-url-row {
  margin-top: 4px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
}

.mcp-url-row code {
  min-width: 0;
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.78);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-snippet {
  margin: 2px 0 0;
  padding: 10px;
  overflow-x: auto;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  color: rgba(var(--fg-rgb), 0.76);
  font-size: 11px;
  line-height: 1.45;
}

.mcp-boundary {
  border-color: rgba(120, 180, 255, 0.24);
  background: rgba(80, 140, 255, 0.08);
}

.mcp-boundary p {
  margin-top: 4px;
}

.mcp-boundary code {
  color: rgba(var(--fg-rgb), 0.75);
}
</style>
