import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { hasKeptInstance, shouldKeepWindowAfterDismiss, survivesDismiss } from "./layoutLogic.ts";
import { widgetFocusRequestMatches, WIDGET_FOCUS_EVENT } from "../../../sdk/extension/widgetFocusRequest.ts";

// Run the actual SFC handlers with native effects stubbed; no copied pop logic.
function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
function script(path) {
  const text = source(path).split('<script setup lang="ts">')[1].split("</script>")[0];
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}
function handlers(file, names, context) {
  const selected = file.statements.filter((node) =>
    names.includes(node.name?.text ?? node.declarationList?.declarations[0]?.name?.text));
  assert.equal(selected.length, names.length, "every tested handler must exist");
  const code = selected.map((node) => node.getText(file)).join("\n");
  runInNewContext(ts.transpile(`${code}\nObject.assign(globalThis, { ${names.join(", ")} });`), context);
}

const trace = [];
const instances = reactive([
  { instanceId: "timer", typeId: "background", offset: { x: 0, y: 0 } },
  { instanceId: "other", typeId: "plain", offset: { x: 0, y: 0 } },
]);
const cockpitOpen = ref(false);
const peekKept = ref(new Set());
const context = {
  computed, instances, cockpitOpen, peekKept, survivesDismiss, hasKeptInstance,
  nextTick: async (fn) => fn(), recoverLayoutIntoViewport() {},
  shouldKeepWindowAfterDismiss,
  mountedInstances: computed(() => instances),
  paletteHidden: ref(false), palettePinned: ref(false),
  settingsOpen: ref(false), hostDismissHeld: ref(false),
  commandUi: { request: ref(null) },
  widgetRemoval: { cancel() {} },
  layoutDoc: reactive({ activeDeskId: "main", desks: [
    { id: "main", placements: [{ instanceId: "timer" }, { instanceId: "other" }] },
    { id: "away", placements: [{ instanceId: "away-timer", hidden: true, hiddenAt: 1 }] },
  ] }),
  defFor: (type) => ({ keepAliveWhenHidden: type === "background" }),
  isEnabled: () => true,
  getExtension: (type) => type,
  runExtensionHook: (_type, hook, id) => trace.push(`${hook}:${id}`),
  raiseWidget: (id) => trace.push(`raise:${id}`),
  persist() {}, disposePurgedHidden() {}, scheduleRegionSync() {},
  onboarding: { notifyWidgetVisible() {} },
  getCurrentWindow: () => ({ hide: () => trace.push("hide") }),
  openCockpit: () => { cockpitOpen.value = true; trace.push("cockpit"); },
  kavibaySwitchDesk: (id) => {
    context.layoutDoc.activeDeskId = id;
    instances.splice(0, instances.length, {
      instanceId: "away-timer", typeId: "background", hidden: true, hiddenAt: 1,
    });
  },
};
handlers(script("./WidgetHost.vue"), [
  "onRevealWidget", "onRevealWidgetEvent", "wouldMountIgnoringEnable", "isMountedInstance",
  "keepsAliveWhenHidden", "visibleMountedInstances", "paletteVisible", "closeCockpit", "onDismissOutside",
], context);

const pop = (id) => context.onRevealWidgetEvent({ detail: { instanceId: id, onlyWidget: true } });
const visible = () => Array.from(context.visibleMountedInstances.value, (row) => row.instanceId);
pop("timer");
assert.equal(cockpitOpen.value, false, "a pop never opens the cockpit");
assert.equal(context.paletteVisible.value, false, "a pop never opens search");
assert.deepEqual(visible(), ["timer"], "only the caller appears");
assert.equal(instances[0].pinned, undefined, "a pop never saves a pin");
assert.deepEqual(trace, ["raise:timer"], "background models are not resumed twice");
instances[1].pinned = true;
assert.deepEqual(visible(), ["timer", "other"], "existing pinned cards remain visible");
delete instances[1].pinned;

context.window = { dispatchEvent: (event) => {
  assert.equal(event.type, "kavibay:dismiss-cockpit");
  context.onDismissOutside();
} };
context.Event = Event;
handlers(script("../App.vue"), ["onKeydown"], context);
context.onKeydown({ key: "Escape" });
assert.deepEqual(visible(), [], "Escape forgets the temporary card");
assert.equal(trace.at(-1), "hide");
pop("other");
assert.deepEqual(visible(), ["other"], "the next pop cannot revive the dismissed card");
assert(trace.includes("onResume:other"), "a suspended model resumes when popped");
context.onDismissOutside();
assert(trace.includes("onSuspend:other"), "outside dismiss suspends that model again");

pop("away-timer");
assert.equal(context.layoutDoc.activeDeskId, "away", "a pop finds its other desk");
assert.deepEqual(visible(), ["away-timer"]);
assert.equal(instances[0].hidden, undefined, "a hidden card is revealed");
assert.equal(context.layoutDoc.desks[1].placements[0].hidden, undefined);
assert.equal(cockpitOpen.value, false, "switching desk for a pop still opens no cockpit");
context.onDismissOutside();
pop("missing");
assert.deepEqual(visible(), [], "a stale id reveals nothing");
context.onRevealWidgetEvent({ detail: { instanceId: "away-timer" } });
assert.equal(cockpitOpen.value, true, "ordinary reveal keeps its cockpit behavior");
trace.length = 0;
context.onRevealWidgetEvent({ detail: { instanceId: "away-timer" } });
assert(!trace.includes("cockpit"), "revealing in an open session does not reopen search or steal widget focus");
pop("away-timer");
assert.equal(cockpitOpen.value, true, "popping while open preserves the current cockpit");
assert(!trace.includes("cockpit"), "a pop does not reopen or refocus search");

// Check the shared Alarm/runtime native path, including its render-before-show order.
const transport = ts.createSourceFile("transport.ts", source("../extension-host/tauriWidgetCapabilityTransport.ts"), ts.ScriptTarget.Latest, true);
let alarm;
function findAlarm(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(transport) === "alarmNotify") alarm = node.initializer;
  ts.forEachChild(node, findAlarm);
}
findAlarm(transport);
assert(alarm, "the shared alarm transport must exist");
const notify = runInNewContext(ts.transpile(`(${alarm.getText(transport)})`), {
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  window: { dispatchEvent: (event) => {
    assert.equal(event.type, "kavibay:reveal-widget");
    assert.equal(event.detail.instanceId, "timer");
    assert.equal(event.detail.onlyWidget, true);
    trace.push("reveal");
  } },
  nextTick: async () => { trace.push("render"); },
  getCurrentWindow: () => ({
    show: async () => { trace.push("show"); },
    setFocus: async () => { trace.push("focus"); },
  }),
  playSessionEndBeep: () => trace.push("sound"),
});
for (const [mode, expected] of [
  ["pop", ["reveal", "render", "show", "focus"]],
  ["sound_and_pop", ["sound", "reveal", "render", "show", "focus"]],
  ["sound", ["sound"]],
]) {
  trace.length = 0;
  await notify("timer", mode);
  assert.deepEqual(trace, expected);
}
// A sibling Todo must not take the caret when the host focuses the Wizard.
const todoFocus = {
  widgetFocusRequestMatches,
  widgetSurface: "desk",
  props: { model: {
    instanceId: "todo-a",
    state: { value: { items: [{ id: "row-a", text: "Task" }] } },
    rows: { value: [{ id: "row-a" }] },
  } },
  focusRow: (id) => trace.push(`todo-focus:${id}`),
};
handlers(script("../../../extensions/todo/widgets/TodoView.vue"), ["onFocusRequest"], todoFocus);
const requestFocus = (instanceId, surface = "desk") => todoFocus.onFocusRequest({
  type: WIDGET_FOCUS_EVENT, detail: { instanceId, surface },
});
trace.length = 0;
requestFocus("wizard");
requestFocus("todo-b");
requestFocus("todo-a", "inline");
assert.deepEqual(trace, [], "Todo ignores focus for other widgets and surfaces");
requestFocus("todo-a");
assert.deepEqual(trace, ["todo-focus:row-a"], "Todo still focuses its own desk instance");
todoFocus.widgetSurface = "inline";
trace.length = 0;
requestFocus("todo-a");
assert.deepEqual(trace, [], "the inline copy ignores desk focus");
requestFocus("todo-a", "inline");
assert.deepEqual(trace, ["todo-focus:row-a"], "the inline copy accepts its own focus");
console.log("widgetPop.assert.mjs: all assertions passed");
