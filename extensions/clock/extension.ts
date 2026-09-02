import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { clockWidget } from "./widgets/clock";

/**
 * Assembly only. Identity comes from `manifest.json` the same way a widget
 * package states it, and each contribution comes from the file that owns it.
 *
 * Clock contributes no provider and no command, and that is visible here rather
 * than by reading to the end of a long file.
 */
export const clockExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [clockWidget],
  },
});

/** The host discovers an extension by this file's default export. */
export default clockExtension;
