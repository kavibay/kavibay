import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import { hasKeptInstance, shouldKeepWindowAfterDismiss, survivesDismiss } from "./layoutLogic.ts";
import { widgetFocusRequestMatches, WIDGET_FOCUS_EVENT } from "../../../sdk/extension/widgetFocusRequest.ts";
import { classifyCtrlKey, emptyCtrlTapState, observeCtrlTap } from "./ctrlDoubleTap.ts";
import { isSetupVisible } from "../onboarding/setupLogic.ts";
import { resolvePeek } from "./peekSession.ts";

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

// Slow contract setup must receive focus when its view finally mounts.
const retries = [];
const focusEvents = [];
const focusContext = {
  instances: [{ instanceId: "wizard", typeId: "wizard" }, { instanceId: "other", typeId: "other" }],
  focusedInstanceId: ref(null), frontInstanceId: ref(null), previewInstanceId: ref(null),
  paletteFront: ref(true), widgetFocusRequest: null,
  nextTick: async () => {},
  onRevealWidget() {}, ensureInstanceOnScreen: () => false, persist() {},
  onHighlightWidget() {}, onFocusPop() {},
  WIDGET_FOCUS_EVENT,
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  window: {
    dispatchEvent: (event) => focusEvents.push(event.detail),
    setTimeout: (fn) => retries.push(fn),
  },
};
handlers(script("./WidgetHost.vue"), ["onFocusWidget", "dispatchWidgetFocus"], focusContext);
await focusContext.onFocusWidget("wizard", "edited-package");
retries.shift()(); // The initial 60 ms retry already passed before setup completed.
focusEvents.length = 0;
focusContext.dispatchWidgetFocus("wizard"); // WidgetGate's actual view-mounted notification.
assert.equal(focusEvents.length, 1, "late-mounted views receive their pending focus");
assert.equal(focusEvents[0].instanceId, "wizard");
assert.equal(focusEvents[0].openPackageId, "edited-package", "late delivery preserves the editing target");
assert(source("../extension-host/ui/WidgetGate.vue").includes('@vue:mounted="widgetViewMounted?.(instance.id)"'),
  "the contract view mount delivers pending host focus");
await focusContext.onFocusWidget("other");
focusEvents.length = 0;
focusContext.dispatchWidgetFocus("wizard");
assert.equal(focusEvents.length, 0, "an old mounting view cannot steal focus from a newer target");
focusContext.paletteFront.value = true;
retries.shift()();
assert.equal(focusEvents.length, 0, "the timed retry cannot steal focus back from search");

let scans = 0;
const openContext = {
  instances: [{ instanceId: "wizard", typeId: "widget-wizard" }],
  getExtension: (id) => id === "widget-wizard" ? {} : undefined,
  rescanRuntimeExtensions: async () => { scans++; },
  onAddType: () => "new-runtime",
  onFocusWidget: async (id) => trace.push(`open-focus:${id}`),
  windowedExtension: () => undefined,
};
handlers(script("./WidgetHost.vue"), ["onRunRuntimeWidget"], openContext);
await openContext.onRunRuntimeWidget({ detail: { typeId: "widget-wizard" } });
assert.equal(scans, 0, "opening a bundled Wizard does not wait for unrelated runtime scans");
assert.equal(trace.at(-1), "open-focus:wizard");
await openContext.onRunRuntimeWidget({ detail: { typeId: "saved-package" } });
assert.equal(scans, 1, "new runtime packages are still discovered before opening");
// A windowed type (the Wizard on the desktop) opens its window, never a card.
Object.assign(openContext, {
  windowedExtension: (id) => (id === "widget-wizard" ? { id } : undefined),
  closeCockpit: () => trace.push("close"),
  openWidgetWindow: async (extension, request) =>
    trace.push(`window:${extension.id}:${request.openPackageId ?? ""}`),
});
handlers(script("./WidgetHost.vue"), ["onRunRuntimeWidget"], openContext);
await openContext.onRunRuntimeWidget({ detail: { typeId: "widget-wizard", openPackageId: "pkg" } });
assert.deepEqual(trace.slice(-2), ["close", "window:widget-wizard:pkg"],
  "the overlay steps aside and the window gets the package to edit");
console.log("widget focus handoff assertions passed");

// On first launch the setup card owns focus, so the double tap arrives via DOM.
const setupContext = {
  classifyCtrlKey, emptyCtrlTapState, observeCtrlTap, isSetupVisible,
  ctrlTap: emptyCtrlTapState(), lastRustHotkeyAt: 0,
  Date: { now: () => 10_000 },
  setupState: ref({ status: "pending" }), setupGestureCount: ref(0),
  commandUi: { request: ref(null) }, peeking: ref(false),
  paletteHidden: ref(true), cockpitOpen: ref(true),
  openCockpit: () => trace.push("open"), closeCockpit: () => trace.push("close"),
  emit: () => trace.push("palette-show"),
};
handlers(script("./WidgetHost.vue"), ["onCtrlTapKey", "onPaletteHotkey"], setupContext);
function doubleCtrl(at) {
  for (const [type, delta] of [["keydown", 0], ["keyup", 60], ["keydown", 180], ["keyup", 240]]) {
    setupContext.onCtrlTapKey({ type, key: "Control", timeStamp: at + delta });
  }
}
trace.length = 0;
doubleCtrl(0);
assert.equal(setupContext.setupGestureCount.value, 1, "focused setup passes the DOM double tap to the tour");
assert.deepEqual(trace, [], "setup does not toggle the cockpit or open search behind the card");
setupContext.lastRustHotkeyAt = 9_900;
doubleCtrl(1000);
assert.equal(setupContext.setupGestureCount.value, 1, "a native gesture cannot also answer setup through DOM");
setupContext.lastRustHotkeyAt = 0;
setupContext.setupState.value = { status: "done" };
setupContext.paletteHidden.value = false;
doubleCtrl(2000);
assert.deepEqual(trace, ["close"], "after setup the double tap still closes the cockpit");
assert.equal(setupContext.setupGestureCount.value, 1, "completed setup receives no further tour-start requests");
console.log("setup gesture handoff assertions passed");

// Iframe clicks must use the same keep/raise path as native widget chrome.
instances.splice(0, instances.length,
  { instanceId: "timer", typeId: "background" },
  { instanceId: "other", typeId: "plain" },
  { instanceId: "untouched", typeId: "plain" },
  { instanceId: "pinned", typeId: "plain", pinned: true },
);
cockpitOpen.value = false;
peekKept.value.clear();
Object.assign(context, {
  resolvePeek, peeking: ref(false), peekRestorePaletteHidden: false,
  frontInstanceId: ref(null), focusedInstanceId: ref(null),
  previewInstanceId: ref(null), paletteFront: ref(false),
});
const frames = ["timer", "other"].map((id) => ({
  contentWindow: {},
  closest: () => ({ dataset: { widgetInstance: id } }),
}));
context.document = { querySelectorAll: () => frames };
handlers(script("./WidgetHost.vue"), ["raiseWidget", "onFramePointerDown", "onPeekHotkey"], context);
const framePress = (source, instanceId = "pinned") => context.onFramePointerDown({
  source, data: { type: "kavibay.ext.pointerdown", instanceId },
});
framePress(frames[0].contentWindow);
assert.equal(peekKept.value.size, 0, "ordinary iframe clicks do not create a temporary keep");
context.onPeekHotkey(true, true);
trace.length = 0;
framePress({});
framePress(null);
context.onFramePointerDown({ source: frames[0].contentWindow, data: null });
context.onFramePointerDown({ source: frames[0].contentWindow, data: { type: "unrelated" } });
assert.equal(peekKept.value.size, 0, "unrelated or unknown sources cannot keep a widget");
framePress(frames[0].contentWindow);
framePress(frames[1].contentWindow);
assert.deepEqual(Array.from(peekKept.value), ["timer", "other"],
  "frame identity, never a payload id, selects every clicked widget");
assert.equal(context.frontInstanceId.value, "other", "iframe clicks also raise the card");
context.onPeekHotkey(false, false);
assert.deepEqual(visible(), ["timer", "other", "pinned"],
  "releasing Ctrl+Space keeps clicked and pinned cards and hides untouched ones");
assert.deepEqual(trace, ["onSuspend:untouched"], "kept cards continue running after release");
assert.equal(instances[1].pinned, undefined, "clicking during peek never saves a pin");
context.onDismissOutside();
assert.deepEqual(visible(), ["pinned"], "ordinary dismiss releases temporary keeps");
assert(trace.includes("onSuspend:other"), "dismissing a kept card suspends it");
instances[3].pinned = false;
context.onPeekHotkey(true, true);
context.raiseWidget("other");
context.onPeekHotkey(false, false);
assert.deepEqual(visible(), ["other"], "native chrome clicks still keep their card");
context.onDismissOutside();
context.onPeekHotkey(true, true);
context.onPeekHotkey(false, false);
assert.deepEqual(visible(), [], "a later untouched peek cannot revive previous keeps");
console.log("peek interaction handoff assertions passed");
