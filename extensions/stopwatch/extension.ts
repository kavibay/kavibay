import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { stopwatchWidget } from "./widgets/stopwatch";

export const stopwatchExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [stopwatchWidget],
  },
});

/** The host discovers an extension by this file's default export. */
export default stopwatchExtension;

