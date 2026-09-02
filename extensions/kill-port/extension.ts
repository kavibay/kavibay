import { invoke } from "@tauri-apps/api/core";
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { parsePort } from "./killPortLogic";

const killPortExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    actions: {
      "kill-port": async ({ args }) => {
        const port = parsePort(args.port ?? "");
        // Throwing keeps the palette open with the chip intact.
        if (port == null) throw new Error(`not a port: "${args.port ?? ""}"`);
        await invoke("kill_port", { port });
      },
    },
  },
});

export default killPortExtension;
