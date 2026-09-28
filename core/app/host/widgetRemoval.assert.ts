import { createWidgetRemoval } from "./widgetRemoval";

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(message);
}

const removal = createWidgetRemoval();
const cancelled = removal.request("notes", "card");
removal.cancel();
equal(await cancelled, false, "cancel does not authorize deletion");
equal(removal.pending.value, null, "cancel clears the controls");

const first = removal.request("notes", "card");
const stale = removal.pending.value!;
const second = removal.request("timer", "palette");
equal(await first, false, "a replacement cancels the earlier widget's deletion");
removal.answer(stale, true);
equal(removal.pending.value?.instanceId, "timer", "stale confirmation cannot delete the new target");
removal.answer(stale, false);
equal(removal.pending.value?.instanceId, "timer", "unmounting old controls cannot cancel the new target");

const current = removal.pending.value!;
equal(current.surface, "palette", "hidden widgets can confirm in the palette");
removal.answer(current, true);
equal(await second, true, "the explicit current confirmation authorizes deletion");
equal(removal.pending.value, null, "confirmation is consumed once");
removal.answer(current, true);
equal(removal.pending.value, null, "a second click cannot reuse the confirmation");
console.log("widget removal confirmation assertions passed");
