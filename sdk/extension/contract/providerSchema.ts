// SPDX-License-Identifier: MIT
import type { ArgSpec, ProviderDefinition, ResultSchema } from "./sdk";

/**
 * A provider described as plain data: what a picker lists and what a model is
 * told.
 *
 * Queries and actions both belong here. Approving an account approves the
 * account — reads and writes — so hiding actions from the schema would teach
 * the Wizard a poorer API than the host actually offers.
 *
 * Serializable throughout: `fetch`, `execute` and `key` are functions and stop
 * here.
 */
export interface ProviderQuerySchema {
  name: string;
  /** Required for a shipping provider — `providerSchema.assert.ts` enforces it. */
  description?: string;
  args: Record<string, ArgSpec>;
  result?: ResultSchema;
  /** Milliseconds. A call budget for anything subscribed, not a hint. */
  staleTime?: number;
}

export interface ProviderActionSchema {
  name: string;
  effect: "write" | "destructive" | "sensitive";
  args: Record<string, ArgSpec>;
  description?: string;
}

export interface ProviderSchema {
  id: string;
  name: string;
  displayName: string;
  /**
   * The distinction that is real today, and the reason there is no
   * builtin/third-party split: every provider ships in the binary, but only
   * some need the user to connect an account first.
   */
  requiresCredential: boolean;
  /** Registry type id when `requiresCredential` is set, so Settings can open on it. */
  credentialType?: string;
  queries: ProviderQuerySchema[];
  actions: ProviderActionSchema[];
}

/** `id` is the host's — a provider never states its own qualified id (finding 7). */
export function describeProvider(id: string, def: ProviderDefinition): ProviderSchema {
  return {
    id,
    name: def.name,
    displayName: def.displayName,
    requiresCredential: def.requiresCredential,
    ...(def.credentialType ? { credentialType: def.credentialType } : {}),
    queries: Object.entries(def.queries)
      .map(([name, query]) => ({
        name,
        description: query.description,
        args: query.args ?? {},
        result: query.result,
        staleTime: query.staleTime,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actions: Object.entries(def.actions)
      .map(([name, action]) => ({
        name,
        effect: action.effect,
        args: action.args ?? {},
        description: action.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
