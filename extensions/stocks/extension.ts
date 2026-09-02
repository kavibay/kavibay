// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { stocksWidget } from "./widgets/stocks";

export const stocksExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [stocksWidget],
  },
});

// The host discovers contract extensions through their default export.
export default stocksExtension;
