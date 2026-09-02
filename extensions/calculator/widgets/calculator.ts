import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

export type EvalResult = { ok: true; value: number } | { ok: false };

export interface CalcHistoryEntry {
  id: string;
  expression: string;
  result: string;
}

export interface CalcState {
  history: CalcHistoryEntry[];
  expression: string;
}

export interface CalculatorModel {
  history: Ref<CalcHistoryEntry[]>;
  expression: Ref<string>;
  live: ComputedRef<string | null>;
  setExpression(value: string): void;
  commit(): boolean;
  clearAll(): void;
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
    return {
      history: normalizeHistory(value.history),
      expression: typeof value.expression === "string" ? value.expression : "",
    };
  }
  return { history: normalizeHistory(raw), expression: "" };
}

export function appendHistoryEntry(
  history: CalcHistoryEntry[],
  expression: string,
): { history: CalcHistoryEntry[]; entry: CalcHistoryEntry } | null {
  const trimmed = expression.trim();
  const evaluated = evaluate(trimmed);
  if (!evaluated.ok) return null;
  const entry: CalcHistoryEntry = {
    id: generateCalcHistoryId(),
    expression: trimmed,
    result: formatResult(evaluated.value),
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

/** Evaluate arithmetic without eval/Function and fail closed on malformed input. */
export function evaluate(expression: string): EvalResult {
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
    if (char === "(" || char === ")") {
      tokens.push({ kind: char === "(" ? "lparen" : "rparen" });
      index += 1;
      continue;
    }
    if ((char >= "0" && char <= "9") || char === ".") {
      let end = index;
      let sawDot = false;
      while (end < input.length) {
        const next = input[end]!;
        if (next >= "0" && next <= "9") {
          end += 1;
        } else if (next === "." && !sawDot) {
          sawDot = true;
          end += 1;
        } else {
          break;
        }
      }
      const raw = input.slice(index, end);
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
  description: "Quick arithmetic calculator.",
  defaultSize: { w: 2, h: 3 },
  mode: "both",
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<CalculatorModel> {
      const history = ref<CalcHistoryEntry[]>([]);
      const expression = ref("");
      let hydrated = false;
      let persistence = Promise.resolve();

      const persist = () => {
        const state: CalcState = {
          history: history.value.map((entry) => ({ ...entry })),
          expression: expression.value,
        };
        persistence = persistence.catch(() => undefined).then(() => ctx.data.set(CALCULATOR_STATE_KEY, state));
        return persistence;
      };

      // Register before hydration so the runtime's effect scope owns the
      // watcher even though setup crosses an async storage boundary.
      watch(
        [history, expression],
        () => {
          if (hydrated) void persist().catch(() => undefined);
        },
        { deep: true },
      );

      const saved = normalizeCalculatorState(await ctx.data.get(CALCULATOR_STATE_KEY));
      history.value = saved.history;
      expression.value = saved.expression;
      hydrated = true;

      const live = computed(() => {
        const result = evaluate(expression.value);
        return result.ok ? formatResult(result.value) : null;
      });

      const setExpression = (value: string) => {
        expression.value = value;
      };

      const commit = () => {
        const next = appendHistoryEntry(history.value, expression.value);
        if (!next) return false;
        history.value = next.history;
        expression.value = "";
        return true;
      };

      const clearAll = () => {
        if (history.value.length > 0) history.value = [];
      };

      return { history, expression, live, setExpression, commit, clearAll };
    },
  },
});
