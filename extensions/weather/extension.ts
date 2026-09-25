// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { weatherProvider } from "./provider";
import { weatherWidget } from "./widgets/weather";

export const weatherExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    /**
     * The widget reads the provider's `forecast` query, so its data lives in
     * the host cache and survives the card unmounting whenever the cockpit
     * closes.
     */
    providers: [weatherProvider],
    widgets: [weatherWidget],
  },
});

export default weatherExtension;
