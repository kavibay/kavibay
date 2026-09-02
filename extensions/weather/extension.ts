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
     * The provider is new; the widget is not, and still reads Open-Meteo
     * through its own `http` capability. Left alone deliberately — it works,
     * it has its own assertions, and moving a shipping widget onto the
     * provider is a visible change that deserves its own step. The cost of the
     * overlap is that the two do not share a cache entry.
     */
    providers: [weatherProvider],
    widgets: [weatherWidget],
  },
});

export default weatherExtension;
