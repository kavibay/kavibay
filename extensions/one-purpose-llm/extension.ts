// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { onePurposeLlmWidget } from "./widgets/onePurposeLlm";

export const onePurposeLlmExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [onePurposeLlmWidget],
  },
});

export default onePurposeLlmExtension;
