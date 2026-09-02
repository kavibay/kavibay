import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { tadoProvider } from "./provider";
import { tadoTile } from "./widgets/tile";

/**
 * tado° on the contract — the shipping widget's behaviour, not the reference
 * fixture's.
 *
 * This file is only the assembly: identity comes from `manifest.json` the same
 * way a widget package states it, and each contribution comes from the file
 * that owns it. What it contributes is therefore readable in one screen, which
 * is the point of the split — a provider and a widget are reviewed against
 * very different questions.
 */
export const tadoLiveExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  engines: manifest.engines,
  contributes: {
    providers: [tadoProvider],
    widgets: [tadoTile],
  },
});

/** The host discovers an extension by this file's default export. */
export default tadoLiveExtension;
