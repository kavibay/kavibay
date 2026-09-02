# Konsolidiertes `settings.json` + Palette-Command + `KAVIBAY_DATA_DIR`

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> Phasen in Reihenfolge; jede Phase hat ein Akzeptanzkriterium. Nicht mit der
> nächsten Phase anfangen, bevor die aktuelle grün ist.

**Goal:** Eine einzige, von Hand editierbare `settings.json` im App-Data-Verzeichnis,
die aus der Palette heraus zu öffnen ist — plus ein `KAVIBAY_DATA_DIR`-Override,
damit eine Dev-Instanz nicht die AppData der installierten Instanz benutzt.

**Nicht-Goal:** Settings im Projekt- oder Install-Verzeichnis. Kavibay hat kein
Workspace-Konzept, gegen das ein Override Sinn ergäbe, und das Install-Verzeichnis
ist unter Windows nicht beschreibbar. VS Code legt seine *globalen* Settings
ebenfalls nach `%APPDATA%`; nur Workspace-Settings landen in `.vscode/`.

---

## Ausgangslage

Settings liegen heute an vier verschiedenen Stellen:

| Ort | Inhalt | Editierbar? |
|---|---|---|
| `localStorage` `kavibay:*` | Appearance, Folders, Developer, Extensions | nur via DevTools |
| `{appData}/web-storage.json` | Mirror des gesamten `kavibay:`-Keyspace | **nein** — DPAPI-verschlüsselt, enthält Widget-Inhalte |
| `{appData}/appearance.json` | Appearance nochmal (Doppel-Write) | ja, aber redundant |
| `{appData}/mcp-server.json`, `llm-models.json`, `onboarding.json` | Rust-seitige Prefs | ja |

`web-storage.json` ist absichtlich verschlüsselt: es ist die *einzige* Kopie der
Notizen, Alarme und Timer (siehe `src-tauri/src/web_storage.rs`). Diese Datei darf
nicht editierbar werden. Der Plan trennt deshalb **Settings** von **State**, statt
alles in eine Datei zu ziehen.

## Architektur-Entscheidung

`localStorage` bleibt der schnelle synchrone Cache — die Begründung in
`core/app/system/durableStorage.ts` gilt unverändert, und 130+ synchrone
Call-Sites auf einen async Store umzubauen ist nicht das, was hier gebraucht wird.

Geändert wird nur, **wohin gespiegelt wird**:

- Settings-Keys → `{dataDir}/settings.json`, plain, pretty-printed, als
  verschachteltes Objekt (nicht als JSON-in-JSON-String).
- Alles andere → `{dataDir}/web-storage.json`, unverändert geschützt.
- `mcp-server.json` und `llm-models.json` werden zu Sektionen in `settings.json`.
- `appearance.json` entfällt (Doppel-Write).
- `credentials.db` bleibt unangetastet. Secrets landen **nie** in `settings.json`
  — CLAUDE.md, Invariante 3.

**Verworfene Alternative:** Rust besitzt die Settings, Frontend liest und schreibt
nur über Commands. Sauberer auf dem Papier, macht aber sieben Composables async,
die heute beim Modul-Import synchron lesen (`useAppearance`, `useFolderPrefs`, …),
und kauft dafür nichts, was der Split nicht auch liefert.

## Was ist Setting, was ist State

Das ist die tragende Entscheidung des Plans. Setting = etwas, das der Benutzer
bewusst eingestellt hat und sinnvoll von Hand editieren könnte. State = alles,
was die App über ihn beobachtet oder als UI-Position merkt.

**→ `settings.json` (plain):**

| Key / Datei | Sektion |
|---|---|
| `kavibay:appearance-v1` | `appearance` |
| `kavibay:developer-v1` | `developer` |
| `kavibay:extensions-v1` | `extensions` |
| `kavibay:palette-folders-v1` | `folders` |
| `mcp-server.json` | `mcpServer` |
| `llm-models.json` | `ai` |

**→ bleibt in `web-storage.json` (geschützt):**
`kavibay:layout-v4`, `kavibay:widget-type-size-v1`, `kavibay:palette-app-launches-v3`,
`kavibay:palette-hidden-apps-v1`, `kavibay:palette-file-sort-v1`,
`kavibay:palette-inline-zoom-v1`, `kavibay:palette-recent-runs-v1`,
`kavibay:settings-geometry-v1`, `kavibay:onboarding-v2`, `kavibay:runtime-installs-v1`,
`kavibay:widget-config:*`, `kavibay:widget-data:*`, `kavibay:extension-data:*`.

Grenzfall bewusst aufgeschoben: `kavibay:widget-config:*` (Per-Instanz-Widget-Settings)
ist argumentierbar Setting, ist aber instanz-gekeyt und kann Benutzerinhalte tragen.
Bleibt in v1 State.

## Global Constraints

- `settings.json` ist **plain text**, 2-Space pretty-printed, mit `"version": 1`.
- Rust besitzt die Datei. Das Frontend schreibt ausschließlich über
  `settings_save_sections` (Read-Modify-Write einzelner Top-Level-Sektionen),
  nie durch Ersetzen des ganzen Dokuments — Rust liest `mcpServer` beim Boot,
  bevor die WebView existiert (`src-tauri/src/lib.rs:276`).
- Schreiben ist atomar: `settings.json.tmp` → `rename`. Ein Torn Write kostet
  hier alle Settings auf einmal, anders als bei den heutigen Einzeldateien.
- Kaputte Datei = Defaults + Quarantäne (`settings.corrupt.json`), analog
  `web_storage::quarantine`. Nie stillschweigend überschreiben.
- Handedits greifen beim nächsten Start. Ein File-Watcher ist **out of scope** —
  siehe unten.
- Keine neuen npm-Dependencies.
- Verify: `npm run verify` und `npm run verify:rust` grün.

## File Structure

| Datei | Verantwortung |
|---|---|
| `src-tauri/src/paths.rs` | **neu** — `data_dir(app)` mit `KAVIBAY_DATA_DIR`-Override |
| `src-tauri/src/settings_store.rs` | **neu** — `settings.json` laden/mergen/atomar schreiben, Quarantäne, Migration |
| `src-tauri/src/appearance_prefs.rs` | Appearance-Commands entfernen; Onboarding bleibt |
| `src-tauri/src/mcp/settings.rs` | liest/schreibt Sektion `mcpServer` statt eigener Datei |
| `src-tauri/src/llm/prefs.rs` | liest/schreibt Sektion `ai` statt eigener Datei |
| `core/app/system/settingsSections.ts` | **neu** — pure Map Key ↔ Sektion, encode/decode |
| `core/app/system/settingsSections.assert.ts` | **neu** — Asserts dazu |
| `core/app/system/durableStorage.ts` | Snapshot splitten: Settings-Keys raus |
| `core/app/settings/useAppearance.ts` | `appearance_preferences_*` entfernen |
| `core/app/palette/commands.ts` | `open-settings-file`, `reveal-settings-folder` |
| `core/app/palette/CommandPalette.vue` | Dispatch dafür |
| `SECURITY.md`, `AGENTS.md` | Speicherorte dokumentieren |

---

### Phase 1 — `paths.rs` und `KAVIBAY_DATA_DIR` ✅ erledigt (2026-09-02)

Zuerst, weil es unabhängig nützlich ist **und** weil die Phasen 3–5 ein
Wegwerf-Datenverzeichnis brauchen, um Migrationen wiederholt zu testen.

**Files:** Create `src-tauri/src/paths.rs`; modify alle `app_data_dir()`-Call-Sites.

- [x] `paths.rs`: `pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String>` —
      liest `KAVIBAY_DATA_DIR` einmal in ein `OnceLock`, fällt sonst auf
      `app.path().app_data_dir()` zurück. Pfad muss absolut sein; relativ oder
      nicht anlegbar → Fehler beim Boot, kein stiller Fallback.
- [x] `create_dir_all` zentral hier, nicht in jedem Aufrufer.
- [x] Beim Boot einmal `eprintln!` mit dem aufgelösten Verzeichnis, wenn der
      Override greift — eine Instanz, die woanders schreibt, muss sichtbar sein.
- [x] Alle Call-Sites umstellen: `appearance_prefs.rs`, `web_storage.rs`,
      `credentials/db.rs`, `credentials/import.rs`, `mcp/settings.rs`,
      `llm/prefs.rs`, `palette_app_icons.rs`, `extensions/clipboard_widget/mod.rs`,
      `extensions/focus_tracker/db.rs`, `extensions/image_widget/mod.rs`.
- [x] Unit-Test für die Pfadauflösung (absolut / relativ / leer / getrimmt).
- [x] **Nachgetragen:** Single-Instance-Plugin wird nicht registriert, wenn der
      Override greift. `tauri_plugin_single_instance` leitet einen zweiten Start
      an die laufende Instanz weiter und beendet den neuen Prozess mit Exit 0 —
      *bevor* der sein eigenes Datenverzeichnis überhaupt liest. Ohne diese
      Ausnahme ist der Override nicht nur untestbar, sondern schlicht wirkungslos,
      sobald irgendeine Kavibay-Instanz läuft, und das sieht von außen aus wie
      „die Variable wird ignoriert". Eine Instanz mit eigenem Datenverzeichnis ist
      ein eigenes Profil, keine zweite Kopie. Sie verliert dabei die globalen
      Shortcuts an die laufende Instanz — im Log sichtbar, für einen Dev-Lauf egal.
- [x] Dokumentieren: der Override ist ein **Dev- und Test-Schalter, kein Portable
      Mode.** DPAPI bindet `web-storage.json` und die Credentials an Benutzer und
      Maschine; ein Datenverzeichnis auf einem USB-Stick wäre auf einem anderen
      Rechner unlesbar. → `SECURITY.md` (Data at rest), `AGENTS.md` (Commands).

*Accept when:* `KAVIBAY_DATA_DIR=<abs> kavibay.exe` legt dort ein frisches
Verzeichnis mit allen Dateien an, und die installierte Instanz bleibt unberührt.
`npm run verify:rust` grün.

**Ergebnis:** Verifiziert. Die Override-Instanz legte `appearance.json`,
`onboarding.json`, `web-storage.json`, `credentials.db`, `focus_tracker.db` und
`clipboard-widget/` im Wegwerf-Verzeichnis an; im echten AppData kam keine Datei
hinzu und keine wurde von ihr angefasst. Beide Instanzen liefen dabei parallel.
Log: `[paths] KAVIBAY_DATA_DIR in effect: …`. clippy `-D warnings` sauber,
472 `cargo test --lib` grün (5 davon neu).

**Bekannte Grenze, absichtlich nicht behoben:** Der Override verlegt das
Datenverzeichnis, **nicht** das WebView-Profil unter
`%LOCALAPPDATA%\com.kavibay.kavibay\EBWebView`. Beide Instanzen teilen sich also
dasselbe `localStorage`. Nacheinander ist das folgenlos — beim Boot gewinnt die
AppData-Kopie und überschreibt den Cache —, gleichzeitig laufende Instanzen
überschreiben sich gegenseitig den Cache. Das WebView-Verzeichnis mitzuverlegen
hieße, die Fenster in Rust statt in `tauri.conf.json` zu bauen; das ist eine
eigene Änderung, kein Nebeneffekt dieser Phase.

---

### Phase 2 — Sektions-Mapping (pure TS) ✅ erledigt (2026-09-02)

**Files:** Create `core/app/system/settingsSections.ts` + `.assert.ts`.

Die localStorage-Werte sind JSON-kodierte *Strings*. Damit `settings.json`
editierbar ist, müssen sie beim Schreiben geparst und beim Lesen wieder
stringifiziert werden.

- [x] `SETTINGS_SECTIONS: Record<string, string>` — Key → Sektionsname, exakt die
      vier Frontend-Keys aus der Tabelle oben.
- [x] `isSettingsKey(key): boolean`
- [x] `toSections(snapshot: Record<string, string>): Record<string, unknown>` —
      parst jeden Wert; ein unparsbarer Wert wird **übersprungen**, nicht als
      String durchgereicht (sonst steht JSON-in-JSON in der editierbaren Datei).
- [x] `fromSections(doc: Record<string, unknown>): Record<string, string>` —
      Rückrichtung, stringifiziert.
- [x] Round-Trip-Assert in beide Richtungen. Gilt, weil jeder Wert im Snapshot
      ohnehin von `JSON.stringify` stammt — die App ist der einzige Schreiber,
      die Kodierung ist also kanonisch.
- [x] Assert: `version` und unbekannte Sektionen werden beim Einlesen ignoriert,
      statt erfundene localStorage-Keys zu erzeugen.

**Entscheidung: Literale statt Imports.** Die Map steht als Stringliteral da und
importiert die vier Key-Konstanten *nicht*. Grund ist die Bootreihenfolge, vor
der `core/app/main.ts` ausdrücklich warnt: das Modul läuft vor dem App-Modulgraph,
und ein Import aus `core/app/settings/` zöge genau die Composables in diesen Pfad,
die beim Import localStorage lesen. Die Drift-Gefahr fängt stattdessen der Assert
ab — er importiert die echten Konstanten und vergleicht sie gegen die Literale,
inklusive „genau diese vier, nicht mehr und nicht weniger". Ein umbenannter Key
verschöbe seine Sektion sonst stillschweigend zurück in die verschlüsselte Datei.

**Zusätzlich abgesichert, weil die Datei von Hand editierbar wird:**
Sektionsnamen werden über eine `Map` aufgelöst, nicht über Objektzugriff — eine
Sektion namens `__proto__` ist damit ein gewöhnlicher Fehlschlag statt einer
Überraschung. Der Assert dafür parst bewusst per `JSON.parse` statt ein Literal
zu schreiben: in einem Objektliteral setzt `__proto__` den Prototyp und wird nie
eigene Property, der Test wäre also grün geworden, ohne je den Code zu berühren.
Zweiter Assert pinnt, dass keine Sektion `version` heißen darf — das Feld gehört
dem Host. Dritter Assert listet acht State-Keys (Layout, Widget-Daten, Palette-
Historie …) und verlangt, dass keiner als Setting gilt: jeder davon wäre im
Klartext geschrieben und damit eine Offenlegung, nicht nur ein Formatfehler.

*Accept when:* `npx tsx core/app/system/settingsSections.assert.ts` grün.

**Ergebnis:** grün. `npm run verify` komplett grün — 157 Assert-Dateien (die neue
als 74/157), dazu Typecheck und ESLint.

---

### Phase 3 — Rust-seitiger Settings-Store ✅ Code erledigt (2026-09-02), ein Kriterium hängt an Phase 4

**Files:** Create `src-tauri/src/settings_store.rs`; modify `lib.rs`.

- [x] `settings_load() -> Result<Option<String>, String>` — ganzes Dokument.
- [x] `settings_save_sections(sections: serde_json::Map<String, Value>)` —
      Read-Modify-Write: lädt, merged nur die übergebenen Top-Level-Sektionen,
      schreibt atomar. Sektionen, die der Aufrufer nicht nennt, bleiben stehen.
- [x] `settings_file_path() -> Result<String, String>` — legt die Datei an, falls
      sie fehlt, und gibt den Pfad zurück. Der Palette-Command aus Phase 6 soll
      nie „Datei nicht gefunden" melden müssen.
- [ ] ~~Interne Helper `read_section` / `write_section`~~ → **nach Phase 5
      verschoben.** Sie haben bis dahin keinen Aufrufer, und `-D warnings` lehnt
      toten Code zu Recht ab. Sie entstehen dort, wo `mcp/settings.rs` und
      `llm/prefs.rs` sie tatsächlich benutzen.
- [x] Quarantäne bei kaputtem JSON, Muster aus `web_storage::quarantine`.
      Zusätzlich BOM-tolerant beim Parsen — die Datei soll in Notepad editierbar
      sein, und Notepad schreibt eine BOM, die `JSON.parse` ablehnt.
- [x] Migration `migrate_legacy_files(app)`, einmalig, idempotent. Erst nach
      erfolgreichem Schreiben die Altdatei löschen. Existiert die Sektion schon,
      gewinnt `settings.json`. Eine unlesbare Altdatei bleibt liegen: was wir
      nicht lesen konnten, dürfen wir nicht löschen.
- [x] Commands in `lib.rs` registrieren, Migration vor dem MCP-Boot-Read.
- [x] Unit-Tests (11 Stück): Merge lässt fremde Sektionen stehen; eine Sektion aus
      einem neueren Build überlebt den Save eines älteren; `version` ist gestempelt
      und als Sektion abgelehnt; kaputter Handedit wird quarantäniert statt
      überschrieben; Migration ist idempotent, überschreibt keine vorhandene
      Sektion, lässt unlesbare Altdateien liegen; kein `.tmp` bleibt zurück.

**Nur `appearance.json` wird jetzt migriert, nicht `mcp-server.json` und
`llm-models.json`.** Der Unterschied ist nicht Bequemlichkeit, sondern
Datenverlust: Appearance liegt zusätzlich in localStorage, das Löschen der Datei
kostet also nichts. Für MCP und AI ist die Datei die *einzige* Kopie und Rust der
einzige Leser — sie vor Phase 5 zu migrieren hieße, eine Einstellung zu löschen,
die weiterhin am alten Pfad gelesen wird. Die beiden Einträge kommen in Phase 5
zusammen mit ihren Konsumenten dazu.

*Accept when:* `npm run verify:rust` grün; eine von Hand angelegte
`appearance.json` taucht nach dem Start als Sektion in `settings.json` auf und
die Altdatei ist weg.

**Ergebnis:** `cargo fmt`/clippy sauber, 483 `cargo test --lib` grün (11 neu).
Echter Lauf gegen ein Wegwerf-Verzeichnis mit hand-angelegter
`appearance.json` **und** einer fremden Sektion `telemetry`:

```json
{ "appearance": { "fontId": "jetbrains", "surfaceBlur": 24 },
  "telemetry": { "enabled": true },
  "version": 1 }
```

Log: `[settings] migrated appearance.json into section 'appearance'`. Migration,
Merge-Verhalten und Formatierung stimmen.

**„Die Altdatei ist weg" traf zunächst nicht zu, jetzt schon.** Die Migration
löschte `appearance.json` korrekt, aber `useAppearance` rief beim Boot weiterhin
`appearance_preferences_load` → `None` → `persist()` und legte die Datei sofort
wieder an (nachweisbar am Inhalt: nach dem Lauf standen dort die 14 Default-Felder
aus localStorage, nicht die zwei migrierten). Kein Fehler im Store, sondern die
Sequenz — der Schreiber verschwand erst in Phase 4. Nach Phase 4 nachgeprüft und
grün: `appearance.json` bleibt weg.

---

### Phase 4 — Frontend-Spiegelung splitten ✅ erledigt (2026-09-02)

**Files:** Modify `core/app/system/durableStorage.ts`, `core/app/settings/useAppearance.ts`,
`src-tauri/src/appearance_prefs.rs`.

- [x] `snapshot()` splittet in zwei Maps: Settings-Keys (via `isSettingsKey`) und Rest.
- [x] `save()` ruft `web_storage_save` mit dem Rest und `settings_save_sections`
      mit `toSections(settings)`. Beide werden versucht, auch wenn eines scheitert:
      ein fehlgeschlagener Settings-Write ist kein Grund, die Notizen fallenzulassen.
- [x] `hydrateDurableStorage()` lädt beide und schreibt beide nach localStorage.
      Bei Lesefehler **einer** der Dateien wird nur deren Spiegelung deaktiviert
      (`mirroring.settings` / `mirroring.state` statt eines gemeinsamen Flags).
- [x] `mirror: false` (Quick-Action-Popup) verhält sich unverändert.
- [x] `useAppearance.ts`: `appearance_preferences_save` / `_load` und den
      Doppel-Write entfernt; `applyPersistedState` mit entfallen.
- [x] `appearance_prefs.rs`: Appearance-Commands gelöscht, Onboarding bleibt.

**Reihenfolge in der Hydration ist tragend:** Erst `web-storage.json`, dann
`settings.json`. Eine Installation von vor dem Split hat die vier Settings-Keys
noch *innerhalb* von `web-storage.json`; weil `settings.json` zuletzt angewandt
wird, gewinnt das neue Zuhause überall dort, wo es einen Wert hat, und der erste
Save schiebt die Keys hinüber. Dieser erste Save *ist* die Migration — kein
eigener Schritt, läuft von selbst.

**Nebeneffekt:** Der Appearance-Flash beim Start ist weg. Bisher wurden erst die
localStorage-Werte auf das Dokument angewandt und nach dem Auflösen des
AppData-Reads ein zweites Mal die dortigen — sichtbar, wenn beide differierten.
Jetzt gibt es nur noch eine Quelle.

*Accept when:* Settings ändern → `settings.json` enthält die Werte als lesbares
verschachteltes JSON; App neu starten → Werte sind da; `settings.json` löschen →
Defaults, kein Absturz. Widget-Notizen sind weiterhin **nicht** in `settings.json`.

**Ergebnis:** `npm run verify` grün (157 Asserts), clippy sauber, 483 Rust-Tests grün.

Der entscheidende Nachweis, dass der Split wirklich trennt und nicht doppelt
schreibt: Instanz gestoppt, `settings.json` **und** das WebView-Profil (also
localStorage) gelöscht, nur `web-storage.json` stehengelassen, neu gestartet.
Ergebnis `{ "version": 1 }` — kein `appearance`. Läge es weiterhin auch in der
verschlüsselten Datei, wäre es von dort zurückgekommen. Settings stehen also
ausschließlich in `settings.json`, und `web-storage.json` trägt nur noch State.

**Isolierte Testläufe sind jetzt möglich.** Zusätzlich zu `KAVIBAY_DATA_DIR` setzt
man `WEBVIEW2_USER_DATA_FOLDER` (WebView2s eigene Variable) — damit bekommt die
Dev-Instanz auch ein eigenes `localStorage` und schreibt garantiert nicht über den
Mirror einer parallel laufenden Instanz in deren echte Dateien. Das hebt die in
Phase 1 notierte Grenze auf; in `AGENTS.md` dokumentiert.

---

### Phase 5 — Rust-eigene Sektionen umhängen ✅ erledigt (2026-09-02)

**Files:** Modify `src-tauri/src/mcp/settings.rs`, `src-tauri/src/llm/prefs.rs`,
`src-tauri/src/settings_store.rs`.

- [x] `settings_store`: `read_section` / `write_section` nachgeholt — jetzt haben
      sie Aufrufer (siehe Phase 3).
- [x] `mcp/settings.rs`: `load`/`save` über die Sektion `mcpServer`.
      `parse_config`, `valid_port` und Fail-Closed bleiben unverändert; `save`
      validiert den Port weiterhin *vor* dem Schreiben.
- [x] `llm/prefs.rs`: dasselbe für `ai`. `read_raw` liefert die Sektion als
      JSON-Text statt Dateiinhalt, `write_raw` ersetzt die vier `fs::write`.
      Dass die `parse_*`/`render_*`-Helfer auf Text arbeiten, war hier ein
      Glücksfall: die Sektion *ist* das Objekt, das vorher in der Datei stand,
      also ändert sich nur die Quelle und kein einziger Helfer oder Test.
- [x] `config_path_for` / `load_from_path` / `save_to_path` / `prefs_path`
      entfallen. Die MCP-Tests testen jetzt die Ebene, die es noch gibt:
      `parse_config` (korrupt / unvollständig / unbekanntes Feld / privilegierter
      Port → Default) und den Round-Trip über `serde_json::to_value`, statt
      Dateien in `temp_dir` anzulegen. Vier Tests statt drei.
- [x] `LEGACY_FILES` um `mcp-server.json` → `mcpServer` und `llm-models.json` →
      `ai` ergänzt — im selben Build wie der Umbau der Leser, weil ein
      Zwischenstand aus „Migration löscht die Datei" und „Leser liest noch die
      Datei" die Einstellung vernichtet hätte.

*Accept when:* MCP-Server-Toggle und AI-Modell-Switches überleben einen Neustart,
und `settings.json` hat genau eine Sektion pro Bereich. `npm run verify:rust` grün.

**Ergebnis:** clippy sauber, `cargo fmt` sauber, 484 Tests grün.

Isolierter Lauf mit allen drei Altdateien vorbelegt → alle drei migriert, alle
drei gelöscht, ein Dokument:

```json
{ "ai": { "disabled": ["claude-opus-5"], "quickModel": "claude-haiku-4-5-20251001" },
  "appearance": { "fontId": "jetbrains" },
  "mcpServer": { "enabled": false, "port": 45123 },
  "version": 1 }
```

Dass die Sektion auch wirklich *gelesen* wird — und nicht nur geschrieben —
ist per Handedit belegt, was zugleich das eigentliche Versprechen der Datei
prüft: `"enabled": false` → `true` im Editor geändert, App neu gestartet, danach
lauscht `127.0.0.1:45123`. Der MCP-Listener kommt also aus einer von Hand
editierten Sektion hoch, nicht aus der gelöschten `mcp-server.json`.

---

### Phase 6 — Palette-Commands ✅ erledigt (2026-09-02)

**Files:** Modify `core/app/palette/commands.ts`, `core/app/palette/CommandPalette.vue`,
`core/app/palette/paletteResults.assert.ts`, `src-tauri/src/settings_store.rs`, `lib.rs`.

- [x] `settings-open-file` — „Open settings.json". Öffnet die Datei im
      Standard-Editor.
- [x] `settings-reveal-folder` — „Reveal Settings Folder". Nutzt das vorhandene
      `reveal_in_file_manager` mit dem Pfad aus `settings_file_path`.
- [x] Dispatch in `CommandPalette.vue`, **vor** dem `open-settings-`-Zweig.
- [x] Datei wird vor dem Öffnen materialisiert (`ensure_settings_file`).

**Die Ids heißen nicht `open-settings-*`.** Der Dispatcher liest diesen Präfix als
„öffne diesen Settings-Abschnitt" (`row.commandId.slice("open-settings-".length)`),
ein Command namens `open-settings-file` wäre also im Modal gelandet, mit `file`
als Abschnittsnamen — lautlos falsch, und im Review nicht zu sehen, weil der
Eintrag völlig normal aussieht. Ein Assert pinnt das jetzt, statt eines Kommentars.

**`settings_file_open` ist ein eigener Rust-Command**, kein generisches „öffne
diesen Pfad" mit dem Pfad aus JS. Letzteres hätte der WebView die Fähigkeit
gegeben, beliebige Dateien vom Host starten zu lassen — eine Fähigkeit, die diese
App nie hatte und für einen Palette-Eintrag auf genau ein bekanntes Dokument
nicht braucht.

*Accept when:* „settings.json" in der Palette tippen öffnet die Datei im Editor;
„settings folder" öffnet den Explorer mit markierter Datei.

**Ergebnis:** `npm run verify` grün (157 Asserts), clippy sauber, 484 Rust-Tests.

Neue Asserts in `paletteResults.assert.ts` prüfen gegen die *echte*
Command-Registry: beide Commands registriert, keiner benutzt den Präfix des
Dispatchers, und die Suchtreffer stimmen — „settings.json", „config",
„settings folder" und „appdata" finden jeweils den richtigen Eintrag.

**Nicht automatisiert:** der letzte Klick in der Palette selbst. Sie lebt in der
Tauri-WebView, für die es hier keinen Treiber gibt (die Browser-Tools steuern
einen separaten In-App-Browser). Verdrahtung, Registrierung und Trefferlogik sind
geprüft, der Editor-Start ist es nicht.

---

## Out of scope

- **File-Watcher / Live-Reload bei Handedit.** VS Code macht das; hier kostet es
  einen Watcher plus Konfliktauflösung gegen laufende UI-Writes. In v1 gilt:
  editieren, wenn die App zu ist. Das muss im Doku-Kommentar der Datei stehen,
  sonst ist der erste stille Overwrite ein Bugreport.
- **Portable Mode** (Settings neben der exe). Anderes Feature, kollidiert mit
  DPAPI und dem Keychain.
- **Export/Import eines Profils.** Der naheliegende nächste Schritt, sobald es
  eine Datei gibt — aber Secrets müssten per Konstruktion draußen bleiben, das
  ist eine eigene Design-Entscheidung.
- **`kavibay:widget-config:*` nach `settings.json` ziehen.** Siehe oben.
- **JSON-Schema / Autocomplete für die Datei.** Erst sinnvoll, wenn das Format steht.

## Risiken

- **Ein Torn Write kostet jetzt alle Settings statt einer Datei.** Gegenmaßnahme:
  atomarer Rename plus Quarantäne, beides in Phase 3 verpflichtend.
- **Zwei Schreiber auf einer Datei** (Rust beim Boot, Frontend beim Settings-Change).
  Gegenmaßnahme: nur Sektions-Merge, nie Vollersetzung. Deshalb gibt es
  `settings_save_sections` und kein `settings_save`.
- **Editierbarkeit lädt zu Handedits ein, die die App überschreibt.** Gegenmaßnahme:
  dokumentieren; Watcher bewusst aufgeschoben.
- **Migrationsfenster:** Wer zwischen zwei Builds hin- und herwechselt, verliert
  Appearance-Änderungen der jeweils anderen Version. Akzeptabel für ein Pre-1.0
  Single-User-Tool, aber die Migration darf Altdateien deshalb erst nach
  erfolgreichem Schreiben löschen.
