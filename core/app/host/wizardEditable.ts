/**
 * Whether a widget's own package can be reopened in the Widget Wizard.
 *
 * Kept as a named predicate because two different `origin` fields meet here and
 * they read alike. `HostExtensionRef.origin` says how the widget *loads*
 * (`builtin` vs `runtime`); `packageOrigin` says which root it was *scanned
 * from* (`installed` vs `custom`). Only the second one answers "did the Wizard
 * build this", and reaching for the first — the obvious-looking mistake — puts
 * an edit offer on every dropped-in package, where it opens the Wizard on a
 * draft that was never there.
 */
import type { HostExtensionRef } from "../runtime/runtimeTypes";

/** Just the two fields the answer depends on, so callers can pass a stub. */
export type WizardEditableRef = Pick<HostExtensionRef, "origin" | "packageOrigin">;

export function canEditInWizard(def: WizardEditableRef): boolean {
  return def.origin === "runtime" && def.packageOrigin === "custom";
}
