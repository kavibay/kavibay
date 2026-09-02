<script setup lang="ts">
import { ref, shallowRef } from "vue";
import type { WidgetInstance } from "@sdk/contract/sdk";
import { ExtensionRegistry } from "../extension-host/registry";
import { Host } from "../extension-host/runtime";
import { todoExtension } from "../extension-host/fixtures/todo";
/**
 * The shipping Clock, not `fixtures/clock`.
 *
 * Both declare `kavibay.clock/clock`, and `widgetViews` is keyed by that id —
 * so once the real widget claimed the mapping, the board was handing the
 * fixture's `{ now, showSeconds }` model to a view that reads `formatted`, and
 * the card rendered empty with a TypeError. Two definitions cannot share one id
 * and one view map; the board shows what ships.
 */
import clockExtension from "../../../extensions/clock/extension";
import { tadoExtension } from "../extension-host/fixtures/tado";
import { calendarExtension } from "../extension-host/fixtures/calendar";
import { makeFetcher, makeUi } from "../extension-host/fixtures/harness";
import { JsonBridge } from "../extension-host/bridge";
import { buildPermissionRequest } from "../extension-host/permissionRequest";
import type { ApprovedGrant } from "../extension-host/widgetPackage";
import WidgetGate from "../extension-host/ui/WidgetGate.vue";
import PermissionRequest from "../extension-host/ui/PermissionRequest.vue";

/**
 * Dev-only board for the Phase 3 gate states. Not part of the app: it exists so
 * the four states can be looked at rather than only asserted on, and so the
 * connect transition can be triggered by hand.
 *
 * The fetcher is the same fake the assert suites use, so nothing here reaches
 * the network.
 */
const TADO = "kavibay.tado/tado";
const CAL = "kavibay.google-calendar/calendar";

const registry = new ExtensionRegistry();
registry.load(todoExtension, { kind: "bundled" });
registry.load(clockExtension, { kind: "bundled" });
registry.load(tadoExtension, { kind: "bundled" });
registry.load(calendarExtension, { kind: "bundled" });
registry.link();

const { fetcher } = makeFetcher();
const { ui } = makeUi({});
const host = shallowRef(new Host(registry, fetcher, ui));

const tadoConnected = ref(false);
const calConnected = ref(false);

const inst = <T,>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

const cards = [
  { title: "Todo — no provider", instance: inst("kavibay.todo/list", "todo-1", {}) },
  { title: "Clock — no provider", instance: inst("kavibay.clock/clock", "clock-1", {}) },
  { title: "Tado — needs connect", instance: inst("kavibay.tado/temperature", "tado-1", { room: "living-room" }) },
  { title: "Calendar — needs config", instance: inst("kavibay.google-calendar/today", "cal-1", {} as { calendar: string }) },
  { title: "Missing definition", instance: inst("kavibay.ghost/gone", "ghost-1", {}) },
];

/**
 * The same widgets again, behind the iframe boundary. Identical definitions,
 * identical views — only `WidgetContext` is built from `sandboxContext` over
 * postMessage instead of directly. If a pair behaves differently, the boundary
 * leaked, and having them side by side is the point of the board.
 *
 * Todo covers `ctx.data` crossing the wire; Tado covers the provider path and
 * the gate that has to run outside the frame, because a connect prompt cannot
 * be drawn by a widget that has not started.
 */
const bridge = new JsonBridge(host.value);
const SANDBOX = { bridge, entryUrl: "/extension-host-sandbox.html" };

const sandboxedCards = [
  // No provider: exercises ctx.data across the wire.
  { title: "Todo — in a sandboxed iframe", instance: inst("kavibay.todo/list", "todo-sandboxed", {}) },
  // Provider-backed: the connect prompt is drawn by the host, outside the
  // frame, and the frame only appears once the gate says ready. Pressing
  // Connect Tado above should move this card from prompt to skeleton to data
  // exactly like the in-process one beside it.
  {
    title: "Tado — sandboxed, needs connect",
    instance: inst("kavibay.tado/temperature", "tado-sandboxed", { room: "bedroom" }),
  },
];

/**
 * A package asking for more than it will get, which is what a generated one
 * does. The dialog is the last thing between that manifest and a load.
 */
const askingPackage = {
  name: "room-summary",
  version: "1.0.0",
  displayName: "Room summary",
  engines: { kavibay: "^0.1" },
  widget: {
    name: "tile",
    displayName: "Room summary",
    requires: { providers: [TADO] },
    permissions: {
      queries: ["roomState", "rooms", "somethingInvented"],
      actions: ["setTemperature"],
    },
  },
};

const permissionRequest = ref(buildPermissionRequest(askingPackage, registry));
const lastGrant = ref<ApprovedGrant | null>(null);

function onApprove(grant: ApprovedGrant) {
  lastGrant.value = grant;
}

function resetRequest() {
  lastGrant.value = null;
  permissionRequest.value = buildPermissionRequest(askingPackage, registry);
}

async function connect(provider: string) {
  await host.value.connect(provider, { accessToken: "dev-token" });
  if (provider === TADO) tadoConnected.value = true;
  if (provider === CAL) calConnected.value = true;
}

function disconnect(provider: string) {
  host.value.disconnect(provider);
  if (provider === TADO) tadoConnected.value = false;
  if (provider === CAL) calConnected.value = false;
}
</script>

<template>
  <main class="board">
    <header class="head">
      <h1>Extension host — Phase 3</h1>
      <p class="sub">
        Every card below is the same component: <code>WidgetGate</code>. The widgets
        contain no connect screen, no spinner and no error state.
      </p>
      <div class="controls">
        <button type="button" @click="tadoConnected ? disconnect(TADO) : connect(TADO)">
          {{ tadoConnected ? "Disconnect" : "Connect" }} Tado
        </button>
        <button type="button" @click="calConnected ? disconnect(CAL) : connect(CAL)">
          {{ calConnected ? "Disconnect" : "Connect" }} Calendar
        </button>
      </div>
    </header>

    <section class="grid">
      <article v-for="card in cards" :key="card.instance.id" class="card">
        <h2 class="card-title">{{ card.title }}</h2>
        <div class="card-body">
          <WidgetGate :host="host" :instance="card.instance" @connect="connect" />
        </div>
      </article>

      <!--
        Same component as every card above. The only difference is the sandbox
        prop, which is the point: the four gate states are answered here either
        way, and only who mounts the widget changes.
      -->
      <article v-for="card in sandboxedCards" :key="card.instance.id" class="card">
        <h2 class="card-title">{{ card.title }}</h2>
        <div class="card-body">
          <WidgetGate
            :host="host"
            :instance="card.instance"
            :sandbox="SANDBOX"
            @connect="connect"
          />
        </div>
      </article>
    </section>

    <section class="consent">
      <h2 class="card-title">Approval — a package asking for more than it gets</h2>
      <div class="card">
        <PermissionRequest
          v-if="!lastGrant"
          display-name="Room summary"
          :request="permissionRequest"
          @approve="onApprove"
          @cancel="resetRequest"
        />
        <div v-else class="granted">
          <p class="sub">
            Loaded with <code>{{ JSON.stringify(lastGrant) }}</code>
          </p>
          <p class="sub">
            `actions` is empty whatever was ticked, and `somethingInvented` was never
            offered — the provider has no such query.
          </p>
          <button type="button" @click="resetRequest">Ask again</button>
        </div>
      </div>
    </section>
  </main>
</template>

<style>
/*
  A slice of the cockpit's tokens rather than an import of styles.css, which
  would restyle this board. Enough of the documented set is defined here that
  the theme actually pushed to the sandboxed frame is a realistic one instead of
  a single variable.
*/
:root {
  --fg-rgb: 232, 234, 237;
  --inset-rgb: 0, 0, 0;
  --font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  --text: rgba(var(--fg-rgb), 0.92);
  --text-muted: rgba(var(--fg-rgb), 0.55);
  --text-faint: rgba(var(--fg-rgb), 0.4);
  --border: rgba(var(--fg-rgb), 0.1);
  --border-strong: rgba(var(--fg-rgb), 0.28);
  --fill: rgba(var(--fg-rgb), 0.08);
  --fill-hover: rgba(var(--fg-rgb), 0.14);
  --inset-bg: rgba(var(--inset-rgb), 0.25);
  --surface-radius: 16px;
  --native-color-scheme: dark;
  color-scheme: dark;
}

body {
  margin: 0;
  background: #14161a;
  color: rgb(var(--fg-rgb));
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
</style>

<style scoped>
.board {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.head h1 {
  margin: 0 0 6px;
  font-size: 20px;
}

.sub {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.6);
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 28px;
}

.controls button {
  padding: 6px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
  cursor: pointer;
}

.controls button:hover { background: rgba(var(--fg-rgb), 0.16); }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}

.consent {
  margin-top: 34px;
  max-width: 460px;
}

.granted {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 18px 20px;
}

.granted code {
  font-size: 11px;
  overflow-wrap: anywhere;
}

.granted button {
  padding: 6px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.2);
  border-radius: 7px;
  cursor: pointer;
}

.card-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--fg-rgb), 0.45);
}

.card-body {
  display: flex;
  height: 190px;
  background: rgba(var(--fg-rgb), 0.04);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 12px;
  overflow: hidden;
}
</style>
