/**
 * Whether a contract extension contributes anything the host can load.
 *
 * Widgets and standalone actions are declared in the manifest. A provider lives
 * in `provider.ts` — the same file `build:provider-doc` discovers — because the
 * manifest is not a trust or permission input.
 */
export function hasContractSurface({ hasWidgets, hasActions, hasProvider }) {
  return Boolean(hasWidgets || hasActions || hasProvider);
}
