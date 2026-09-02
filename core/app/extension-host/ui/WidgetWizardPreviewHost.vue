<script setup lang="ts">
/**
 * Host-owned preview chrome for the first-party Widget Wizard.
 *
 * The wizard itself is an MIT extension and cannot import this GPL host code.
 * CockpitWidget provides this component as a narrow rendering seam; the
 * extension supplies only package identity, URL, format and geometry.
 */
import { computed, ref, watch } from "vue";
import WidgetCard from "../../host/WidgetCard.vue";
import RuntimeExtensionFrame from "../../runtime/RuntimeExtensionFrame.vue";
import ContractPackageWidget from "./ContractPackageWidget.vue";
import { clearWidgetLog, widgetCalls, widgetFaults, type WidgetFault } from "../cockpit";
import type { WidgetCall } from "../bridge";
import { packageDefinitionId } from "../cockpit";
import type { PackageFormat } from "../../runtime/runtimeTypes";
import { CONTENT_OVERFLOW_EVENT } from "../../host/contentOverflow";
import { fitToContent } from "../../host/resizeLogic";

const props = defineProps<{
  extId: string;
  entryUrl: string;
  title: string;
  nonce: number;
  grantedPermissions: string[];
  format: PackageFormat;
  initialSize?: { w: number; h: number } | null;
  initialScale?: number | null;
  /**
   * Providers a contract package declared and still cannot read — never
   * granted, or named and not installed here.
   *
   * Supplied by the wizard rather than looked up: the grant and the package's
   * manifest are both its to read, and this chrome has neither.
   */
  unmet?: string[];
}>();

const emit = defineEmits<{
  rename: [title: string];
  resized: [size: { w: number; h: number }, scale?: number];
  /**
   * One fault, as it arrives. Structural rather than `WidgetFault` because the
   * listener is an MIT extension: the wizard cannot import this file's types,
   * only receive their shape.
   */
  fault: [fault: { source: WidgetFault["source"]; message: string; where?: string }];
}>();

const MIN = { w: 160, h: 120 };
const isLoaded = computed(() => packageDefinitionId(props.extId) !== undefined);
const size = ref({ ...(props.initialSize ?? { w: 280, h: 200 }) });
const scale = ref(props.initialScale ?? 1);
watch(
  () => props.initialSize,
  (next) => {
    if (next) size.value = { ...next };
  },
);

/**
 * A different package is a different guess, so fitting starts again.
 *
 * Without this, resizing one widget by hand would leave every widget generated
 * afterwards stuck at whatever the model wrote — the flag is about the card on
 * screen, not about the person.
 */
watch(
  () => props.extId,
  () => {
    sizeIsChosen = false;
  },
);
watch(
  () => props.initialScale,
  (next) => {
    scale.value = next ?? 1;
  },
);
const offset = ref({ x: 0, y: 0 });
const hideTitle = ref(false);
const stageEl = ref<HTMLElement | null>(null);
let resizeStartOffset: { x: number; y: number } | null = null;
let resizeScaleChanged = false;

watch(
  () => props.nonce,
  () => {
    offset.value = { x: 0, y: 0 };
    resizeStartOffset = null;
  },
);

const cardStyle = computed(() => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
}));

function clampToStage(next: { x: number; y: number }) {
  const stage = stageEl.value?.getBoundingClientRect();
  if (!stage) return next;
  const maxX = Math.max(0, (stage.width - size.value.w) / 2);
  const maxY = Math.max(0, (stage.height - size.value.h) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  };
}

function onMovePointerDown(event: PointerEvent) {
  const start = { x: event.clientX, y: event.clientY };
  const from = { ...offset.value };
  function onMove(move: PointerEvent) {
    offset.value = clampToStage({
      x: from.x + move.clientX - start.x,
      y: from.y + move.clientY - start.y,
    });
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onResize(payload: {
  width: number;
  height: number;
  deltaOffset: { x: number; y: number };
  contentScale?: number;
}) {
  resizeStartOffset ??= { ...offset.value };
  size.value = {
    w: Math.max(MIN.w, Math.round(payload.width)),
    h: Math.max(MIN.h, Math.round(payload.height)),
  };
  offset.value = clampToStage({
    x: resizeStartOffset.x + payload.deltaOffset.x,
    y: resizeStartOffset.y + payload.deltaOffset.y,
  });
  if (typeof payload.contentScale === "number") {
    scale.value = payload.contentScale;
    resizeScaleChanged = true;
  }
}

function onResizeEnd() {
  const changedScale = resizeScaleChanged ? scale.value : undefined;
  resizeStartOffset = null;
  resizeScaleChanged = false;
  // A size somebody chose is not a guess to be improved on.
  sizeIsChosen = true;
  emit("resized", { ...size.value }, changedScale);
}

/**
 * Whether the height on screen was decided by a person.
 *
 * Auto-fitting exists because nobody has decided yet: a generated package opens
 * at whatever the model wrote into `ui.defaultSize`, and that guess is usually
 * short enough that the first thing a new widget does is scroll. Once the card
 * has been dragged, growing it again would be taking that back.
 */
let sizeIsChosen = false;

/**
 * Grow the card by exactly what does not fit, up to a ceiling.
 *
 * The ceiling is the other half of the request: a list with no natural end must
 * keep its scrollbar rather than growing until it fills the screen.
 *
 * `emit("resized")` so the wizard stores it — the same path a drag takes, which
 * is also what writes it into the package's `ui.defaultSize` on Save. A preview
 * that fitted itself and forgot would leave the widget opening short on the
 * desk, which is the bug one step later.
 */
function onContentOverflow(event: Event) {
  if (sizeIsChosen) return;
  const overflow = (event as CustomEvent<number>).detail;
  const next = fitToContent(size.value.h, overflow);
  if (next === null) return;
  size.value = { ...size.value, h: next };
  emit("resized", { ...size.value });
}

function onContentScale(next: number) {
  scale.value = next;
  emit("resized", { ...size.value }, scale.value);
}

/**
 * What this widget has asked the host to do.
 *
 * Filtered to this preview's instance so a busy desk behind the Wizard does not
 * scroll the one call that matters off the panel.
 *
 * WHY THIS EXISTS. A generated widget catches its own failures and renders a
 * sentence it wrote — "Die WAQI-Stationssuche konnte nicht ausgeführt werden" —
 * and that sentence is all anybody sees. The host knew the call was refused as
 * `unknown_endpoint`, or answered 401, and had nowhere to say so. Asking the
 * model to render better errors is the wrong fix: it is the party with the
 * least information, and it is also the party being debugged.
 */
const instanceId = computed(() => `wizard-preview-${props.extId}`);
const calls = computed(() =>
  widgetCalls.value.filter((call) => call.instanceId === instanceId.value),
);
const faults = computed(() =>
  widgetFaults.value.filter((fault) => fault.instanceId === instanceId.value),
);

/**
 * Calls and faults as one sequence, newest first.
 *
 * ONE LIST, NOT TWO PANELS. The question being asked here is almost always
 * ordering — did it throw before it ever called the host, or after the call
 * came back 401? Two lists side by side make that a manual merge by timestamp,
 * which is the reader doing work the computer should have done.
 *
 * Stored apart in the cockpit and joined only here, because a call is
 * something the host did and a fault is something the guest reported about
 * itself. Merging them for display is honest; merging them in storage would
 * quietly claim the host witnessed both.
 */
type DebugEntry =
  | { kind: "call"; at: number; call: WidgetCall }
  | { kind: "fault"; at: number; fault: WidgetFault };

const entries = computed<DebugEntry[]>(() =>
  [
    ...calls.value.map((call): DebugEntry => ({ kind: "call", at: call.at, call })),
    ...faults.value.map((fault): DebugEntry => ({ kind: "fault", at: fault.at, fault })),
  ].sort((a, b) => b.at - a.at),
);

/**
 * Anything that is a reason to look. Faults all count: a widget does not
 * report one because things are going well.
 */
const failures = computed(
  () => calls.value.filter((call) => !call.ok).length + faults.value.length,
);
const debugOpen = ref(false);

/**
 * Hand each new fault to whoever is listening, once.
 *
 * The panel shows faults either way; this is for the wizard, which offers to
 * send one back to the model. Watched rather than pushed from the frames
 * because they report into the shared log and know nothing about who is
 * reading it.
 */
let forwarded = 0;
watch(faults, (next) => {
  // A shorter list is a cleared log — a fresh run — not entries disappearing.
  if (next.length < forwarded) forwarded = 0;
  for (const fault of next.slice(forwarded)) {
    emit("fault", { source: fault.source, message: fault.message, where: fault.where });
  }
  forwarded = next.length;
});

/** Cleared on a rerun, so what is on screen belongs to the attempt on screen. */
watch(
  () => props.nonce,
  () => clearWidgetLog(instanceId.value),
);

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false });

/** `{"lat":52.5}` — enough to reproduce, short enough for one line. */
function argsOf(call: WidgetCall): string {
  if (call.args === undefined) return "";
  const text = JSON.stringify(call.args);
  return text === "{}" ? "" : text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/** How the fault surfaced, in the widget author's vocabulary rather than the DOM's. */
const FAULT_LABEL: Record<WidgetFault["source"], string> = {
  error: "threw",
  rejection: "unhandled rejection",
  console: "console.error",
};
</script>

<template>
  <!--
    The stage and the panel are siblings in a column. Inside the stage they were
    flex siblings of a centred, draggable card, so the panel sat beside it and
    moved when the card did — a debug view that has to be chased is one nobody
    opens.
  -->
  <div class="preview">
    <div ref="stageEl" class="stage">
    <!--
      The listener is on the stage, not on window: a bubbling event stops here,
      so a widget running on the desk cannot resize the wizard's card by
      reporting a size of its own.
    -->
    <div class="stage-card" :style="cardStyle" @[CONTENT_OVERFLOW_EVENT]="onContentOverflow">
        <WidgetCard
          :title="title"
          :hide-title="hideTitle"
          :instance-id="`wizard-preview-${extId}`"
          :has-settings="false"
          :allow-duplicate="false"
          :resizable="true"
          :width="size.w"
          :height="size.h"
          :content-scale="scale"
          @update:hide-title="hideTitle = $event"
          @rename="emit('rename', $event ?? title)"
          @move-pointerdown="onMovePointerDown"
          @resize="onResize"
          @resize-end="onResizeEnd"
          @update:content-scale="onContentScale"
        >
          <ContractPackageWidget
            v-if="format === 'contract' && isLoaded && !(unmet && unmet.length)"
            :key="`${extId}:${nonce}`"
            :package-id="extId"
            :entry-url="entryUrl"
          />
          <!--
            The gate, for both ways a contract widget cannot read yet.

            Mounting it to fail is the worse answer: `contract-packages.md` tells
            authors to ignore `error` because the host shows it outside their
            frame, so a package that is mounted without its grant either renders
            nothing or renders an error panel of its own — and the second is the
            inconsistent error UI the contract exists to prevent.
          -->
          <div v-else-if="format === 'contract' && isLoaded && unmet && unmet.length" class="stage-unapproved">
            <p class="stage-unapproved-headline">Cannot read yet</p>
            <p class="stage-unapproved-hint">
              This widget asked for {{ unmet.join(", ") }} and has not been given
              it. Approve it in Settings → Extensions, or connect the account it
              needs.
            </p>
          </div>
          <div v-else-if="format === 'contract'" class="stage-unapproved">
            <p class="stage-unapproved-headline">Not approved yet</p>
            <p class="stage-unapproved-hint">
              Save this widget and choose what it may read. It runs here as soon as
              it has an answer.
            </p>
          </div>
          <RuntimeExtensionFrame
            v-else
            :key="`${extId}:${nonce}`"
            :ext-id="extId"
            :instance-id="`wizard-preview-${extId}`"
            :entry-url="entryUrl"
            :granted-permissions="grantedPermissions"
          />
        </WidgetCard>
      </div>
    </div>

    <!--
      Under the stage rather than inside the card: the card is what the widget
      will look like on the desk, and a debug drawer in it would be part of the
      thing being judged.
    -->
    <!--
      `open` bound and `toggle` listened to rather than `v-model`: `<details>`
      has no value to model, and a failed call must be able to open the panel
      without stealing it back from somebody who just closed it.
    -->
    <details class="dbg" :open="debugOpen || failures > 0" @toggle="debugOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        Debug
        <span v-if="failures" class="dbg-bad">{{ failures }} failed</span>
        <span v-else-if="calls.length" class="dbg-ok">{{ calls.length }} calls</span>
        <span v-else class="dbg-idle">nothing yet</span>
      </summary>

      <!--
        An empty panel is now itself a diagnosis, which it was not before the
        frame reported its own throws: the script that would have thrown is
        loaded before anything else, so silence means it never ran.
      -->
      <p v-if="!entries.length" class="dbg-empty">
        Nothing asked of the host, and nothing thrown. A widget that is blank
        with this panel empty never ran its script at all — check that the
        package HTML loads it, and that the file is named the way the tag says.
      </p>

      <ol v-else class="dbg-list">
        <li
          v-for="(entry, index) in entries"
          :key="index"
          :class="{ bad: entry.kind === 'fault' || !entry.call.ok }"
        >
          <template v-if="entry.kind === 'call'">
            <code class="dbg-kind">{{ entry.call.kind }}</code>
            <code class="dbg-target">{{ entry.call.target }}</code>
            <code v-if="argsOf(entry.call)" class="dbg-args">{{ argsOf(entry.call) }}</code>
            <span class="dbg-meta">
              <template v-if="entry.call.status">HTTP {{ entry.call.status }} · </template
              >{{ entry.call.ms }} ms · {{ timeOf(entry.at) }}
            </span>
            <!--
              The code and the host's own message, verbatim. This is the whole
              point of the panel: `unknown_endpoint` tells you the id is wrong,
              `consent_stale` that the endpoints changed, `permission_denied`
              that it was never enabled for the network — three different fixes
              behind one sentence the widget wrote.
            -->
            <p v-if="!entry.call.ok" class="dbg-why">
              <code>{{ entry.call.code ?? "failed" }}</code>
              <span v-if="entry.call.detail">{{ entry.call.detail }}</span>
            </p>
          </template>

          <!--
            The widget's own crash, as the browser described it. Before this
            existed the message went to a console inside a sandboxed frame that
            cannot be opened, and the widget was simply blank.
          -->
          <template v-else>
            <code class="dbg-kind">{{ FAULT_LABEL[entry.fault.source] }}</code>
            <code v-if="entry.fault.where" class="dbg-target">{{ entry.fault.where }}</code>
            <span class="dbg-meta">{{ timeOf(entry.at) }}</span>
            <p class="dbg-why">
              <span>{{ entry.fault.message }}</span>
            </p>
            <!--
              Folded away: a stack is the second question, and unfolded it
              would push every other entry off a panel that is a few lines
              tall.
            -->
            <details v-if="entry.fault.stack" class="dbg-stack">
              <summary>stack</summary>
              <pre>{{ entry.fault.stack }}</pre>
            </details>
          </template>
        </li>
      </ol>
    </details>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;
  background-image:
    linear-gradient(rgba(var(--fg-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--fg-rgb), 0.05) 1px, transparent 1px);
  background-size: 20px 20px;
}

.stage-card {
  position: relative;
}

.stage-unapproved {
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
}

.stage-unapproved-headline {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.stage-unapproved-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}
.dbg {
  margin-top: 8px;
  flex: 0 0 auto;
  font-size: 11px;
  max-width: 100%;
  /*
   * The host sets `user-select: none` on the widget anchor so a drag never
   * turns into a text selection. That is right for a clock and wrong for a
   * log whose URLs and error lines exist to be pasted into a prompt. On the
   * panel, not each row, so a selection can span two entries.
   */
  user-select: text;
  cursor: text;
}

.dbg > summary {
  cursor: pointer;
  opacity: 0.8;
}

.dbg-bad {
  color: var(--kavibay-danger, #f87171);
}

.dbg-ok,
.dbg-idle,
.dbg-empty {
  opacity: 0.6;
}

.dbg-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
}

.dbg-list li {
  padding: 4px 6px;
  border-left: 2px solid transparent;
}

.dbg-list li.bad {
  border-left-color: var(--kavibay-danger, #f87171);
  background: rgba(248, 113, 113, 0.07);
}

.dbg-kind {
  opacity: 0.6;
  margin-right: 6px;
}

.dbg-args {
  opacity: 0.55;
  margin-left: 6px;
}

.dbg-meta {
  display: block;
  opacity: 0.5;
}

.dbg-why {
  margin: 2px 0 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.dbg-why code {
  color: var(--kavibay-danger, #f87171);
}

.dbg-stack {
  margin-top: 2px;
}

.dbg-stack > summary {
  cursor: pointer;
  opacity: 0.5;
}

.dbg-stack pre {
  margin: 2px 0 0;
  /* Wrapped rather than scrolled: a stack frame is mostly a long URL, and a
     horizontal scrollbar nested two levels inside a drawer is not a control
     anybody finds. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 10px;
  opacity: 0.6;
}
</style>
