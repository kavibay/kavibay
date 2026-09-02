/**
 * Contract contribution surfaces: widget, standalone action, or provider.
 * Run: node scripts/contractSurface.assert.mjs
 */
import { hasContractSurface } from "./contractSurface.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  hasContractSurface({ hasWidgets: true, hasActions: false, hasProvider: false }),
  "a widget is a contract surface",
);
assert(
  hasContractSurface({ hasWidgets: false, hasActions: true, hasProvider: false }),
  "a standalone palette action is a contract surface",
);
assert(
  hasContractSurface({ hasWidgets: false, hasActions: false, hasProvider: true }),
  "a provider with no widget and no action is a contract surface",
);
assert(
  !hasContractSurface({ hasWidgets: false, hasActions: false, hasProvider: false }),
  "an empty extension contributes nothing",
);

console.log("contractSurface.assert.mjs: ok");
