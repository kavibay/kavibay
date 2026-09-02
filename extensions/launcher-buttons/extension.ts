// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { launcherButtonsWidget } from "./widgets/launcherButtons";

const launcherButtonsExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: { widgets: [launcherButtonsWidget] },
});

export default launcherButtonsExtension;
