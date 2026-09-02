import { effectScope, nextTick } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import calculatorExtension from "../extension";
import {
  CALCULATOR_STATE_KEY,
  MAX_CALC_HISTORY,
  appendHistoryEntry,
  calculatorWidget,
  evaluate,
  normalizeCalculatorState,
  normalizeHistory,
  normalizeHistoryEntry,
  type CalcState,
  type CalculatorModel,
} from "./calculator";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function flushPersistence(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

assert(calculatorExtension.name === "calculator", "the port keeps the calculator extension id");
const precedence = evaluate("2+3*4");
const unary = evaluate("-(2+3)");
assert(precedence.ok && precedence.value === 14, "operator precedence is kept");
assert(unary.ok && unary.value === -5, "unary minus is kept");
assert(!evaluate("1/0").ok, "division by zero fails closed");
assert(normalizeHistoryEntry(null) === null, "invalid history rows are dropped");

const many = Array.from({ length: MAX_CALC_HISTORY + 5 }, (_, index) => ({
  id: `id-${index}`,
  expression: `${index}+0`,
  result: String(index),
}));
const capped = normalizeHistory(many);
assert(capped.length === MAX_CALC_HISTORY, "history remains bounded");
assert(capped[0]?.expression === "5+0", "the newest bounded entries survive");

const legacy = normalizeCalculatorState([{ expression: "1+1", result: "2" }]);
assert(legacy.history.length === 1 && legacy.expression === "", "history-only legacy saves normalize");
const saved = normalizeCalculatorState({ history: [], expression: "12+7" });
assert(saved.expression === "12+7", "the draft expression normalizes with history");
assert(appendHistoryEntry([], "not math") === null, "invalid input is not committed");

function memoryData(initial?: CalcState): WidgetContext<Record<string, never>>["data"] {
  const values = new Map<string, unknown>();
  if (initial) values.set(CALCULATOR_STATE_KEY, initial);
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async delete(key: string): Promise<void> {
      values.delete(key);
    },
  };
}

const data = memoryData({
  history: [{ id: "saved", expression: "1+1", result: "2" }],
  expression: "6*7",
});
const context = {
  instanceId: "calculator-assert",
  config: {},
  data,
} satisfies WidgetContext<Record<string, never>>;

const scope = effectScope();
const model = await scope.run(() => calculatorWidget.component.setup(context)) as CalculatorModel;
assert(model.history.value.length === 1, "setup restores persisted history");
assert(model.expression.value === "6*7" && model.live.value === "42", "setup restores the draft");

model.setExpression("100+10");
assert(model.commit(), "a valid expression commits");
assert(
  model.history.value[model.history.value.length - 1]?.result === "110",
  "commit appends the formatted result",
);
assert(model.expression.value === "", "commit clears the draft");
await flushPersistence();
const persisted = await data.get<CalcState>(CALCULATOR_STATE_KEY);
assert(
  persisted?.history[persisted.history.length - 1]?.result === "110",
  "history persists through ctx.data",
);

model.clearAll();
await flushPersistence();
assert((await data.get<CalcState>(CALCULATOR_STATE_KEY))?.history.length === 0, "clear persists");
scope.stop();

const duplicateScope = effectScope();
const duplicate = await duplicateScope.run(() => calculatorWidget.component.setup({
  ...context,
  instanceId: "calculator-duplicate",
  data: memoryData(),
})) as CalculatorModel;
assert(duplicate.history.value.length === 0, "a duplicate starts with empty history as before");
assert(duplicate.expression.value === "", "a duplicate starts without the source draft");
duplicateScope.stop();

console.log("calculator.assert.ts: ok");
