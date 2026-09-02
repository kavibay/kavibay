// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { pomodoroWidget } from "./widgets/pomodoro";

export const pomodoroExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: { widgets: [pomodoroWidget] },
});

export default pomodoroExtension;
