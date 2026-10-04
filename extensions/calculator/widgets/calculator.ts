import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

/** `unit` is set only for a conversion and holds the target's symbol. */
export type EvalResult = { ok: true; value: number; unit?: string } | { ok: false };

export interface CalcHistoryEntry {
  id: string;
  expression: string;
  result: string;
}

export interface CalcState {
  history: CalcHistoryEntry[];
  expression: string;
  selectedIndex?: number | null;
}

export interface CalculatorModel {
  history: Ref<CalcHistoryEntry[]>;
  expression: Ref<string>;
  selectedIndex: Ref<number | null>;
  live: ComputedRef<string | null>;
  copied: Ref<boolean>;
  setExpression(value: string): void;
  selectHistory(index: number): void;
  commit(): boolean;
  clearAll(): void;
  /** Step through committed expressions like a shell: -1 older, 1 newer. */
  recall(step: -1 | 1): void;
  /** Copy the live result, or the last one when nothing is typed. */
  copy(): Promise<void>;
}

export const MAX_CALC_HISTORY = 50;
export const CALCULATOR_STATE_KEY = "state";

export function generateCalcHistoryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeHistoryEntry(raw: unknown): CalcHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const expression = typeof value.expression === "string" ? value.expression.trim() : "";
  const result = typeof value.result === "string" ? value.result : "";
  if (!expression || !result) return null;
  const id = typeof value.id === "string" && value.id ? value.id : generateCalcHistoryId();
  return { id, expression, result };
}

/** Normalize a persisted history list (newest last), dropping junk and capping its size. */
export function normalizeHistory(raw: unknown): CalcHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .map((item) => normalizeHistoryEntry(item))
    .filter((item): item is CalcHistoryEntry => item != null);
  return entries.length <= MAX_CALC_HISTORY
    ? entries
    : entries.slice(entries.length - MAX_CALC_HISTORY);
}

/** Accept both the current state object and the old history-only array. */
export function normalizeCalculatorState(raw: unknown): CalcState {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    const normalizedHistory = normalizeHistory(value.history);
    const selectedIndex =
      typeof value.selectedIndex === "number" &&
      Number.isInteger(value.selectedIndex) &&
      value.selectedIndex >= 0 &&
      value.selectedIndex < normalizedHistory.length
        ? value.selectedIndex
        : null;
    const history = selectedIndex == null ? normalizedHistory : normalizedHistory.slice(0, selectedIndex + 1);
    return {
      history,
      expression: typeof value.expression === "string" ? value.expression : "",
      selectedIndex,
    };
  }
  return { history: normalizeHistory(raw), expression: "", selectedIndex: null };
}

function baseHistoryIndex(history: CalcHistoryEntry[], selectedIndex?: number | null): number {
  return selectedIndex != null && selectedIndex >= 0 && selectedIndex < history.length
    ? selectedIndex
    : history.length - 1;
}

export function resolveExpression(
  history: CalcHistoryEntry[],
  expression: string,
  selectedIndex?: number | null,
): string {
  const trimmed = expression.trim();
  const previousResult = history[baseHistoryIndex(history, selectedIndex)]?.result;
  if (!previousResult) return trimmed;
  // A converted result reads "3.1 mi": an operator continues from its number,
  // "in km" converts it again.
  const [number, unit] = previousResult.split(" ");
  if (/^[+\-*/xX×]/.test(trimmed)) return `${number}${trimmed}`;
  if (unit && /^(in|to)\s/i.test(trimmed)) return `${previousResult} ${trimmed}`;
  return trimmed;
}

export function appendHistoryEntry(
  history: CalcHistoryEntry[],
  expression: string,
  selectedIndex?: number | null,
): { history: CalcHistoryEntry[]; entry: CalcHistoryEntry } | null {
  const trimmed = expression.trim();
  const evaluated = evaluate(resolveExpression(history, trimmed, selectedIndex));
  if (!evaluated.ok) return null;
  const entry: CalcHistoryEntry = {
    id: generateCalcHistoryId(),
    expression: trimmed,
    result: formatAnswer(evaluated),
  };
  return { history: normalizeHistory([...history, entry]), entry };
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(12)));
}

/**
 * The stored form of a result: "42", or "3.1068559611866697 mi" for a
 * conversion. Full precision, so continuing from it does not compound the
 * rounding — 1/3 then *3 is 1, and converting back lands on the start value.
 */
export function formatAnswer(result: { value: number; unit?: string }): string {
  const number = String(Object.is(result.value, -0) ? 0 : result.value);
  return result.unit ? `${number} ${result.unit}` : number;
}

/** What gets copied: rounded to 12 significant digits, so 0.1+0.2 reads 0.3. */
export function roundAnswer(answer: string): string {
  const [number = "", ...unit] = answer.split(" ");
  const value = Number(number);
  return Number.isFinite(value) ? [formatResult(value), ...unit].join(" ") : answer;
}

const NARROW_SPACE = String.fromCharCode(0x202f);

/**
 * What gets shown: rounded, with the integer digits grouped by narrow spaces
 * ("1 234 567.89"). Grouping is display only, so copied text pastes as a number.
 */
export function displayAnswer(answer: string): string {
  return roundAnswer(answer).replace(/^(-?)(\d+)/, (_, sign: string, digits: string) =>
    sign + digits.replace(/\B(?=(\d{3})+$)/g, NARROW_SPACE),
  );
}

interface Unit {
  symbol: string;
  dimension: string;
  /** base = value * factor + offset; only temperatures have an offset. */
  factor: number;
  offset: number;
}

// [dimension, factor to the dimension's base unit, symbol, ...other names].
// Names are matched case-insensitively, so bits go by "bit"/"Mbit" and "MB" always means bytes.
const UNIT_TABLE: Array<[string, number, string, ...string[]]> = [
  ["length", 0.001, "mm", "millimeter", "millimeters"],
  ["length", 0.01, "cm", "centimeter", "centimeters"],
  ["length", 1, "m", "meter", "meters", "metre", "metres"],
  ["length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres"],
  ["length", 0.0254, "in", "inch", "inches", "zoll"],
  ["length", 0.3048, "ft", "foot", "feet", "fuß", "fuss"],
  ["length", 0.9144, "yd", "yard", "yards"],
  ["length", 1609.344, "mi", "mile", "miles", "meile", "meilen"],
  ["length", 1852, "nmi", "seemeile", "seemeilen"],
  ["area", 1e-4, "cm²", "cm2"],
  ["area", 1, "m²", "m2", "qm", "sqm"],
  ["area", 1e6, "km²", "km2"],
  ["area", 1e4, "ha", "hectare", "hectares", "hektar"],
  ["area", 4046.8564224, "ac", "acre", "acres"],
  ["area", 0.09290304, "ft²", "ft2", "sqft"],
  ["volume", 0.001, "ml", "milliliter", "milliliters"],
  ["volume", 0.01, "cl"],
  ["volume", 0.1, "dl"],
  ["volume", 1, "l", "liter", "liters", "litre", "litres"],
  ["volume", 1000, "m³", "m3"],
  ["volume", 3.785411784, "gal", "gallon", "gallons"],
  ["mass", 1e-6, "mg"],
  ["mass", 0.001, "g", "gram", "grams", "gramm"],
  ["mass", 1, "kg", "kilogram", "kilograms", "kilo"],
  ["mass", 1000, "t", "tonne", "tonnes", "tonnen"],
  ["mass", 0.028349523125, "oz", "ounce", "ounces", "unze"],
  ["mass", 0.45359237, "lb", "lbs", "pound", "pounds", "pfund"],
  ["time", 0.001, "ms"],
  ["time", 1, "s", "sec", "second", "seconds", "sek", "sekunde", "sekunden"],
  ["time", 60, "min", "minute", "minutes", "minuten"],
  ["time", 3600, "h", "hr", "hour", "hours", "std", "stunde", "stunden"],
  ["time", 86400, "d", "day", "days", "tag", "tage"],
  ["time", 604800, "wk", "week", "weeks", "woche", "wochen"],
  // A Julian year (365.25 days), the usual average for "years in seconds".
  ["time", 31557600, "yr", "year", "years", "jahr", "jahre"],
  ["data", 0.125, "bit", "bits"],
  ["data", 125, "kbit"],
  ["data", 125_000, "Mbit"],
  ["data", 125_000_000, "Gbit"],
  ["data", 1, "B", "byte", "bytes"],
  ["data", 1e3, "KB", "kilobyte", "kilobytes"],
  ["data", 1e6, "MB", "megabyte", "megabytes"],
  ["data", 1e9, "GB", "gigabyte", "gigabytes"],
  ["data", 1e12, "TB", "terabyte", "terabytes"],
  ["data", 1024, "KiB"],
  ["data", 1024 ** 2, "MiB"],
  ["data", 1024 ** 3, "GiB"],
  ["data", 1024 ** 4, "TiB"],
  ["speed", 1, "m/s"],
  ["speed", 1 / 3.6, "km/h", "kmh", "kph"],
  ["speed", 0.44704, "mph"],
  ["speed", 1852 / 3600, "kn", "knot", "knots"],
];

const UNITS = new Map<string, Unit>();
for (const [dimension, factor, symbol, ...names] of UNIT_TABLE) {
  for (const name of [symbol, ...names]) UNITS.set(name.toLowerCase(), { symbol, dimension, factor, offset: 0 });
}
// Kelvin is the base; "°C", "C" and "celsius" all resolve because the degree sign is dropped.
const TEMPERATURES: Array<[string, number, number, ...string[]]> = [
  ["°C", 1, 273.15, "c", "celsius"],
  ["°F", 5 / 9, 273.15 - (32 * 5) / 9, "f", "fahrenheit"],
  ["K", 1, 0, "k", "kelvin"],
];
for (const [symbol, factor, offset, ...names] of TEMPERATURES) {
  for (const name of names) UNITS.set(name, { symbol, dimension: "temperature", factor, offset });
}

function findUnit(name: string): Unit | undefined {
  return UNITS.get(name.toLowerCase().replace(/^°/, ""));
}

// "<amount> <unit> in|to <unit>". A unit starts with anything but a digit or an
// operator, so "25km" splits as 25 + km rather than 2 + "5km".
const UNIT_NAME = String.raw`[^\s\d.,+\-*/()][^\s]*`;
const CONVERSION = new RegExp(String.raw`^(.+?)\s*(${UNIT_NAME})\s+(?:in|to)\s+(${UNIT_NAME})$`, "i");

/**
 * Evaluate arithmetic, or a unit conversion such as "5 km in mi", without
 * eval/Function, failing closed on malformed input.
 */
export function evaluate(expression: string): EvalResult {
  const trimmed = expression.trim();
  // The palette evaluates every query, and CONVERSION backtracks quadratically
  // on a long miss — a pasted blob would stall typing. No conversion is this long.
  const match = trimmed.length <= 200 ? CONVERSION.exec(trimmed) : null;
  if (!match) return evaluateArithmetic(expression);
  const [, amountText = "", fromName = "", toName = ""] = match;
  const from = findUnit(fromName);
  const to = findUnit(toName);
  const amount = evaluateArithmetic(amountText);
  if (!from || !to || from.dimension !== to.dimension || !amount.ok) return { ok: false };
  const value = (amount.value * from.factor + from.offset - to.offset) / to.factor;
  return Number.isFinite(value) ? { ok: true, value, unit: to.symbol } : { ok: false };
}

function evaluateArithmetic(expression: string): EvalResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false };

  let tokens: Token[];
  try {
    tokens = tokenize(trimmed);
  } catch {
    return { ok: false };
  }
  if (tokens.length === 0) return { ok: false };

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr(): number {
    let left = parseTerm();
    while (true) {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "+" && token.value !== "-")) break;
      consume();
      const right = parseTerm();
      left = token.value === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (!token || token.kind !== "op" || (token.value !== "*" && token.value !== "/")) break;
      consume();
      const right = parseUnary();
      if (token.value === "/") {
        if (right === 0) throw new Error("division by zero");
        left /= right;
      } else {
        left *= right;
      }
    }
    return left;
  }

  function parseUnary(): number {
    const token = peek();
    if (token?.kind === "op" && token.value === "-") {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) throw new Error("unexpected end of expression");
    if (token.kind === "number") {
      consume();
      return token.value;
    }
    if (token.kind === "lparen") {
      consume();
      const value = parseExpr();
      if (consume()?.kind !== "rparen") throw new Error("missing closing parenthesis");
      return value;
    }
    throw new Error("expected a number or parenthesis");
  }

  try {
    const value = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    // "3x4" and "3×4" read as multiplication, the way people type it.
    if (char === "x" || char === "X" || char === "×") {
      tokens.push({ kind: "op", value: "*" });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ kind: char === "(" ? "lparen" : "rparen" });
      index += 1;
      continue;
    }
    // A comma is a decimal point too ("3,5"); nothing else in the grammar uses it.
    if ((char >= "0" && char <= "9") || char === "." || char === ",") {
      let end = index;
      let sawDot = false;
      while (end < input.length) {
        const next = input[end]!;
        if (next >= "0" && next <= "9") {
          end += 1;
        } else if ((next === "." || next === ",") && !sawDot) {
          sawDot = true;
          end += 1;
        } else {
          break;
        }
      }
      // String() writes tiny and huge results as "1e-7"; they must read back in.
      const exponent = /^e[+-]?\d+/i.exec(input.slice(end));
      if (exponent) end += exponent[0].length;
      const raw = input.slice(index, end).replace(",", ".");
      if (raw === ".") throw new Error("invalid number");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("invalid number");
      tokens.push({ kind: "number", value });
      index = end;
      continue;
    }
    throw new Error("unsupported character");
  }

  return tokens;
}

export const calculatorWidget = defineWidget<Record<string, never>>({
  name: "calculator",
  displayName: "Calculator",
  description: "Arithmetic and unit conversions.",
  defaultSize: { w: 2, h: 3 },
  mode: "both",
  capabilities: { clipboard: true },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<CalculatorModel> {
      const history = ref<CalcHistoryEntry[]>([]);
      const expression = ref("");
      const selectedIndex = ref<number | null>(null);
      let hydrated = false;
      let persistence = Promise.resolve();

      const persist = () => {
        const state: CalcState = {
          history: history.value.map((entry) => ({ ...entry })),
          expression: expression.value,
          selectedIndex: selectedIndex.value,
        };
        persistence = persistence.catch(() => undefined).then(() => ctx.data.set(CALCULATOR_STATE_KEY, state));
        return persistence;
      };

      // Register before hydration so the runtime's effect scope owns the
      // watcher even though setup crosses an async storage boundary.
      watch(
        [history, expression, selectedIndex],
        () => {
          if (hydrated) void persist().catch(() => undefined);
        },
        { deep: true },
      );

      const saved = normalizeCalculatorState(await ctx.data.get(CALCULATOR_STATE_KEY));
      history.value = saved.history;
      expression.value = saved.expression;
      selectedIndex.value = saved.selectedIndex ?? null;
      hydrated = true;

      const live = computed(() => {
        const trimmed = expression.value.trim();
        if (!trimmed) {
          return selectedIndex.value == null ? null : history.value[selectedIndex.value]?.result ?? null;
        }
        const result = evaluate(resolveExpression(history.value, trimmed, selectedIndex.value));
        return result.ok ? formatAnswer(result) : null;
      });

      // Which history row ↑/↓ shows; null while the input holds the user's own
      // draft, which is kept aside so stepping back past the newest restores it.
      let recallIndex: number | null = null;
      let recallDraft = "";

      const recall = (step: -1 | 1) => {
        const next = Math.max(0, (recallIndex ?? history.value.length) + step);
        if (next >= history.value.length) {
          if (recallIndex !== null) expression.value = recallDraft;
          recallIndex = null;
          return;
        }
        if (recallIndex === null) recallDraft = expression.value;
        recallIndex = next;
        expression.value = history.value[next]!.expression;
      };

      const setExpression = (value: string) => {
        recallIndex = null;
        expression.value = value;
      };

      const selectHistory = (index: number) => {
        if (index < 0 || index >= history.value.length) return;
        recallIndex = null;
        history.value = history.value.slice(0, index + 1);
        selectedIndex.value = index;
        expression.value = "";
      };

      const commit = () => {
        const previousIndex = selectedIndex.value;
        const next = appendHistoryEntry(history.value, expression.value, previousIndex);
        if (!next) return false;
        recallIndex = null;
        history.value = next.history;
        expression.value = "";
        selectedIndex.value = previousIndex == null ? null : next.history.length - 1;
        return true;
      };

      const clearAll = () => {
        recallIndex = null;
        if (history.value.length > 0) history.value = [];
        selectedIndex.value = null;
      };

      const copied = ref(false);
      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      const copy = async () => {
        const text = live.value ?? history.value[history.value.length - 1]?.result;
        if (!text || !ctx.clipboard) return;
        try {
          await ctx.clipboard.writeText(roundAnswer(text));
          copied.value = true;
          clearTimeout(copiedTimer);
          copiedTimer = setTimeout(() => { copied.value = false; }, 1_000);
        } catch {
          // Clipboard failures are non-fatal; the result stays on screen to copy again.
        }
      };

      return {
        history, expression, selectedIndex, live, copied,
        setExpression, selectHistory, commit, clearAll, recall, copy,
      };
    },
  },
});
