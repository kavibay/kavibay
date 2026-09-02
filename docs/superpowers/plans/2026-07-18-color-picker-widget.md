# Color Picker Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a screen eyedropper widget that live-samples the desktop pixel under the cursor during Pick, shows Hex/RGB/HSL, copies Hex by default, and confirms on outside click / cancels on Escape.

**Architecture:** Pure format helpers in `colorPickerLogic.ts`; Vue UI in `ColorPickerWidget.vue`; Rust pick-session thread samples via Win32 `GetPixel`, emits Tauri events, and confirms/cancels globally while ignoring LMB over interactive Kavibay rects (reuse `SharedClickThrough`).

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `windows` crate (Win32 GDI / input) on Windows.

## Global Constraints

- Screen eyedropper with Pick session (approach 1) — not a color wheel
- Formats: Hex (default / Copy button), RGB, HSL — no alpha / oklch
- Large swatch preview only — no magnifier, no history, no settings
- Click-through stays ON during Pick; LMB confirm ignored over interactive rects
- Windows-first sampling; non-Windows `color_picker_start` returns an error string
- No git repository in this workspace — skip all commit steps
- No test runner — verify with `npx vue-tsc --noEmit`, `cargo check`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-color-picker-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/colorPickerLogic.ts` | `Rgb`, Hex/RGB/HSL string builders, HSL conversion |
| `src/widgets/ColorPickerWidget.vue` | Swatch, format rows, Copy/Pick/Cancel, event wiring |
| `src/widgets/registry.ts` | Register `color-picker` |
| `src-tauri/src/color_picker.rs` | Session thread, sample, LMB/Escape, emit events |
| `src-tauri/src/commands.rs` | Re-export or thin wrappers if needed; keep click-through types shared |
| `src-tauri/src/lib.rs` | `mod color_picker`; register commands; manage session state |
| `src-tauri/Cargo.toml` | Add `windows` dependency (Win32 features) |

---

### Task 1: Pure color format helpers

**Files:**
- Create: `src/widgets/colorPickerLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface Rgb { r: number; g: number; b: number }`
  - `export interface Hsl { h: number; s: number; l: number }` — h 0–360, s/l 0–100
  - `export const DEFAULT_RGB: Rgb` — `{ r: 0, g: 0, b: 0 }`
  - `export function clampByte(n: number): number`
  - `export function rgbToHex({ r, g, b }: Rgb): string` — `#RRGGBB` uppercase
  - `export function rgbToHsl({ r, g, b }: Rgb): Hsl`
  - `export function formatRgbCss(rgb: Rgb): string` — `rgb(r, g, b)`
  - `export function formatHslCss(hsl: Hsl): string` — `hsl(h, s%, l%)`

- [ ] **Step 1: Create `src/widgets/colorPickerLogic.ts`**

```ts
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const DEFAULT_RGB: Rgb = { r: 0, g: 0, b: 0 };

/** Clamp to integer 0–255. */
export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

/** CSS hex `#RRGGBB` (uppercase). */
export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = [clampByte(r), clampByte(g), clampByte(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex.toUpperCase()}`;
}

/** Convert sRGB 0–255 to HSL (h degrees, s/l percent). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const R = clampByte(r) / 255;
  const G = clampByte(g) / 255;
  const B = clampByte(b) / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** `rgb(r, g, b)` for CSS. */
export function formatRgbCss(rgb: Rgb): string {
  return `rgb(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)})`;
}

/** `hsl(h, s%, l%)` for CSS. */
export function formatHslCss(hsl: Hsl): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}
```

- [ ] **Step 2: Sanity-check conversions in Node**

Run:

```powershell
node --input-type=module -e "import { rgbToHex, rgbToHsl, formatRgbCss, formatHslCss } from './src/widgets/colorPickerLogic.ts'; const c={r:26,g:43,b:60}; console.log(rgbToHex(c), formatRgbCss(c), formatHslCss(rgbToHsl(c)));"
```

Expected (approx): `#1A2B3C` `rgb(26, 43, 60)` `hsl(210, 40%, 17%)`  
If Node cannot import `.ts`, run `npx vue-tsc --noEmit` instead and spot-check values in the widget later.

- [ ] **Step 3: Skip commit**

---

### Task 2: Rust pick session + Win32 sampling

**Files:**
- Create: `src-tauri/src/color_picker.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Touch if needed: `src-tauri/capabilities/default.json` (only if invoke is ACL-denied at runtime — mirror how other app commands already work)

**Interfaces:**
- Consumes: `commands::SharedClickThrough`, `commands::RectPx` (existing)
- Produces:
  - Events: `color-picker:sample` / `color-picker:picked` / `color-picker:cancelled` with payload `{ r: u8, g: u8, b: u8 }` (cancelled may omit color or send empty — frontend ignores payload on cancel)
  - Commands: `color_picker_start(app) -> Result<(), String>`, `color_picker_stop(app) -> Result<(), String>`
  - Managed state: `ColorPickerSession` (AtomicBool / Mutex stop flag)

- [ ] **Step 1: Add Windows dependency to `src-tauri/Cargo.toml`**

Append under `[dependencies]`:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Graphics_Gdi",
  "Win32_UI_WindowsAndMessaging",
  "Win32_UI_Input_KeyboardAndMouse",
] }
```

- [ ] **Step 2: Create `src-tauri/src/color_picker.rs`**

Implement the full module. Key behaviors (must all be present):

1. `ColorSample { r, g, b }` serde + Clone
2. `ColorPickerSession { stop: Arc<AtomicBool> }` managed in app state; `start` sets stop=false and spawns thread; `stop` sets stop=true
3. Thread loop ~33ms sleep (~30 Hz):
   - If `stop` → break (no event if stop was requested via command — command emits `cancelled` OR thread emits once; prefer **command emits cancelled**, thread just exits)
   - Read cursor via `window.cursor_position()` (physical)
   - Convert to CSS px like `spawn_click_through_watcher` (origin + scale)
   - If point inside any `SharedClickThrough.rects` → skip LMB confirm this tick (still sample + emit for live preview when cursor is over UI is OK, or skip sample — either fine; **must not confirm**)
   - Sample pixel (Windows): `GetCursorPos` + `GetDC(None)` + `GetPixel` + `ReleaseDC`; unpack `COLORREF` as `r = color & 0xFF`, `g = (color >> 8) & 0xFF`, `b = (color >> 16) & 0xFF`; if `GetPixel` returns `CLR_INVALID`, skip emit
   - If sample looks wrong because of overlay (optional refinement): briefly `window.set_opacity(0.0)` or hide only for the GetPixel call — only add if manual test shows contamination
   - Emit `color-picker:sample`
   - Rising-edge LMB via `GetAsyncKeyState(VK_LBUTTON)` bit 0x8000; track `prev_down`; on `!prev && now` and cursor **not** in interactive rect → emit `color-picker:picked`, set stop, break
   - Rising-edge Escape (`VK_ESCAPE`) → emit `color-picker:cancelled`, set stop, break
4. Non-Windows: `color_picker_start` returns `Err("Color picker is only supported on Windows".into())`
5. Idempotent start: call internal stop (set flag, join/detach previous) then start fresh; wait until previous LMB is released before arming rising-edge (read initial `lmb_down` so Pick button click does not instantly confirm)

Skeleton (complete the Windows branch; keep structure):

```rust
//! Screen color pick session: poll cursor pixel, emit samples, confirm/cancel globally.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::SharedClickThrough;

#[derive(Clone, Serialize)]
pub struct ColorSample {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Default)]
pub struct ColorPickerSession {
    pub stop: Arc<AtomicBool>,
}

#[tauri::command]
pub fn color_picker_stop(
    app: AppHandle,
    session: State<'_, ColorPickerSession>,
) -> Result<(), String> {
    session.stop.store(true, Ordering::SeqCst);
    let _ = app.emit("color-picker:cancelled", ());
    Ok(())
}

#[tauri::command]
pub fn color_picker_start(
    app: AppHandle,
    session: State<'_, ColorPickerSession>,
    click_through: State<'_, SharedClickThrough>,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (&app, &session, &click_through);
        return Err("Color picker is only supported on Windows".into());
    }

    #[cfg(windows)]
    {
        session.stop.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(40));
        session.stop.store(false, Ordering::SeqCst);
        let stop = session.stop.clone();
        let ct = click_through.inner().clone();
        let handle = app.clone();
        std::thread::spawn(move || pick_loop(handle, stop, ct));
        Ok(())
    }
}

#[cfg(windows)]
fn pick_loop(app: AppHandle, stop: Arc<AtomicBool>, click_through: SharedClickThrough) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, CLR_INVALID};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut prev_lmb = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 };
    let mut prev_esc = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16 & 0x8000 != 0 };
    // Drain the Pick-button press: wait until LMB is up before arming confirm.
    while unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 } {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(16));
    }
    prev_lmb = false;

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(33));
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let Some(window) = app.get_webview_window("main") else {
            continue;
        };

        let over_ui = match (
            window.cursor_position(),
            window.outer_position(),
            window.scale_factor(),
        ) {
            (Ok(cursor), Ok(origin), Ok(scale)) => {
                let px = (cursor.x - origin.x as f64) / scale;
                let py = (cursor.y - origin.y as f64) / scale;
                let rects = click_through.lock().unwrap().rects.clone();
                rects.iter().any(|r| r.contains(px, py))
            }
            _ => true,
        };

        let sample = unsafe {
            let mut pt = POINT::default();
            if GetCursorPos(&mut pt).is_err() {
                None
            } else {
                let hdc = GetDC(None);
                if hdc.is_invalid() {
                    None
                } else {
                    let color = GetPixel(hdc, pt.x, pt.y);
                    let _ = ReleaseDC(None, hdc);
                    if color == CLR_INVALID {
                        None
                    } else {
                        Some(ColorSample {
                            r: (color.0 & 0xFF) as u8,
                            g: ((color.0 >> 8) & 0xFF) as u8,
                            b: ((color.0 >> 16) & 0xFF) as u8,
                        })
                    }
                }
            }
        };

        if let Some(s) = sample {
            let _ = app.emit("color-picker:sample", &s);
        }

        let lmb = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 };
        let esc = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16 & 0x8000 != 0 };

        if esc && !prev_esc {
            stop.store(true, Ordering::SeqCst);
            let _ = app.emit("color-picker:cancelled", ());
            break;
        }
        if lmb && !prev_lmb && !over_ui {
            stop.store(true, Ordering::SeqCst);
            if let Some(s) = sample {
                let _ = app.emit("color-picker:picked", &s);
            } else {
                let _ = app.emit("color-picker:cancelled", ());
            }
            break;
        }
        prev_lmb = lmb;
        prev_esc = esc;
    }
}
```

Adjust `COLORREF` / `GetPixel` return type to match `windows` 0.61 APIs if the compiler complains (use `.0` or cast as needed). Fix `VK_LBUTTON.0` if the enum representation differs — use `VK_LBUTTON.0 as i32` or `i32::from(VK_LBUTTON.0)`.

**Important:** `color_picker_stop` should not double-emit if the thread already ended — acceptable for V1 if Cancel emits once from the command and the thread exits quietly when `stop` is set (thread must **not** also emit cancelled when stop was set by command). Update the loop: on `stop` break **without** emitting.

- [ ] **Step 3: Wire module in `src-tauri/src/lib.rs`**

- Add `mod color_picker;`
- In `setup`, after click-through manage: `app.manage(color_picker::ColorPickerSession::default());`
- In `invoke_handler`, add `color_picker::color_picker_start`, `color_picker::color_picker_stop`

- [ ] **Step 4: Compile-check**

Run: `cargo check`  
Working directory: `src-tauri`  
Expected: exit 0 (fix API mismatches until clean)

- [ ] **Step 5: Skip commit**

---

### Task 3: ColorPickerWidget UI + event wiring

**Files:**
- Create: `src/widgets/ColorPickerWidget.vue`

**Interfaces:**
- Consumes:
  - Helpers from Task 1
  - `invoke("color_picker_start" | "color_picker_stop")`
  - `listen("color-picker:sample" | "color-picker:picked" | "color-picker:cancelled")`
- Produces: widget component default export for registry

- [ ] **Step 1: Create `src/widgets/ColorPickerWidget.vue`**

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WidgetProps } from "./types";
import {
  DEFAULT_RGB,
  formatHslCss,
  formatRgbCss,
  rgbToHex,
  rgbToHsl,
  type Rgb,
} from "./colorPickerLogic";

defineProps<WidgetProps>();

const hasTauri = () => "__TAURI_INTERNALS__" in window;

const fixed = ref<Rgb>({ ...DEFAULT_RGB });
const live = ref<Rgb | null>(null);
const picking = ref(false);
const pickError = ref<string | null>(null);
const copiedKey = ref<"hex" | "rgb" | "hsl" | null>(null);

let unlisteners: UnlistenFn[] = [];
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const display = computed(() => live.value ?? fixed.value);
const hex = computed(() => rgbToHex(display.value));
const rgbCss = computed(() => formatRgbCss(display.value));
const hslCss = computed(() => formatHslCss(rgbToHsl(display.value)));
const swatchStyle = computed(() => ({ background: hex.value }));

/** Copy text and flash feedback on the given key. */
async function copyValue(key: "hex" | "rgb" | "hsl", value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copiedKey.value = key;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedKey.value = null;
    }, 1000);
  } catch {
    /* clipboard may fail without permission — ignore */
  }
}

/** Tear down event listeners from a previous pick. */
async function clearListeners() {
  for (const off of unlisteners) off();
  unlisteners = [];
}

/** Start backend pick session and subscribe to events. */
async function startPick() {
  if (!hasTauri()) {
    pickError.value = "Pick unavailable";
    return;
  }
  pickError.value = null;
  await clearListeners();
  picking.value = true;
  live.value = { ...fixed.value };

  unlisteners.push(
    await listen<Rgb>("color-picker:sample", (e) => {
      live.value = e.payload;
    }),
  );
  unlisteners.push(
    await listen<Rgb>("color-picker:picked", (e) => {
      fixed.value = e.payload;
      live.value = null;
      picking.value = false;
      void clearListeners();
    }),
  );
  unlisteners.push(
    await listen("color-picker:cancelled", () => {
      live.value = null;
      picking.value = false;
      void clearListeners();
    }),
  );

  try {
    await invoke("color_picker_start");
  } catch (err) {
    picking.value = false;
    live.value = null;
    pickError.value = "Pick unavailable";
    await clearListeners();
    console.error(err);
  }
}

/** Cancel pick via backend command. */
async function cancelPick() {
  if (!picking.value) return;
  try {
    if (hasTauri()) await invoke("color_picker_stop");
  } catch (err) {
    console.error(err);
  }
  live.value = null;
  picking.value = false;
  await clearListeners();
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
  if (picking.value && hasTauri()) {
    void invoke("color_picker_stop");
  }
  void clearListeners();
});
</script>

<template>
  <div class="color-picker" @pointerdown.stop>
    <div class="color-picker-swatch" :style="swatchStyle" aria-hidden="true" />

    <div class="color-picker-formats">
      <button
        type="button"
        class="color-picker-row color-picker-row--primary"
        @click="copyValue('hex', hex)"
      >
        <span class="color-picker-label">Hex</span>
        <span class="color-picker-value">{{
          copiedKey === "hex" ? "Copied" : hex
        }}</span>
      </button>
      <button
        type="button"
        class="color-picker-row"
        @click="copyValue('rgb', rgbCss)"
      >
        <span class="color-picker-label">RGB</span>
        <span class="color-picker-value">{{
          copiedKey === "rgb" ? "Copied" : rgbCss
        }}</span>
      </button>
      <button
        type="button"
        class="color-picker-row"
        @click="copyValue('hsl', hslCss)"
      >
        <span class="color-picker-label">HSL</span>
        <span class="color-picker-value">{{
          copiedKey === "hsl" ? "Copied" : hslCss
        }}</span>
      </button>
    </div>

    <p v-if="pickError" class="color-picker-error">{{ pickError }}</p>

    <div class="color-picker-actions">
      <button
        type="button"
        class="color-picker-btn color-picker-btn--accent"
        @click="copyValue('hex', hex)"
      >
        {{ copiedKey === "hex" ? "Copied" : "Copy" }}
      </button>
      <button
        v-if="!picking"
        type="button"
        class="color-picker-btn color-picker-btn--ghost"
        @click="startPick"
      >
        Pick
      </button>
      <button
        v-else
        type="button"
        class="color-picker-btn color-picker-btn--ghost"
        @click="cancelPick"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 200px;
}

.color-picker-swatch {
  width: 100%;
  height: 72px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.color-picker-formats {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.color-picker-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.color-picker-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.color-picker-row--primary {
  color: #fff;
  font-weight: 600;
}

.color-picker-label {
  opacity: 0.55;
  font-size: 12px;
}

.color-picker-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.color-picker-error {
  margin: 0;
  font-size: 12px;
  color: #e07a5f;
}

.color-picker-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.color-picker-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.color-picker-btn--accent {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.color-picker-btn--ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
}

.color-picker-btn--ghost:hover {
  color: rgba(255, 255, 255, 0.9);
}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: exit 0

- [ ] **Step 3: Skip commit**

---

### Task 4: Registry + end-to-end verification

**Files:**
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `ColorPickerWidget` from Task 3
- Produces: registry entry `id: "color-picker"`

- [ ] **Step 1: Register widget in `src/widgets/registry.ts`**

Add import:

```ts
import ColorPickerWidget from "./ColorPickerWidget.vue";
```

Append entry (place left of palette under weather/system-info area, e.g. under system-info):

```ts
  {
    id: "color-picker",
    title: "Color Picker",
    // Links unter System Info (Mittelpunkt-Offsets).
    position: { x: -480, y: 320 },
    component: ColorPickerWidget,
  },
```

No `backendCommand`, no `refreshInterval`, no `settingsComponent`.

- [ ] **Step 2: Typecheck + Rust check**

Run:

```powershell
npx vue-tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both exit 0

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`

Confirm:

1. Color Picker card appears; swatch black; Hex `#000000`
2. **Copy** puts `#000000` on clipboard; row click copies RGB/HSL strings
3. **Pick** → move over wallpaper / browser / other app → swatch + values update live
4. Click on desktop (not on Kavibay UI) → color fixes; Pick ends
5. Pick again → **Escape** or **Cancel** → previous fixed color kept
6. Clicking Cancel / Copy during Pick does **not** fix a random UI pixel as the color
7. After Pick ends, other widgets still click-through correctly
8. If samples are wrong (always black/glass color): add brief hide/`set_opacity(0)` around `GetPixel` in `color_picker.rs` and retest

- [ ] **Step 4: Skip commit**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Screen eyedropper Pick mode | Task 2 + 3 |
| Live swatch + Hex/RGB/HSL | Task 1 + 3 |
| Copy Hex primary; rows copy formats | Task 3 |
| LMB confirm outside UI; Escape/Cancel abort | Task 2 + 3 |
| Ignore LMB over interactive rects | Task 2 `over_ui` |
| Click-through stays on | Task 2 (no pause) |
| No magnifier / history / alpha / settings | Tasks 1–4 (omitted) |
| Registry `color-picker`, WidgetCard host | Task 4 |
| Windows sampling; browser Pick unavailable | Task 2 + 3 |
| Unit-style format helpers | Task 1 |
| Manual E2E list | Task 4 |

## Self-review notes

- Event names and payload shape are consistent across Tasks 2–3 (`r`/`g`/`b`).
- `color_picker_stop` emits cancelled; pick loop breaks silently when `stop` is set by command (do not double-emit from thread on flag).
- LMB arming waits for button release after start so the Pick click cannot confirm immediately.
