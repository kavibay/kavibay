import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { calculatorWidget } from "./widgets/calculator";

export const calculatorExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [calculatorWidget],
  },
});

export default calculatorExtension;
