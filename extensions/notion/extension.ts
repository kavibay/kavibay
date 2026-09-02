// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { notionProvider } from "./provider";

export const notionExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    providers: [notionProvider],
  },
});

export default notionExtension;
