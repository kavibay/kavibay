# Kavibay — Raycast-ähnlicher Launcher mit schwebenden Widgets (Prototyp V1)

> **Historisches Dokument.** Dies ist die ursprüngliche V1-Spezifikation, so wie
> sie vor der Umsetzung geschrieben wurde — inklusive Begründungen, die weiterhin
> gelten (Transparenz, Click-through, Widget-Contract). Die Pfadangaben sind
> veraltet: `src/` wurde beim Repo-Restrukturieren zu `core/app/` und
> `extensions/`. Der aktuelle Aufbau steht in
> [docs/architecture.md](docs/architecture.md), der aktuelle Stand der Features
> in [README.md](README.md).

Tauri v2 + Vue 3 (`<script setup>`, TypeScript) + Vite. Zielplattform für V1: **Windows 11**
(macOS-Portierung ist eingeplant, aber nicht Teil von V1). Fokus: sauberes Fundament,
insbesondere der **Widget-Contract** — nicht Feature-Fülle.

## 1. Projektstruktur

```
kavibay/
├── package.json / vite.config.ts / tsconfig.json / index.html
├── src/                          # Vue-Frontend
│   ├── main.ts
│   ├── App.vue                   # transparenter Vollbild-Container
│   ├── styles.css                # globale Styles (transparenter Body!)
│   ├── palette/
│   │   ├── CommandPalette.vue    # Suchbar + Ergebnisliste
│   │   ├── commands.ts           # statische Command-Liste (Dummy-Commands)
│   │   └── fuzzy.ts              # kleine eigene Fuzzy-Match-Funktion (keine Dependency)
│   ├── core/
│   │   ├── extensions/           # ⭐ types, Vite-glob loader, registry API
│   │   ├── host/                 # WidgetHost, WidgetCard, useWidgetData, layout
│   │   └── audio/                # shared session-end beep
│   └── extensions/<id>/          # ⭐ one folder per extension
│       ├── manifest.json         # catalog metadata (id, name, keywords, ui, commands)
│       ├── index.ts              # Vue wiring + lifecycle hooks
│       └── *.vue / *.ts          # extension-owned UI and state
└── src-tauri/
    ├── tauri.conf.json
    ├── Cargo.toml
    ├── capabilities/default.json
    └── src/
        ├── main.rs               # nur Einstiegspunkt, ruft lib.rs
        ├── lib.rs                # Builder, Global-Shortcut, Fenster-Setup/Toggle
        └── commands.rs           # execute_action + widget_*-Commands
```

## 2. Fenster (Tauri-Konfiguration + Rust)

`tauri.conf.json`, Fenster `main`:

```json
{
  "label": "main",
  "visible": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "shadow": false
}
```

- **Größe:** NICHT `fullscreen: true` (exklusiver Modus, problematisch mit Transparenz).
  Stattdessen im Rust-`setup`: `window.current_monitor()` → `set_size(monitor.size())` +
  `set_position(monitor.position())`. Physische Pixel verwenden (`PhysicalSize`/`PhysicalPosition`).
- **Vorladen:** Fenster startet unsichtbar (`visible: false`) und wird nie zerstört —
  Hotkey macht nur `show()`/`hide()`.
- **`shadow: false`** ist auf Windows wichtig, sonst zeichnet DWM einen Fensterschatten
  um das unsichtbare Vollbild-Rechteck.

### Global-Shortcut (Rust, Plugin `tauri-plugin-global-shortcut`)

- `Ctrl+Space` wird in `lib.rs` beim Start registriert (nur Rust, kein JS-Zugriff nötig).
- Handler (nur auf `ShortcutState::Pressed` reagieren, sonst feuert es doppelt):
  - Fenster sichtbar → `hide()`
  - sonst → `show()` + `set_focus()` + Event `palette:show` an Frontend emitten
    (Frontend fokussiert daraufhin das Input und leert die Query).

### ESC

- Frontend: globaler `keydown`-Listener; bei `Escape` → `getCurrentWindow().hide()`
  (aus `@tauri-apps/api/window`).
- Benötigt Capability-Permission `core:window:allow-hide` (siehe §6).

## 3. ⭐ Extension contract (der wichtigste Teil)

Every widget is a first-party **extension** under `src/extensions/<id>/`:

- `manifest.json` — catalog metadata (id, name, keywords, categories, ui defaults, declared `commands` / `permissions`)
- `index.ts` — Vue components + lifecycle hooks (`onCreate`, `onDuplicate`, `onSuspend`, `onResume`, `onDispose`)
- Vite `import.meta.glob` discovers packages at build time (`src/core/extensions/loadExtensions.ts`)

Host chrome lives in `src/core/host/` and must not contain `typeId` switches — lifecycle is dispatched via extension hooks. Layout `typeId`s stay stable across renames of the packaging system.

See `docs/extensions.md` for the current contract.

### Verantwortlichkeiten (strikt getrennt)

| Schicht | Verantwortung | Verboten |
|---|---|---|
| Extension `*.vue` | Props rendern, hübsch sein | Host-Lifecycle / Registry-Wissen |
| `useWidgetData.ts` | `invoke(backendCommand)`, Refresh-Timer, loading/error-State | DOM/Styling |
| `WidgetHost.vue` | Layout, Drag, add/hide/remove; ruft Extension-Hooks | Wissen über konkrete Extensions |
| Extension `index.ts` | Components + seed/dispose/suspend | Host-Chrome |
| Rust-Command | Datenbeschaffung, API-Keys, (später) Caching | UI-Konzepte |

**Warum das später trägt:** Runtime-Plugins können denselben Manifest+Module-Contract laden.
`commands` / `permissions` im Manifest sind für die spätere Rust-Modularisierung vorbereitet.

### `useWidgetData(def: RegisteredExtension)` (Composable)

- Ohne `backendCommand`: gibt statisches `{ data: null, loading: false, error: null, lastUpdated: null }`
  zurück — das Widget versorgt sich selbst (z. B. Uhr aus `Date`).
- Mit `backendCommand`: beim Mount `invoke(def.backendCommand)`; bei `refreshInterval`
  zusätzlich `setInterval`; Cleanup in `onUnmounted`. Fehler fangen → `error`-String setzen,
  altes `data` behalten (kein Flackern).

### `WidgetHost.vue`

- Liest die Extension-Registry, positioniert Instanzen relativ zur Palette, rendert
  `WidgetInstanceView` pro sichtbarer Instanz.
- Lifecycle nur über Hooks — kein `if (typeId === …)`.

### Extension catalog (manifest-driven)

| Extension | Position | backendCommand | refreshInterval |
|---|---|---|---|
| ClockWidget | top-right | — (rein Frontend) | — |
| SystemInfoWidget | bottom-left | `widget_system_info` | 5000 |
| WeatherWidget | top-left | `widget_weather` | 60000 |

(bottom-right + right bleiben in V1 frei — die Slots existieren aber im Host.)

## 4. Rust-Backend (`commands.rs`)

Alle Commands als `#[tauri::command]`, Rückgabe `Result<serde_json::Value, String>`
(bzw. typisierte serde-Structs — bevorzugt):

- `execute_action(action_id: String)` → `println!("[action] {action_id}")`. Wird von der
  Palette bei Enter aufgerufen.
- `widget_system_info` → via `sysinfo`-Crate: OS-Name/-Version, Hostname, CPU-Anzahl,
  RAM benutzt/gesamt, Uptime.
- `widget_weather` → statisches Mock-JSON (Ort, Temperatur mit leichter Zufallsschwankung,
  Zustand). Simuliert eine externe API — demonstriert das Prinzip „API-Key bliebe im Backend".

Cargo-Dependencies: `tauri`, `tauri-plugin-global-shortcut`, `serde`, `serde_json`, `sysinfo`, `rand`.

## 5. Command-Palette

- `commands.ts`: 6 Dummy-Commands `{ id, title, subtitle?, keywords: string[] }`
  (Open Terminal, Open Browser, Sleep, Lock Screen, Empty Clipboard, Toggle Dark Mode).
- `fuzzy.ts`: eigene Subsequenz-Matcher-Funktion mit Score (Bonus für Wortanfänge und
  aufeinanderfolgende Treffer). Bewusst keine Library — klein, lesbar, lehrreich.
  Leere Query = alle Commands in Originalreihenfolge.
- `CommandPalette.vue`:
  - Input auto-fokussiert; lauscht auf Tauri-Event `palette:show` → Query leeren + fokussieren.
  - `↑`/`↓` bewegen Auswahl (mit Wrap-around), Liste scrollt Auswahl in Sicht.
  - `Enter` → `invoke("execute_action", { actionId })` + Fenster verstecken.
  - Auswahl-Index bei jeder Query-Änderung auf 0 zurücksetzen.

## 6. Capabilities (Tauri v2, `capabilities/default.json`)

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus"
  ]
}
```

(Global-Shortcut braucht keine JS-Permission — läuft komplett in Rust.)

## 7. Styling / Transparenz — mit einer ehrlichen Einschränkung

- `html, body, #app { background: transparent; }` — sonst bleibt das Fenster milchig/weiß.
- Panels: `background: rgba(28,28,32,0.72)`, `border-radius: 12–16px`,
  `border: 1px solid rgba(255,255,255,0.1)`, dezenter `box-shadow`.
- **Einschränkung:** `backdrop-filter: blur()` in WebView2 blurrt nur Webview-*eigenen*
  Inhalt, NICHT den Desktop hinter dem transparenten Fenster. Echtes Vibrancy nur unter
  dem Panel ist auf Windows per Web-Tech nicht möglich; die `window-vibrancy`-Crate
  (Acrylic/Mica) würde das *ganze* Fenster blurren. V1 approximiert den Look daher mit
  halbtransparenten Hintergründen. `backdrop-filter` trotzdem setzen (schadet nicht,
  hilft auf macOS später). Optionaler Folgeschritt, nicht V1: Acrylic via `window-vibrancy`.
- Click-through der Lücken IST umgesetzt (siehe §9) — der Launcher ist also NICHT mehr
  modal: Klicks neben Karten/Palette landen auf dem Desktop bzw. den Fenstern dahinter.

## 8. Scaffold & Verifikation (Reihenfolge für die Umsetzung)

1. `npm create tauri-app@latest . -- --name kavibay --identifier com.aswetlow.kavibay
   --template vue-ts --manager npm --yes` (non-interaktiv; falls das Verzeichnis-Argument
   zickt: in Temp scaffolden und Inhalte verschieben — Verzeichnis enthält nur PLAN.md).
2. `npm install`; Rust-Dependencies in `Cargo.toml` ergänzen.
3. Implementierung in dieser Reihenfolge: Fenster-Config → Rust-Commands + Shortcut →
   Widget-Contract (types/registry/composable/host) → Widgets → Palette → Styling.
4. Verifikation (Pflicht): `npm run build` (inkl. `vue-tsc`-Typecheck) und
   `cargo check` in `src-tauri` müssen fehlerfrei durchlaufen.
5. Smoke-Test: `npm run tauri dev` im Hintergrund starten, warten bis der Dev-Build steht
   und der Prozess stabil läuft (kein Panic in den Logs), dann beenden. Manuelle
   Sichtprüfung (Hotkey, Transparenz, Widgets) macht der Mensch danach.

**Windows-Hinweis:** `cargo` liegt nach frischer rustup-Installation in
`%USERPROFILE%\.cargo\bin` und ist in bereits laufenden Shell-Sessions evtl. noch nicht
im PATH — in jedem Build-Kommando ggf. PATH voranstellen.

## 9. Drag & Drop + Click-through (nachträglich ergänzt)

### Freie Positionierung (Frontend)
- `WidgetPosition` ist von festen Ecken-Strings auf freie Koordinaten `{x, y}` umgestellt
  (Registry-Default = Anteil des Fensters 0..1). Die Widgets werden im `WidgetHost` absolut
  positioniert (`transform: translate`).
- Ziehen per Pointer Events direkt am Kartenrahmen: `pointerdown` merkt den Greif-Offset und
  setzt `setPointerCapture`, `pointermove` aktualisiert die Position (auf den sichtbaren
  Bereich geklemmt), `pointerup` speichert nach `localStorage` (`kavibay:widget-positions`).
- Die Palette bleibt fix (mittig oben), nur die Widgets sind verschiebbar.

### Click-through der Lücken (Frontend meldet, Rust entscheidet)
- Kernproblem: `setIgnoreCursorEvents(true)` gilt fürs GANZE Fenster. Sobald es aktiv ist,
  bekommt der Webview keine Mausbewegung mehr — er könnte die Rückkehr des Cursors auf eine
  Karte gar nicht bemerken. Die Erkennung muss daher im Backend laufen.
- Ablauf:
  1. Interaktive Elemente markieren sich im DOM mit `data-interactive` (Karten + Palette).
  2. `src/system/clickThrough.ts` sammelt deren Rechtecke (CSS-Pixel) und schickt sie per
     `invoke("set_interactive_rects")` ans Backend — bei Mount, Resize, `ResizeObserver`
     (Datenladen/Listenwachstum) und während des Drags.
  3. Ein Rust-Thread (`spawn_click_through_watcher` in `lib.rs`) pollt ~60x/s
     `window.cursor_position()`, rechnet mit `outer_position` + `scale_factor` in
     fensterrelative CSS-Pixel um und setzt `set_ignore_cursor_events(true)`, wenn der Cursor
     über keinem Rechteck liegt (nur bei Zustandswechsel, nicht jeden Frame).
  4. Während eines Drags meldet das Frontend `set_click_through_paused(true)`, damit der
     Durchlass den Ziehvorgang nicht abreißt.
- CSS-Ergänzung: `app-shell` und `widget-host` haben `pointer-events: none`, nur Karten und
  Palette schalten es auf `auto` — so fängt der Webview in den Lücken selbst keine Klicks ab.
- Keine neue Capability nötig: `set_ignore_cursor_events` ist ein reiner Rust-Aufruf, die
  beiden neuen Commands sind eigene `#[tauri::command]`s (brauchen keinen Capability-Eintrag).
- Bekannte Feinheit: Der Zustand wird mit ~16 ms Latenz umgeschaltet. Ein Klick exakt im
  Moment des Verlassens einer Karte kann daher selten noch vom Fenster gefangen werden —
  für einen Prototyp vernachlässigbar.
