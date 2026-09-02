// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { systemInfoWidget } from "./widgets/systemInfo";

const systemInfoExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [systemInfoWidget],
  },
});

export default systemInfoExtension;
