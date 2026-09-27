import { fromSections, toSections } from "../system/settingsSections";
import { buildTypeRows } from "../palette/paletteResults";
import { resolveInlineWidgetTarget } from "../palette/inlineWidgetTarget";
import { loadPaletteWidgets, movePaletteWidget, normalizePaletteWidgets, PALETTE_WIDGET_PREFS_KEY, savePaletteWidgets } from "./paletteWidgetPrefsLogic";

function equal(actual: unknown, expected: unknown, message = "values match") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

equal(normalizePaletteWidgets(null), ["clipboard"], "Clipboard is the initial shortcut");
equal(normalizePaletteWidgets({}), ["clipboard"], "invalid settings fall back to the default");
equal(normalizePaletteWidgets([]), [], "turning every shortcut off stays off");
equal(normalizePaletteWidgets(["notes", null, "", 42, "notes", "clipboard", "not-installed"]),
  ["notes", "clipboard", "not-installed"], "invalid entries and duplicates are removed without losing unavailable widgets");

const original = ["clipboard", "notes", "clock"];
const reordered = movePaletteWidget(original, "notes", -1);
equal(reordered, ["notes", "clipboard", "clock"], "a selected widget can become leftmost");
equal(original, ["clipboard", "notes", "clock"], "moving does not mutate the saved snapshot");
equal(movePaletteWidget(reordered, "notes", -1), reordered, "the first entry cannot move further left");
equal(movePaletteWidget(reordered, "clock", 1), reordered, "the last entry cannot move further right");
equal(movePaletteWidget(reordered, "unknown", 1), reordered, "moving an absent widget does nothing");

let stored: string | null = null;
const storage = {
  getItem: (key: string) => { equal(key, PALETTE_WIDGET_PREFS_KEY); return stored; },
  setItem: (key: string, value: string) => { equal(key, PALETTE_WIDGET_PREFS_KEY); stored = value; },
};
equal(loadPaletteWidgets(storage), ["clipboard"]);
savePaletteWidgets(reordered, storage);
equal(loadPaletteWidgets(storage), reordered, "selection and order survive restart");
savePaletteWidgets([], storage);
equal(loadPaletteWidgets(storage), [], "an empty selection survives restart");
stored = "bad json{";
equal(loadPaletteWidgets(storage), ["clipboard"], "corrupt JSON cannot break palette startup");
const snapshot = { [PALETTE_WIDGET_PREFS_KEY]: JSON.stringify(reordered) };
equal(toSections(snapshot), { searchWidgets: reordered }, "widget selection is a durable setting");
equal(fromSections(toSections(snapshot)), snapshot, "hydration restores the same selection and order");

// Shortcuts use the same catalog-to-inline path as normal widget results.
const catalog = [{ id: "clipboard", title: "Clipboard" }];
equal(resolveInlineWidgetTarget(buildTypeRows(catalog, [])[0]),
  { kind: "scratch", typeId: "clipboard", title: "Clipboard" }, "previewing an unplaced widget needs no desk card");
for (const hidden of [false, true]) {
  const instances = [{ instanceId: "existing-clipboard", typeId: "clipboard", hidden, offset: { x: 0, y: 0 } }];
  equal(resolveInlineWidgetTarget(buildTypeRows(catalog, instances)[0]),
    { kind: "instance", instanceId: "existing-clipboard", typeId: "clipboard", title: "Clipboard" },
    "a shortcut reuses the existing instance even when hidden");
  equal(instances[0].hidden, hidden, "previewing does not change desk visibility");
}
console.log("paletteWidgetPrefsLogic.assert: ok");
