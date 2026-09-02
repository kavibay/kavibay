import { ExtensionRegistry, bundledDefinitionId } from "../../app/extension-host/registry";
import { Host, type HostUi } from "../../app/extension-host/runtime";
import type { Fetcher } from "../../app/extension-host/http";
import { EMBED_EXTENSIONS } from "./catalog";
import { browserCapabilityTransport } from "./browserCapabilityTransport";

/**
 * One real extension host for the page.
 *
 * This is the app's `Host`, its `ExtensionRegistry` and — through
 * `useWidgetRuntime` — the app's `buildWidgetContext`. A widget mounted here
 * therefore gets the same `WidgetContext` it gets on the desktop, and the same
 * gate decides whether it may render. That is what makes "1:1" a fact rather
 * than a resemblance: there is no second implementation to drift.
 *
 * WHAT IS DELIBERATELY MISSING, AND WHY IT IS A FEATURE:
 *
 * `Host` takes an optional `ProviderTransport` — omitted, because this page
 * holds no credential and a widget that reached for an account would be one
 * that does not belong in `catalog.ts`. The fetcher rejects for the same
 * reason: nothing here fetches, and anything that starts to should fail on the
 * first call rather than quietly reach the network from a marketing page.
 *
 * The capability transport *is* supplied, and it is where the honesty lives:
 * `browserCapabilityTransport` throws for every OS capability, naming itself,
 * so a widget needing the clipboard fails visibly instead of rendering an
 * empty one. Its single exception is the Widget Wizard, whose conversation is
 * replayed from a script — see `wizardFixture.ts` for why that one can be
 * answered without lying.
 */
const refuse: Fetcher = async (url: string) => {
  throw new Error(`the embed host makes no network calls (${url})`);
};

/**
 * No dialogs on a web page. `prompt` resolving to undefined is the same answer
 * the contract gives for a cancelled prompt, which every caller already
 * handles; `confirm` says no, because a destructive action nobody can see the
 * question for must not proceed.
 */
const ui: HostUi = {
  prompt: async () => undefined,
  confirm: async () => false,
  notify: () => {},
};

function build(): Host {
  const registry = new ExtensionRegistry();
  for (const extension of EMBED_EXTENSIONS) registry.load(extension, { kind: "bundled" });
  registry.link();
  return new Host(registry, refuse, ui, undefined, browserCapabilityTransport);
}

let instance: Host | undefined;

/** Built on first use so a page that mounts no widget pays nothing. */
export function embedHost(): Host {
  instance ??= build();
  return instance;
}

/** The id the registry filed a widget under, from its extension and name. */
export function embedDefinitionId(extensionName: string, widgetName: string) {
  return bundledDefinitionId(extensionName, widgetName);
}
