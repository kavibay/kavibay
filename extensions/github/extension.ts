// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { githubProvider } from "./provider";
import { githubActionsWidget } from "./widgets/githubActions";

export const githubExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    providers: [githubProvider],
    widgets: [githubActionsWidget],
  },
});

export default githubExtension;
