// SPDX-License-Identifier: MIT
/**
 * Run: npx tsx sdk/extension/contract/provider-schema.assert.ts
 */
import { defineProvider } from "./sdk";
import { describeProvider } from "./providerSchema";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const provider = defineProvider({
  name: "demo",
  displayName: "Demo",
  requiresCredential: true,
  credentialType: "demoOAuth2",
  hosts: ["example.invalid"],
  queries: {
    zoneStates: {
      description: "Reads two things",
      args: {},
      result: { type: "list", of: { type: "object", fields: { id: { type: "string" } } } },
      key: () => [],
      staleTime: 1000,
      fetch: async () => [],
    },
    rooms: {
      description: "Reads one thing",
      key: () => [],
      fetch: async () => [],
    },
  },
  actions: {
    setTemperature: {
      effect: "write",
      args: { value: { type: "number", label: "Temperature" } },
      execute: async () => undefined,
    },
  },
});

const schema = describeProvider("kavibay.demo/demo", provider);

assert(schema.id === "kavibay.demo/demo", "the id is the host's, never the provider's own");
assert(schema.requiresCredential, "whether an account is needed survives");
assert(schema.credentialType === "demoOAuth2", "the registry type id survives so Settings can open on it");
assert(schema.queries.map((q) => q.name).join(",") === "rooms,zoneStates", "queries are sorted, so the doc has a stable order");

assert(
  schema.actions.map((a) => a.name).join(",") === "setTemperature" && schema.actions[0]?.effect === "write",
  "actions reach the schema so the Wizard is told what the host will actually run",
);

assert(
  JSON.stringify(schema).length > 0 && !JSON.stringify(schema).includes("function"),
  "the schema is serializable — fetch and key stop here",
);

const undeclared = schema.queries.find((q) => q.name === "rooms")!;
assert(
  Object.keys(undeclared.args).length === 0 && undeclared.result === undefined,
  "a query that declares nothing yields empty args and no result rather than throwing",
);

console.log("provider-schema.assert.ts: ok");
