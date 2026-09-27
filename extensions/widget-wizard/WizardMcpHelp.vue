<script setup lang="ts">
import { onUnmounted, ref, useId } from "vue";
import { holdHostDismiss } from "@sdk/hostDismiss";
import { PlugIcon } from "@sdk/icons";

const emit = defineEmits<{ openSettings: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
let releaseDismiss: (() => void) | undefined;

/** Keep the cockpit open while the native dialog owns focus and Escape. */
function show(): void {
  if (!dialog.value || dialog.value.open) return;
  dialog.value.showModal();
  releaseDismiss = holdHostDismiss("wizard-mcp-help");
}

/** Release the host gesture hold on every close path, including disposal. */
function release(): void {
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
            <h2 :id="titleId">Use MCP</h2>
            <p>Build Kavibay widgets with your own AI client.</p>
          </div>
          <button
            type="button"
            class="mcp-help-close"
            aria-label="Close MCP guide"
            autofocus
            @click="dialog?.close()"
          >×</button>
        </header>

        <ol class="mcp-help-steps">
          <li>
            <h3>Enable the server</h3>
            <p>
              Open <strong>Settings → Integrations → MCP Server</strong>, turn on
              <strong>Enable MCP Server</strong> and wait for <strong>Running</strong>.
              Keep Kavibay open while you work.
            </p>
          </li>
          <li>
            <h3>Connect your client</h3>
            <p>
              In a local MCP client such as Codex or Claude Code, add a
              <strong>Streamable HTTP</strong> server using the URL from Settings.
              For Codex, you can copy the configuration there.
            </p>
            <div class="mcp-help-address">
              <span>Default address</span>
              <code>http://127.0.0.1:43127/mcp</code>
            </div>
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

.mcp-help-close,
.mcp-help-settings {
  flex-shrink: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.06);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.mcp-help-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 20px;
  line-height: 1;
}

.mcp-help-settings {
  padding: 7px 10px;
}

.mcp-help-close:hover,
.mcp-help-settings:hover {
  background: rgba(var(--fg-rgb), 0.12);
}

button:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.5);
  outline-offset: 3px;
}
</style>
