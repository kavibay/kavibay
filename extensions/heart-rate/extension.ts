// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { heartRateProvider } from "./provider";

export const heartRateExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    providers: [heartRateProvider],
  },
});

export default heartRateExtension;
