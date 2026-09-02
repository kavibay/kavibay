import type { WidgetInstance } from "@sdk/contract/sdk";
import { embedWidgets } from "./catalog";
import { embedDefinitionId, embedHost } from "./embedHost";

/**
 * Runs a contributed palette action, the way the app runs one.
 *
 * WHY THIS EXISTS AT ALL:
 *
 * A palette row of kind `action` is not just a request to open a card. The
 * Widget Wizard's "New Widget" row is the example that made this visible: its
 * handler sets a request flag, and the Wizard consumes that flag when the host
 * hands it focus, which is what folds the project list and the header chrome
 * away — somebody who pressed "New Widget" has exactly one thing to do.
 *
 * Without the handler the demo opened a Wizard that looked like a returning
 * visitor's, not like the one that gesture actually produces. The palette was
 * announcing the row and skipping the action behind it.
 *
 * WHY IT LOOKS THE ACTION UP INSTEAD OF NAMING IT:
 *
 * `WidgetDefinition.actions` is contract, not Wizard-specific: any widget may
 * declare a handler, and `demoRows.ts` copies action rows from manifests. A
 * lookup keeps this file from knowing what the Widget Wizard is — the same
 * rule `demoScripts.ts` follows. The row carries an id and no widget, exactly
 * as the manifest declares it, so finding the handler means asking every
 * widget in the catalog. There are thirteen.
 *
 * WHAT IT DOES NOT DO:
 *
 * Open anything. In the app the handler asks the host for a card and the host
 * decides which; here `<kavibay-widget opens-on="…">` already answers that,
 * from the markup. So this runs the handler and stops — the palette's own
 * `kavibay-palette-open` event is still what reveals the card.
 */
export async function runEmbedAction(
  actionId: string,
  /**
   * Values the visitor typed into the row's chips, by parameter name — the
   * `args` half of `WidgetActionContext`. "New Note" reads `args.text`.
   */
  args: Record<string, string> = {},
  /**
   * The card the action writes into, for an action that targets one.
   *
   * Empty is the contract's own answer for an action declared
   * `needsInstance: false` (`cockpit.ts` builds exactly this): it scopes
   * `ctx.data` to nothing, which is right when the action targets no card.
   * "New Note" is the other kind — it stores markdown under the instance the
   * card will read on mount, so the wrong id here writes a note nobody sees.
   */
  instanceId = "",
): Promise<boolean> {
  for (const widget of embedWidgets()) {
    const run = widget.definition.actions?.[actionId];
    if (!run) continue;

    const instance: WidgetInstance = {
      id: instanceId,
      definitionId: embedDefinitionId(widget.extensionName, widget.name),
      configuration: {},
      position: { x: 0, y: 0 },
      size: widget.definition.defaultSize,
      mode: "expanded",
    };

    await run({
      ctx: embedHost().buildWidgetContext(instance),
      args,
      // Nothing to write back to: these demo cards carry no configuration of
      // their own, and the app's handler for a shared action skips this too.
      setConfig: () => {},
    });
    return true;
  }

  return false;
}
