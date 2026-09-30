<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  getMcpServerStatus,
  retryMcpServer,
  setMcpServerEnabled,
  setMcpServerPort,
  setMcpServerToken,
  type McpServerStatus,
} from "@sdk/mcp/mcpServerApi";
import {
  MCP_DEFAULT_PORT,
  MCP_STATUS_POLL_MS,
  MCP_TOKEN_ENV_VAR,
  MCP_TOKEN_PLACEHOLDER,
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildCodexConfigSnippet,
  buildMcpUrl,
  mcpStatusPresentationFor,
  parseMcpPort,
  parseMcpUrlPort,
} from "@sdk/mcp/mcpServerLogic";

type PendingAction = "enabled" | "port" | "retry" | "token";

const status = ref<McpServerStatus | null>(null);
const portInput = ref(String(MCP_DEFAULT_PORT));
const portDirty = ref(false);
const pendingAction = ref<PendingAction | null>(null);
const requestError = ref<string | null>(null);
const copiedLabel = ref<string | null>(null);
/**
 * A token generated in this visit. The backend keeps only its digest, so once
 * the panel closes it is gone; the only way back is a new one.
 */
const freshToken = ref<string | null>(null);
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
const tokenRequired = computed(() => status.value?.tokenRequired === true);
const codexSnippet = computed(() =>
  parsedPort.value === null ? "" : buildCodexConfigSnippet(parsedPort.value, tokenRequired.value),
);
/**
 * One block per way in. The Claude Code command carries a token generated in
 * this visit, because Claude Code stores the header as given; Codex never does,
 * it reads the token from the environment at connect time.
 */
const clientSetups = computed(() => [
  {
    label: "Claude Code",
    text: buildClaudeCodeCommand(serverUrl.value, tokenRequired.value, freshToken.value),
  },
  { label: "Codex", text: buildCodexCommand(serverUrl.value, tokenRequired.value) },
  { label: "Codex · config.toml", text: codexSnippet.value },
]);
const presentation = computed(() =>
  status.value
    ? mcpStatusPresentationFor(status.value)
    : { label: "Loading…", tone: "neutral" as const },
);
const isBusy = computed(() => pendingAction.value !== null);

/** The backend's error codes, in words; unknown ones pass through as they are. */
const startError = computed(() => {
  const raw = status.value?.lastError;
  if (!raw) return null;
  if (raw.startsWith("bind:")) {
    return `Port ${portInput.value} is taken or blocked by another program. Pick another port or close that program, then retry.`;
  }
  return raw;
});

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

/** On: a new token (shown once). Off: none required. Either way the listener restarts. */
function setToken(required: boolean): void {
  void runAction("token", async () => {
    const change = await setMcpServerToken(required);
    freshToken.value = change.token;
    return change.status;
  });
}

function onTokenChange(event: Event): void {
  setToken((event.target as HTMLInputElement).checked);
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
  <div class="mcp">
    <Teleport to=".settings-sticky">
    <header class="mcp-head">
      <h2 class="mcp-title">MCP Server</h2>
      <p class="mcp-lead">
        Let local clients such as Codex author Kavibay widget drafts through the
        embedded server.
      </p>
    </header>
    </Teleport>

    <p v-if="requestError" class="mcp-error" role="alert">{{ requestError }}</p>

    <section class="settings-section">
      <h3 class="settings-section-title">Server</h3>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Enable MCP server</span>
          <span class="settings-row-hint mcp-state" :class="`mcp-state--${presentation.tone}`">
            {{ presentation.label }}
            <template v-if="presentation.tone === 'success'"> · clients can connect while Kavibay runs</template>
          </span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            aria-label="Enable MCP server"
            :checked="status?.desiredEnabled === true"
            :disabled="status === null || isBusy"
            @change="onEnabledChange"
          />
          <span class="switch-ui" />
        </span>
      </label>

      <div v-if="status?.state === 'error'" class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Could not start</span>
          <span class="settings-row-hint mcp-error-hint">{{ startError }}</span>
        </span>
        <button type="button" class="settings-btn" :disabled="isBusy" @click="onRetry">
          {{ pendingAction === "retry" ? "Retrying…" : "Retry" }}
        </button>
      </div>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Connection</h3>

      <div class="settings-row">
        <span class="settings-row-copy">
          <label class="settings-row-title" for="mcp-port">Port</label>
          <span class="settings-row-hint">
            Only reachable from this computer. A port that is taken is reported here;
            Kavibay never moves to another one on its own.
          </span>
          <span v-if="portError" class="settings-row-hint mcp-error-hint">{{ portError }}</span>
        </span>
        <span class="mcp-port">
          <input
            id="mcp-port"
            v-model="portInput"
            class="mcp-input"
            inputmode="numeric"
            autocomplete="off"
            :aria-invalid="portError !== null"
            @input="portDirty = true"
            @keydown.enter.prevent="onPortApply"
          />
          <button
            v-if="portDirty"
            type="button"
            class="settings-btn settings-btn--primary"
            :disabled="isBusy || portError !== null"
            @click="onPortApply"
          >
            {{ pendingAction === "port" ? "Applying…" : "Apply" }}
          </button>
        </span>
      </div>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Address</span>
          <code class="settings-row-hint mcp-url">{{ serverUrl || "Enter a valid port" }}</code>
        </span>
        <button type="button" class="settings-btn" :disabled="!serverUrl" @click="copyText(serverUrl, 'URL')">
          {{ copiedLabel === "URL" ? "Copied" : "Copy" }}
        </button>
      </div>

      <label class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Require a bearer token</span>
          <span class="settings-row-hint">
            Optional. Keeps other user accounts on this computer out — they share the
            same local address. Browsers are refused either way.
          </span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            aria-label="Require a bearer token"
            :checked="tokenRequired"
            :disabled="status === null || isBusy"
            @change="onTokenChange"
          />
          <span class="switch-ui" />
        </span>
      </label>

      <!-- Once, and only here: the backend keeps a digest, not the token. -->
      <div v-if="freshToken" class="mcp-token" role="status">
        <p class="mcp-token-title">Copy your token now</p>
        <p class="mcp-token-text">
          Kavibay keeps only a fingerprint of it and cannot show it again. Set it as
          <code>{{ MCP_TOKEN_ENV_VAR }}</code> where your client runs.
        </p>
        <div class="mcp-token-row">
          <code class="mcp-token-value">{{ freshToken }}</code>
          <button type="button" class="settings-btn settings-btn--primary" @click="copyText(freshToken, 'token')">
            {{ copiedLabel === "token" ? "Copied" : "Copy" }}
          </button>
        </div>
      </div>
      <div v-else-if="tokenRequired" class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Token</span>
          <span class="settings-row-hint">
            Set. Lost it? A new one replaces it, and clients still using the old one
            are refused.
          </span>
        </span>
        <button type="button" class="settings-btn" :disabled="isBusy" @click="setToken(true)">
          Generate new token
        </button>
      </div>
    </section>

    <section v-if="serverUrl" class="settings-section">
      <h3 class="settings-section-title">Connect a client</h3>
      <p class="settings-section-hint">
        Run the command for your client in a terminal to add Kavibay as a Streamable
        HTTP server. Keep Kavibay open while you work.
        <template v-if="tokenRequired">
          Claude Code saves the token with the server<template v-if="!freshToken">
            — put yours in place of <code>{{ MCP_TOKEN_PLACEHOLDER }}</code></template>;
          Codex reads it from <code>{{ MCP_TOKEN_ENV_VAR }}</code>.
        </template>
      </p>
      <div v-for="setup in clientSetups" :key="setup.label" class="mcp-snippet">
        <span class="mcp-snippet-label">{{ setup.label }}</span>
        <pre><code>{{ setup.text }}</code></pre>
        <button type="button" class="settings-btn mcp-snippet-copy" @click="copyText(setup.text, setup.label)">
          {{ copiedLabel === setup.label ? "Copied" : "Copy" }}
        </button>
      </div>
    </section>

    <p class="settings-section-hint mcp-boundary">
      MCP clients can read the authoring guides and edit widget drafts. Saving,
      permissions and enabling stay in the Widget Wizard, where you review a widget
      before it runs.
    </p>
  </div>
</template>

<style scoped>
.mcp {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

.mcp-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mcp-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.mcp-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.mcp-error,
.mcp-error-hint {
  color: rgba(255, 140, 140, 0.95);
}

.mcp-error {
  margin: 0;
  font-size: 13px;
}

/* Lifecycle as a dot and a word, as on the credential rows. */
.mcp-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mcp-state::before {
  content: "";
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.3);
}

.mcp-state--success::before {
  background: #4ade80;
}

.mcp-state--warning::before {
  background: #fbbf24;
}

.mcp-state--danger::before {
  background: #f87171;
}

.mcp-port {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mcp-input {
  width: 84px;
  padding: 6px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--inset-rgb), 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.mcp-input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.3);
}

.mcp-input[aria-invalid="true"] {
  border-color: rgba(255, 140, 140, 0.6);
}

.mcp-url,
.mcp-token-value,
.mcp-snippet code,
.mcp-token-text code,
.settings-section-hint code {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

.mcp-url {
  font-size: 12px;
}

.settings-section-hint code,
.mcp-token-text code {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.75);
}

/* Same violet family as other one-time, act-now notices in Settings. */
.mcp-token {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 8px;
  padding: 12px 14px;
  border: 1px solid rgba(167, 139, 250, 0.3);
  border-radius: 10px;
  background: rgba(139, 92, 246, 0.1);
}

.mcp-token-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #ddd6fe;
}

:global(html[data-color-mode="light"]) .mcp-token-title {
  color: #5b21b6;
}

.mcp-token-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.7);
}

.mcp-token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.mcp-token-value {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(var(--inset-rgb), 0.35);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 12px;
  overflow-wrap: anywhere;
  user-select: all;
}

.mcp-snippet {
  position: relative;
  margin-top: 6px;
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.3);
}

.mcp-snippet-label {
  display: block;
  padding: 10px 14px 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.mcp-snippet pre {
  margin: 0;
  padding: 6px 80px 12px 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(var(--fg-rgb), 0.85);
}

.mcp-snippet-copy {
  position: absolute;
  top: 8px;
  right: 8px;
}

.mcp-boundary {
  margin: 0;
}
</style>
