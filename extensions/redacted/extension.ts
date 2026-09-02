import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { redactedWidget } from "./widgets/redacted";

export const redactedExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [redactedWidget],
  },
});

export default redactedExtension;
