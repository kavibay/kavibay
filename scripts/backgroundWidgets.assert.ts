import assert from "node:assert/strict";
import { computed, effectScope } from "vue";
import { withBackgroundWidgets } from "../core/app/host/backgroundWidgets";
import type { WidgetCatalogEntry, WidgetInstance } from "../core/app/host/types";
import timerManifest from "../extensions/timer/manifest.json";
import { timerInlineViewForInstance, timerWidget, type TimerModel } from "../extensions/timer/widgets/timer";
import { pomodoroWidget, type PomodoroModel } from "../extensions/pomodoro/widgets/pomodoro";

const timer: WidgetInstance = { instanceId: "timer-1", typeId: "timer", offset: { x: 30, y: 40 } };
const catalog: WidgetCatalogEntry[] = [timer, { instanceId: "notes-1", typeId: "notes" }];
const keepAlive = (type: string) => type === "timer" && timerManifest.widgets.timer.ui.keepAliveWhenHidden;
const ids = (rows: WidgetInstance[]) => rows.map((row) => row.instanceId);

assert.deepEqual(ids(withBackgroundWidgets([timer], catalog, keepAlive, null)), ["timer-1"]);
assert.deepEqual(ids(withBackgroundWidgets([], catalog, keepAlive, null)), ["timer-1"], "closing or switching desk keeps the timer");
assert.deepEqual(ids(withBackgroundWidgets([{ ...timer, hidden: true }], catalog, keepAlive, null)), ["timer-1"]);
assert.deepEqual(ids(withBackgroundWidgets([timer], catalog, keepAlive, "timer-1")), [], "the inline panel must own the only model");
assert.deepEqual(ids(withBackgroundWidgets([], catalog, () => false, null)), [], "disabled widgets stop");
assert.deepEqual(ids(withBackgroundWidgets([], [], keepAlive, null)), [], "deleted instances stop");

// Exercise a real countdown under the host's mounted-set reconciliation.
const scopes = new Map<string, ReturnType<typeof effectScope>>();
const models = new Map<string, TimerModel>();
const stored = new Map<string, unknown>();
async function render(rows: WidgetInstance[]) {
  for (const [id, scope] of scopes) {
    if (!rows.some((row) => row.instanceId === id)) { scope.stop(); scopes.delete(id); }
  }
  for (const row of rows) {
    if (scopes.has(row.instanceId)) continue;
    const scope = effectScope();
    scopes.set(row.instanceId, scope);
    const model = await scope.run(() => timerWidget.component.setup({
      instanceId: row.instanceId, config: {},
      data: {
        get: async <T>(key: string) => stored.get(key) as T | undefined,
        set: async (key: string, value: unknown) => { stored.set(key, value); },
        delete: async (key: string) => { stored.delete(key); },
      },
    })) as TimerModel;
    models.set(row.instanceId, model);
  }
}

try {
  await render(withBackgroundWidgets([timer], catalog, keepAlive, null));
  const model = models.get("timer-1")!;
  model.setCustomDuration(1_000);
  model.start();
  await render(withBackgroundWidgets([], catalog, keepAlive, null));
  await new Promise((resolve) => setTimeout(resolve, 1_350));
  assert.equal(model.ringing.value, true, "the countdown completes while its desk is absent");
  assert.equal(model.running.value, false);
  await render(withBackgroundWidgets([timer], catalog, keepAlive, null));
  assert.equal(models.get("timer-1"), model, "returning to the desk preserves the running model");
  const preview = computed(() => timerInlineViewForInstance("timer-1"));
  assert.notEqual(preview.value, null);
  await render([]);
  assert.equal(preview.value, null, "the palette releases the previous surface's model");
  await render(withBackgroundWidgets([timer], catalog, keepAlive, null));
  assert.notEqual(preview.value, null, "the palette observes the replacement model after a handoff");
} finally {
  for (const scope of scopes.values()) scope.stop();
}

// A removed widget must not restart when its pending storage read finishes.
for (const widget of [timerWidget, pomodoroWidget]) {
  let finishRead: (value: unknown) => void = () => {};
  const read = new Promise((resolve) => { finishRead = resolve; });
  const scope = effectScope();
  const pending = scope.run(() => widget.component.setup({
    instanceId: "removed-while-loading",
    config: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
    data: {
      get: async <T>() => await read as T,
      set: async () => { throw new Error("disposed widgets must not write"); },
      delete: async () => {},
    },
  }));
  scope.stop();
  finishRead({ durationMs: 1_000, remainingMs: 1_000, running: true, deadlineAt: Date.now() + 1_000 });
  const model = await pending as TimerModel | PomodoroModel;
  assert.equal(model.running.value, false, `${widget.name} stays stopped after disposal`);
}

console.log("background widget assertions passed");
