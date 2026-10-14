// SPDX-License-Identifier: MIT
import { defineProvider, type HeartRateReading } from "@sdk/contract/sdk";

/**
 * Heart Rate: the live pulse from a Bluetooth LE heart-rate sensor.
 *
 * The reading comes from `host.heartRate`, a reviewed host capability backed by
 * `src-tauri/src/extensions/heart_rate/` — not from the network, so `hosts` is
 * empty and no credential is involved. A widget sees only the `live` query.
 *
 * The 1 s staleTime is the subscription interval too (`QueryCache`), so a
 * subscribed widget stays as current as the sensor's own once-a-second
 * notifications.
 */

export const PROVIDER_ID = "kavibay.heart-rate/heart-rate";

const NOT_CONNECTED: HeartRateReading = { bpm: null, at: null, connected: false };

export const heartRateProvider = defineProvider({
  name: "heart-rate",
  displayName: "Heart Rate (Bluetooth)",
  requiresCredential: false,
  hosts: [],
  heartRate: true,
  queries: {
    live: {
      description:
        "The latest heart rate in bpm from a Bluetooth heart-rate sensor (e.g. a Fitbit Air sharing its heart rate), when it arrived (ms since epoch) and whether a sensor is connected; bpm is null until a sensor is found or while it is off the wrist",
      args: {},
      result: {
        type: "object",
        fields: {
          bpm: { type: "number", nullable: true },
          at: { type: "number", nullable: true },
          connected: { type: "boolean" },
        },
      },
      key: () => [],
      staleTime: 1_000,
      // Absent outside the desktop app (tests, the web demo): no sensor, not an error.
      fetch: async (_args: Record<string, never>, host): Promise<HeartRateReading> =>
        host.heartRate ? host.heartRate.latest() : NOT_CONNECTED,
    },
  },
  actions: {},
});
