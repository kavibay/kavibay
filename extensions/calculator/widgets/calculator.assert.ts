import { effectScope, nextTick } from "vue";
import type { ClipboardCapability, WidgetContext } from "@sdk/contract/sdk";
import calculatorExtension from "../extension";
import {
  CALCULATOR_STATE_KEY,
  MAX_CALC_HISTORY,
  appendHistoryEntry,
  calculatorWidget,
  evaluate,
  displayAnswer,
  formatAnswer,
  roundAnswer,
  normalizeCalculatorState,
  normalizeHistory,
  normalizeHistoryEntry,
  resolveExpression,
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
for (const input of ["2+3x4", "2+3X4", "2+3×4"]) {
  const times = evaluate(input);
  assert(times.ok && times.value === 14, `${input} multiplies`);
}
assert(resolveExpression([{ id: "a", expression: "6", result: "6" }], "x2") === "6x2", "x continues from the previous result");
assert(unary.ok && unary.value === -5, "unary minus is kept");
assert(!evaluate("1/0").ok, "division by zero fails closed");
assert(normalizeHistoryEntry(null) === null, "invalid history rows are dropped");
const decimalComma = evaluate("3,5*2");
assert(decimalComma.ok && decimalComma.value === 7, "a comma is a decimal point");

function answer(input: string): string | null {
  const result = evaluate(input);
  return result.ok ? roundAnswer(formatAnswer(result)) : null;
}
for (const [input, expected] of [
  ["5 km in mi", "3.10685596119 mi"],
  ["25km to m", "25000 m"],
  ["5 in in cm", "12.7 cm"],
  ["(2+3)*1,5 kg in g", "7500 g"],
  ["20 °C in F", "68 °F"],
  ["-40 celsius in fahrenheit", "-40 °F"],
  ["0 K in C", "-273.15 °C"],
  ["1,5 GB in MB", "1500 MB"],
  ["100 Mbit in MB", "12.5 MB"],
  ["2 GiB in MiB", "2048 MiB"],
  ["100 km/h in mph", "62.1371192237 mph"],
  ["90 min in h", "1.5 h"],
  ["1 ha in qm", "10000 m²"],
  ["2 Stunden in min", "120 min"],
] as const) {
  assert(answer(input) === expected, `${input} converts to ${expected}, got ${answer(input)}`);
}
for (const input of ["5 km in kg", "5 km", "5 foo in mi", "km in mi", "chrome"]) {
  assert(!evaluate(input).ok, `${input} is not a result`);
}
const ns = String.fromCharCode(0x202f);
assert(displayAnswer("1234567.891") === `1${ns}234${ns}567.891`, "integer digits are grouped");
assert(displayAnswer("-1234 mi") === `-1${ns}234 mi`, "a sign and a unit survive grouping");
assert(displayAnswer("123") === "123" && displayAnswer("1e+21") === "1e+21", "short and exponent results stay as they are");
assert(displayAnswer("0.30000000000000004") === "0.3", "display rounds away float noise");
const exponent = evaluate("1e-7*2");
assert(exponent.ok && exponent.value === 2e-7, "exponent results read back in");
const converted = [{ id: "a", expression: "5 km in mi", result: "3.1 mi" }];
assert(resolveExpression(converted, "*2") === "3.1*2", "an operator continues from a converted number");
assert(resolveExpression(converted, "in km") === "3.1 mi in km", "in converts a converted result again");
assert(resolveExpression([{ id: "a", expression: "5", result: "5" }], "in km") === "in km", "in needs a unit to continue from");

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
const restoredSelection = normalizeCalculatorState({
  history: [
    { id: "selected", expression: "1+1", result: "2" },
    { id: "later", expression: "+1", result: "3" },
  ],
  expression: "",
  selectedIndex: 0,
});
assert(restoredSelection.history.length === 1, "selected state drops later history");
assert(appendHistoryEntry([], "not math") === null, "invalid input is not committed");
assert(resolveExpression([{ id: "previous", expression: "19*10", result: "190" }], "+1") === "190+1", "continuations use the previous result");
const continuation = appendHistoryEntry([{ id: "previous", expression: "19*10", result: "190" }], "+1");
assert(continuation?.entry.expression === "+1" && continuation.entry.result === "191", "continuations keep the typed expression");
const selectedContinuation = appendHistoryEntry(
  [
    { id: "first", expression: "19*10", result: "190" },
    { id: "later", expression: "-100", result: "90" },
  ],
  "+2",
  0,
);
assert(
  selectedContinuation?.entry.result === "192" &&
    selectedContinuation.history[1]?.result === "90" &&
    selectedContinuation.history[2]?.result === "192",
  "a continuation uses the selected history point",
);

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
const copiedTexts: string[] = [];
const clipboard = {
  async writeText(text: string) {
    copiedTexts.push(text);
  },
} as Partial<ClipboardCapability> as ClipboardCapability;
const context = {
  instanceId: "calculator-assert",
  config: {},
  data,
  clipboard,
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
model.setExpression("+5");
assert(model.live.value === "115", "a leading operator continues from the previous result");
assert(model.commit(), "a continuation commits");
assert(model.history.value[model.history.value.length - 1]?.result === "115", "the continuation result is committed");
await flushPersistence();
const persisted = await data.get<CalcState>(CALCULATOR_STATE_KEY);
assert(
  persisted?.history[persisted.history.length - 1]?.result === "115",
  "history persists through ctx.data",
);

model.selectHistory(1);
assert(
  model.selectedIndex.value === 1 &&
    model.history.value.length === 2 &&
    model.expression.value === "" &&
    model.live.value === "110",
  "selecting history restores that calculation state",
);
model.setExpression("+5");
assert(model.live.value === "115", "continuations use the selected history state");
assert(model.commit(), "a continuation from history commits");
assert(
  model.selectedIndex.value === 2 &&
    model.history.value[2]?.result === "115" &&
    model.history.value.length === 3,
  "new history continues from the selected calculation",
);

model.setExpression("draft");
model.recall(-1);
assert(model.expression.value === "+5", "up recalls the newest expression");
model.recall(-1);
model.recall(-1);
model.recall(-1);
assert(model.expression.value === "1+1", "up stops at the oldest expression");
model.recall(1);
assert(model.expression.value === "100+10", "down steps back towards the newest");
model.recall(1);
model.recall(1);
assert(model.expression.value === "draft", "down past the newest restores the draft");

model.setExpression("1/3");
assert(model.commit(), "a fraction commits");
model.setExpression("*3");
assert(model.live.value === "1", "continuing does not compound the rounding");
model.setExpression("");
model.selectHistory(1);
model.setExpression("5 km in mi");
assert(model.commit(), "a conversion commits");
model.setExpression("in km");
assert(model.live.value === "5 km", "converting back lands on the start value");

model.setExpression("1,5 GB in MB");
assert(model.live.value === "1500 MB", "the live result carries the unit");
await model.copy();
model.setExpression("");
await model.copy();
assert(
  copiedTexts[0] === "1500 MB" && copiedTexts[1] === "3.10685596119 mi" && model.copied.value,
  "copy takes the live result, or the selected one when nothing is typed",
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
