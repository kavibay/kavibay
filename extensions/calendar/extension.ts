// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { calendarProvider } from "./provider";
import { calendarWidget } from "./widgets/calendar";

export const calendarExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    providers: [calendarProvider],
    widgets: [calendarWidget],
  },
});

export default calendarExtension;
