import { defineWidget } from "@sdk/contract/sdk";

/**
 * The cover itself is the card's surface: black, opaque, 16px corners, set
 * under `ui.appearance` in the manifest. With `editable` there, each instance
 * changes colour, opacity, blur and radius in its settings, drawn by the host.
 * The widget has nothing of its own to configure or render.
 */
export const redactedWidget = defineWidget({
  name: "redacted",
  displayName: "Redacted",
  description: "Opaque cover for sensitive areas while screensharing.",
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  mode: "both",
  component: {
    setup: () => ({}),
  },
});
