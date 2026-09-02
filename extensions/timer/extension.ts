// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { timerWidget } from "./widgets/timer";

export const timerExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [timerWidget],
  },
});

export default timerExtension;
