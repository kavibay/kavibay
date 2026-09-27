import type { ProviderId } from "@sdk/contract/sdk";
import type { ExtensionRegistry } from "./registry";
import { requestedPermissions, type ApprovedGrant } from "./widgetPackage";

/**
 * What the approval dialog shows, and what it hands back.
 *
 * The decision a person makes is **which accounts a widget may use** — not
 * which queries. FINDINGS §27: "may this widget use tado°?" is a question
 * somebody can answer; "may it use zoneStates?" is one they click through, and
 * a dialog people click through protects nothing.
 *
 * That the finer list is gone does not make this file thinner in purpose. It is
 * still the only place that turns a package's *request* into a person's
 * *answer*, and `widgetPackageManifest` still refuses to load a package whose
 * declaration disagrees with the grant it is handed. A dialog that returns a
 * grant nobody ticked is not something a screenshot catches, which is why the
 * logic lives here and is tested rather than living in the view.
 */

export interface PermissionChoice {
  provider: ProviderId;
  /** "tado°", not "kavibay.tado/tado". */
  providerName: string;
  /** What reading from it gets the widget, in the provider's own words. */
  summary: string;
  /**
   * False unless this exact provider is already approved for this package.
   *
   * Nothing the *package* asks for pre-ticks a box — a request is not a
   * decision. A tick here can only come from a decision the person already
   * made, for this same widget.
   */
  granted: boolean;
  /**
   * The account is not connected, or the provider is not installed at all.
   *
   * Shown rather than disabled: a widget that wants an account you have not set
   * up is still a widget you may want. Refusing to offer it leaves the person
   * guessing; offering it and saying so points at Settings.
   */
  note?: string;
  /**
   * The changes it asks to make on this account, when it declares any.
   *
   * One answer for all of them, not one per action: "may change your heating"
   * is a decision; "may call setTemperature but not boost" is the per-query
   * dialog FINDINGS §27 deleted, one level down.
   */
  actions?: ActionChoice;
}

export interface ActionChoice {
  /** The declared actions this provider actually has. */
  names: string[];
  /** What they do, in the provider's own words. */
  summary: string;
  /** Only ever ticked by an earlier decision covering every one of `names`. */
  granted: boolean;
}

export interface PermissionRequest {
  choices: PermissionChoice[];
  /**
   * Providers the package named that this install does not have, shown so the
   * person can see what it wanted rather than wondering what the rest does.
   */
  refused: string[];
}

/**
 * Builds the request from a package manifest and the providers installed.
 *
 * A provider nobody ships is refused rather than offered. A generated manifest
 * naming one that does not exist is the ordinary case, not an attack — and
 * asking somebody to approve something meaningless teaches them to click
 * through, which costs more than any single grant.
 */
export function buildPermissionRequest(
  raw: unknown,
  registry: ExtensionRegistry,
  /**
   * What this package was already granted, if it is installed and enabled.
   *
   * Read from the install record, never from the manifest: the package states
   * what it wants and the person states what it gets, and that separation is
   * the whole point of `widgetPackageManifest(raw, approved)`.
   */
  alreadyGranted: ApprovedGrant = { providers: [], actions: {} },
): PermissionRequest {
  const asked = requestedPermissions(raw);
  const choices: PermissionChoice[] = [];
  const refused: string[] = [];

  for (const pid of asked.providers) {
    const provider = registry.providers.get(pid);
    if (!provider) {
      refused.push(pid);
      continue;
    }
    const declared = asked.actions[pid] ?? [];
    const names = declared.filter((name) => provider.def.actions[name]);
    // An action the provider does not have is offered to nobody, like a
    // provider nobody ships; loading the package would refuse it anyway.
    refused.push(...declared.filter((name) => !provider.def.actions[name]).map((name) => `${pid}.${name}`));
    const approvedActions = alreadyGranted.actions[pid] ?? [];
    choices.push({
      provider: pid,
      providerName: provider.def.displayName,
      summary: summarize(provider.def),
      // Fail closed, in the UI as well as in the host.
      granted: alreadyGranted.providers.includes(pid),
      ...(provider.def.requiresCredential ? {} : { note: "No account needed" }),
      ...(names.length > 0
        ? {
            actions: {
              names,
              summary: summarizeActions(provider.def, names),
              granted: names.every((name) => approvedActions.includes(name)),
            },
          }
        : {}),
    });
  }

  return { choices, refused };
}

/**
 * One sentence about what reading from this provider gets you.
 *
 * Built from the queries' own descriptions rather than from their names, which
 * is finding 20's point surviving the move: the names were never the thing a
 * person could decide about, and now that the decision is per provider the
 * sentence has to cover the whole account rather than one call.
 */
function summarizeActions(
  def: { actions: Record<string, { description?: string }> },
  names: readonly string[],
): string {
  return names.map((name) => def.actions[name]?.description ?? name).join("; ");
}

function summarize(def: { queries: Record<string, { description?: string }> }): string {
  const sentences = Object.entries(def.queries)
    .map(([name, query]) => query.description ?? name)
    .filter((entry) => entry.length > 0);
  if (sentences.length === 0) return "Reads nothing yet";
  if (sentences.length <= 2) return sentences.join("; ");
  return `${sentences.slice(0, 2).join("; ")}, and ${sentences.length - 2} more`;
}

/**
 * True when every provider this asks for is already approved — so there is
 * nothing left to decide.
 *
 * Asking again anyway is not caution. A dialog that returns unchanged on every
 * iteration is one people learn to dismiss without reading, and then the dialog
 * that *does* ask for something new gets dismissed with it. Finding 20 makes
 * this argument about unlabelled queries; it is the same argument.
 *
 * Deliberately one-directional: a package asking for *less* than it was granted
 * still needs nothing decided. Narrowing is the user's to do in Settings, not
 * something to interrupt an edit for.
 */
export function askedNothingNew(
  request: PermissionRequest,
  granted: ApprovedGrant | null | undefined,
): boolean {
  if (!granted) return false;
  // A refused provider is not on offer, so it cannot be part of a decision.
  return request.choices.every(
    (choice) =>
      granted.providers.includes(choice.provider) &&
      (choice.actions?.names ?? []).every((name) => (granted.actions[choice.provider] ?? []).includes(name)),
  );
}

/**
 * The grant, from what is ticked and nothing else.
 *
 * There is no argument a caller could pass to widen it, which is the point of
 * it being here rather than being a flag somebody sets in a later refactor.
 */
export function grantFrom(request: PermissionRequest): ApprovedGrant {
  const granted = request.choices.filter((choice) => choice.granted);
  return {
    providers: granted.map((choice) => choice.provider),
    // Changes only on an account that may also be read: a write permission on
    // something the widget may not see is not a state the dialog can produce.
    actions: Object.fromEntries(
      granted
        .filter((choice) => choice.actions?.granted)
        .map((choice) => [choice.provider, [...(choice.actions?.names ?? [])]]),
    ),
  };
}
