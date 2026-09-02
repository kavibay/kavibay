import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { confettiBurstForIntensity } from "./confettiLogic";

const confettiExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    actions: {
      launch: async ({ args }) => {
        // Load the browser-only animation library only when the action runs;
        // extension metadata must remain importable in the Node assert suite.
        const { default: confetti } = await import("@hiseb/confetti");
        confetti(confettiBurstForIntensity(args.intensity));
      },
    },
  },
});

export default confettiExtension;
