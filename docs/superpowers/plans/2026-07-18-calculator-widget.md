# Calculator Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a buttonless calculator with a shared pure TypeScript evaluator: live result in the command palette while typing, plus a Calculator widget with a text field and live result.

**Architecture:** Recursive-descent evaluator in `calculatorLogic.ts` (no `eval()`). Palette and widget call `evaluate` / `formatResult` independently. Client-only registry entry, same contract path as `ClockWidget`.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Expression language V1 only: `+ - * /`, parentheses, decimals, whitespace, unary minus — no `%`, `^`, functions, constants
- Always try to evaluate; show result only on `{ ok: true }` — Enter stays normal command selection
- No sync between palette query and widget text field
- No Tab→widget, no history, no clipboard copy in V1
- No `eval()` / `Function()` / Rust backend
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert script + `npx vue-tsc --noEmit` + manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-calculator-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/calculatorLogic.ts` | Tokenize → parse → evaluate; `formatResult` |
| `src/widgets/CalculatorWidget.vue` | Text field + live result UI |
| `src/widgets/registry.ts` | Register `calculator` |
| `src/palette/CommandPalette.vue` | Live result line under search input |

---

### Task 1: Pure calculator logic

**Files:**
- Create: `src/widgets/calculatorLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type EvalResult = { ok: true; value: number } | { ok: false }`
  - `export function evaluate(expression: string): EvalResult`
  - `export function formatResult(value: number): string`

- [ ] **Step 1: Create `src/widgets/calculatorLogic.ts`**

```ts
/**
 * Safe arithmetic evaluator for Kavibay calculator (palette + widget).
 * Supports + - * /, parentheses, decimals, whitespace, unary minus.
 * No eval() / Function().
 */

export type EvalResult = { ok: true; value: number } | { ok: false };

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

/** Compact display without noisy trailing zeros. */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(12)));
}

/** Evaluate a full expression; fails closed on any error. */
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

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token | undefined {
    return tokens[pos++];
  }

  /** expr = term (('+'|'-') term)* */
  function parseExpr(): number {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (!t || t.kind !== "op" || (t.value !== "+" && t.value !== "-")) break;
      consume();
      const right = parseTerm();
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }

  /** term = unary (('*'|'/') unary)* */
  function parseTerm(): number {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (!t || t.kind !== "op" || (t.value !== "*" && t.value !== "/")) break;
      consume();
      const right = parseUnary();
      if (t.value === "/") {
        if (right === 0) throw new Error("div0");
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  /** unary = '-' unary | primary */
  function parseUnary(): number {
    const t = peek();
    if (t && t.kind === "op" && t.value === "-") {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  }

  /** primary = number | '(' expr ')' */
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error("eof");
    if (t.kind === "number") {
      consume();
      return t.value;
    }
    if (t.kind === "lparen") {
      consume();
      const v = parseExpr();
      const close = consume();
      if (!close || close.kind !== "rparen") throw new Error("paren");
      return v;
    }
    throw new Error("primary");
  }

  try {
    const value = parseExpr();
    if (pos !== tokens.length) return { ok: false };
    if (!Number.isFinite(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** Lex numbers, operators, and parentheses; reject anything else. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      let sawDot = false;
      while (j < input.length) {
        const c = input[j];
        if (c >= "0" && c <= "9") {
          j++;
          continue;
        }
        if (c === "." && !sawDot) {
          sawDot = true;
          j++;
          continue;
        }
        break;
      }
      const raw = input.slice(i, j);
      if (raw === "." || raw === "") throw new Error("number");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("number");
      tokens.push({ kind: "number", value });
      i = j;
      continue;
    }
    throw new Error("char");
  }

  return tokens;
}
```

- [ ] **Step 2: Sanity-check with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e "
import { evaluate, formatResult } from './src/widgets/calculatorLogic.ts';
function assertEq(actual, expected, label) {
  if (actual !== expected) { console.error('FAIL', label, actual, expected); process.exit(1); }
}
function assertOk(expr, expected) {
  const r = evaluate(expr);
  if (!r.ok) { console.error('FAIL ok', expr); process.exit(1); }
  assertEq(r.value, expected, expr);
}
function assertFail(expr) {
  const r = evaluate(expr);
  if (r.ok) { console.error('FAIL should fail', expr, r.value); process.exit(1); }
}
assertOk('12*7+3', 87);
assertOk('(1+2)*3', 9);
assertOk('-5+2', -3);
assertOk('12*-2', -24);
assertOk('  8 / 2  ', 4);
assertOk('.5+1.5', 2);
assertOk('2+3*4', 14);
assertFail('1/0');
assertFail('12*');
assertFail('open-terminal');
assertFail('');
assertEq(formatResult(12.5), '12.5');
assertEq(formatResult(87), '87');
console.log('ok');
"
```

Expected: `ok`  
If Node cannot import `.ts`, use `npx tsx` if available, or skip to Step 3 and spot-check in the UI after Task 2–3.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: no errors related to `calculatorLogic.ts`

- [ ] **Step 4: Skip commit**

---

### Task 2: Calculator widget + registry

**Files:**
- Create: `src/widgets/CalculatorWidget.vue`
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `evaluate`, `formatResult` from `./calculatorLogic`; `WidgetProps` from `./types`
- Produces: registry entry `id: "calculator"`, title `"Calculator"`, position `{ x: 480, y: 380 }` (below Pomodoro)

- [ ] **Step 1: Create `src/widgets/CalculatorWidget.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import type { WidgetProps } from "./types";
import { evaluate, formatResult } from "./calculatorLogic";

// Client-only widget (same contract as ClockWidget — props unused for loading).
defineProps<WidgetProps>();

const expression = ref("");

const live = computed(() => {
  const result = evaluate(expression.value);
  if (!result.ok) return null;
  return formatResult(result.value);
});
</script>

<template>
  <div class="calc">
    <input
      v-model="expression"
      class="calc-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      placeholder="12*7+3"
      aria-label="Expression"
    />
    <p v-if="live !== null" class="calc-result">= {{ live }}</p>
  </div>
</template>

<style scoped>
.calc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
}

.calc-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.95);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.calc-input:focus {
  border-color: rgba(255, 255, 255, 0.28);
}

.calc-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.calc-result {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.85);
}
</style>
```

- [ ] **Step 2: Register in `src/widgets/registry.ts`**

Add import:

```ts
import CalculatorWidget from "./CalculatorWidget.vue";
```

Append registry entry after `pomodoro`:

```ts
  {
    id: "calculator",
    title: "Calculator",
    // Rechts unter Pomodoro (Mittelpunkt-Offsets).
    position: { x: 480, y: 380 },
    component: CalculatorWidget,
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 4: Manual UI check**

Run: `npm run tauri dev` (or `npm run dev` for browser-only)  
Add Calculator via palette `+` menu → type `12*7+3` → see `= 87`; clear / type garbage → result hides. No digit/operator buttons.

- [ ] **Step 5: Skip commit**

---

### Task 3: Live result in Command Palette

**Files:**
- Modify: `src/palette/CommandPalette.vue`

**Interfaces:**
- Consumes: `evaluate`, `formatResult` from `../widgets/calculatorLogic`
- Produces: computed live result string shown under the search input when evaluation succeeds; Enter / arrow keys unchanged

- [ ] **Step 1: Wire evaluate into `CommandPalette.vue` script**

Add import near the top of `<script setup>`:

```ts
import { evaluate, formatResult } from "../widgets/calculatorLogic";
```

After `const results = computed(...)`, add:

```ts
/** Live calculator result for the current query; null when not a valid expression. */
const calcDisplay = computed(() => {
  const result = evaluate(query.value);
  if (!result.ok) return null;
  return formatResult(result.value);
});
```

Do **not** change `onKeydown` Enter handling.

- [ ] **Step 2: Render result line in the template**

Place this block **immediately after** the `<input ... />` and **before** `<ul ref="listEl" ...>`:

```vue
    <div v-if="calcDisplay !== null" class="palette-calc" aria-live="polite">
      <span class="palette-calc-eq">=</span>
      <span class="palette-calc-value">{{ calcDisplay }}</span>
    </div>
```

- [ ] **Step 3: Add scoped styles**

Append inside the existing `<style scoped>` block:

```css
.palette-calc {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 20px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.palette-calc-eq {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.45);
}

.palette-calc-value {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.95);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Manual acceptance checks**

With the app running:

1. Hotkey → type `12*7+3` → live `= 87` under input; command list still visible/selectable; Enter runs selected command (palette may hide)
2. Type `open` or `12*` → no calculator line; fuzzy commands work
3. Type `(1+2)*3` → `= 9`; type `-5+2` → `= -3`; type `1/0` → no calculator line
4. Calculator widget (from Task 2) still works independently of palette query

- [ ] **Step 6: Skip commit**

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Shared pure evaluator, no eval/Rust | Task 1 |
| `+ - * /`, parens, decimals, unary, whitespace | Task 1 |
| Div/0 → fail | Task 1 |
| `formatResult` compact display | Task 1 |
| Calculator widget text field + live result | Task 2 |
| Registry `calculator` | Task 2 |
| Palette live result on successful eval | Task 3 |
| Enter unchanged / fail → no calc UI | Task 3 |
| Out of scope (Tab, history, copy, sync) | Not implemented |

No placeholders. Types consistent: `EvalResult`, `evaluate`, `formatResult` across all tasks.
