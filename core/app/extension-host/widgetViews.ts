import type { Component } from "vue";
import type { WidgetDefinitionId } from "@sdk/contract/sdk";
import { bundledExtensions } from "./bundledExtensions";
import { bundledDefinitionId } from "./registry";
import TodoView from "./fixtures/TodoView.vue";
import TadoTemperatureView from "./fixtures/TadoTemperatureView.vue";

/**
 * Definition id → the Vue component that renders that widget's model.
 *
 * WHY A DEFINITION HAS NO `view` FIELD:
 *
 *  1. `sdk.ts` sections 1-7 carry no framework types, and that is enforced by
 *     the compiler rather than by discipline. A `Component` field would end
 *     that, and the contract is what Phase 6's generated widgets are checked
 *     against — it should not require Vue to describe a widget.
 *  2. The 37-assertion suite runs the widget definitions headlessly under
 *     `tsx`, which cannot compile an SFC. If a definition file imported its
 *     own `.vue`, the contract suite would stop running the moment a widget
 *     got a view.
 *
 * So a definition stays a plain object with a headless `setup(ctx)` returning a
 * model, and the mapping to pixels lives in the Vue layer, where the dependency
 * belongs. For a bundled extension that layer is its own `view.ts` — this file
 * only merges what the glob found, and no longer grows by a line per port.
 */
const contractViews: Partial<Record<WidgetDefinitionId, Component>> = {};
for (const extension of bundledExtensions) {
  for (const widget of extension.widgets) {
    if (!widget.view) continue; // the gate draws BrokenWidget's `no-view` case
    contractViews[bundledDefinitionId(extension.definition.name, widget.name)] = widget.view;
  }
}

export const widgetViews: Partial<Record<WidgetDefinitionId, Component>> = {
  /**
   * The reference fixtures, which have no folder under `extensions/` and are
   * not meant to get one: they exist for `scenarios.assert.ts` and the dev
   * board. `kavibay.tado/temperature` addresses endpoints tado° does not have
   * (finding 13) and stays out of the catalog, but it needs a view, because it
   * is the only widget that exercises the provider path through the gate —
   * without one the connect transition ended on a "no view" placeholder rather
   * than on data.
   */
  "kavibay.todo/list": TodoView,
  "kavibay.tado/temperature": TadoTemperatureView,

  ...contractViews,
};
