# Calculator Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Shared pure TypeScript evaluator with independent palette and widget UIs (approach 1)

## Goal

Add a buttonless calculator to Kavibay: type an expression, see a live result. The same evaluation works in the command palette while typing and in a dedicated Calculator widget (text field only).

## Requirements

### Behavior — Command Palette

- On every query change, attempt to evaluate the query as an expression
- On success: show a live result (e.g. `= 87`)
- On failure: show nothing calculator-specific; normal command fuzzy search continues
- **Enter** keeps normal command selection behavior (no copy, no calculator special-case)

### Behavior — Calculator Widget

- Registry widget `calculator`, title “Calculator”, inside existing `WidgetCard`
- Single text field for the expression (no digit/operator buttons)
- Live result display that updates as the user types
- Own state, not synced with the palette query
- Client-only (no `backendCommand`, no settings panel in V1)

### Expression language (V1)

| Supported | Notes |
|-----------|--------|
| `+ - * /` | Binary operators |
| Parentheses | `(1+2)*3` |
| Decimals | `12.5`, `.5` |
| Whitespace | Ignored between tokens |
| Unary minus | `-3`, `12*-2` |

Precedence: `*` `/` before `+` `-`. Division by zero → evaluation fails (no result shown).

### Detection rule

Always try to parse/evaluate. Only show the live result when evaluation succeeds. Incomplete or non-math queries simply fail and leave the palette unchanged.

### Visual

- Palette: compact result line under the search input (`=` + value); command list below unchanged
- Widget: text field primary; live result secondary below/beside it
- Invalid or empty input: hide result (no error text)
- Match existing dark glass `WidgetCard` chrome; no custom chrome

### Number formatting

Display values without noisy trailing zeros (e.g. `12.5` not `12.500000`). Prefer a compact, human-readable representation.

## Architecture

### Approach

One pure TypeScript module owns tokenization, parsing, and evaluation. No `eval()`, no `Function()`, no Rust. Palette and widget call the same function with independent UI state.

### Frontend

| File | Role |
|------|------|
| `src/widgets/calculatorLogic.ts` | Pure eval: tokenize → parse → evaluate; `{ ok: true, value } \| { ok: false }` |
| `src/widgets/CalculatorWidget.vue` | Text field + live result |
| `src/widgets/registry.ts` | Register `calculator` (no backend / refresh) |
| `src/palette/CommandPalette.vue` | Query → evaluate; render result line on success |

Default widget offset: place near existing right-side widgets (e.g. below Pomodoro); exact offset chosen at implementation to avoid overlap.

### Eval contract

```ts
type EvalResult =
  | { ok: true; value: number }
  | { ok: false };

function evaluate(expression: string): EvalResult;
```

- Empty string → `{ ok: false }`
- Syntax errors, leftover input, division by zero → `{ ok: false }`
- Successful numeric result → `{ ok: true, value }`

### Testing

Unit tests for `calculatorLogic`: precedence, parentheses, unary minus, whitespace, division by zero, decimals, formatting helper if separate.

## Out of scope (V1)

- **Tab** in calculator mode opening/focusing the Calculator widget
- Calculation history in the widget
- Copy result on Enter / clipboard integration
- `%`, `^` / `**`, functions (`sqrt`, `sin`, …), constants (`pi`)
- Settings UI
- Persisting the widget expression across restarts
- Syncing palette query with the widget text field

## Future (prepared, not built)

- “Calculator mode” = current query evaluates successfully — natural hook for Tab
- Shared `evaluate()` remains the single source of truth; history is UI + persistence around the same API
- Planned follow-up: Tab opens Calculator widget with a history of expressions/results

## Acceptance criteria

1. Typing `12*7+3` in the palette shows live `= 87`; commands remain selectable; Enter runs the selected command
2. Invalid or incomplete typing shows no calculator UI; normal search works
3. Calculator widget: typing updates the live result; no number/operator buttons
4. `(1+2)*3` and `-5+2` succeed; `1/0` shows no result
