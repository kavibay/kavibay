// SPDX-License-Identifier: MIT
/**
 * Heart Rate provider: passes the host reading through, and reads as "no
 * sensor" where the capability is absent.
 * Run: npx tsx extensions/heart-rate/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { heartRateProvider } from "./provider";

function deepStrictEqual(actual: unknown, expected: unknown) {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const http = {} as ProviderHostContext["http"];
const credentials = { isConnected: async () => true };
const live = heartRateProvider.queries.live.fetch;

deepStrictEqual(
  await live({}, {
    http,
    credentials,
    heartRate: { latest: async () => ({ bpm: 64, at: 1_760_000_000_000, connected: true }) },
  }),
  { bpm: 64, at: 1_760_000_000_000, connected: true },
);
deepStrictEqual(await live({}, { http, credentials }), { bpm: null, at: null, connected: false });

console.log("heart-rate provider: ok");
