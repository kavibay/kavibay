/**
 * Asserts for the "Edit in Wizard" menu condition.
 * Run: npx tsx core/app/host/wizardEditable.assert.ts
 */
import { canEditInWizard, type WizardEditableRef } from "./wizardEditable";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ref = (over: Partial<WizardEditableRef>): WizardEditableRef => ({
  origin: "runtime",
  packageOrigin: "custom",
  ...over,
});

assert(canEditInWizard(ref({})), "a runtime package from the custom root was built here");

// --- everything the Wizard has no draft for -------------------------------------
assert(
  !canEditInWizard(ref({ packageOrigin: "installed" })),
  "a dropped-in package was not built here",
);
assert(
  !canEditInWizard(ref({ packageOrigin: undefined })),
  "a ref carrying no root at all is not custom by default",
);
assert(
  !canEditInWizard(ref({ origin: "builtin", packageOrigin: undefined })),
  "a built-in widget ships in the binary and has no package to reopen",
);

// The trap this predicate exists for: a built-in can never be custom, so
// answering from `origin` alone would offer the edit on the wrong widgets.
assert(
  !canEditInWizard({ origin: "builtin", packageOrigin: "custom" }),
  "loading as a built-in outranks whatever root a ref claims",
);

console.log("wizardEditable.assert.ts ok");
