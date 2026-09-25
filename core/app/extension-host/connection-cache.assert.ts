/**
 * The connection cache in front of `extension_provider_connection`.
 *
 * Run: npx tsx core/app/extension-host/connection-cache.assert.ts
 */
import { connectionCache } from "./tauriProviderTransport";
import type { ProviderConnection } from "./providerTransport";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const usable: ProviderConnection = { credentialId: "work", available: true, revision: 1 };

function setup(answer: () => Promise<ProviderConnection | null> = async () => usable) {
  let loads = 0;
  let epoch = 0;
  let clock = 0;
  const connection = connectionCache(
    () => { loads += 1; return answer(); },
    () => epoch,
    () => clock,
  );
  return {
    connection,
    loads: () => loads,
    moveEpoch: () => { epoch += 1; },
    advance: (ms: number) => { clock += ms; },
  };
}

const TRACKER = "kavibay.linear/linear";

// --- a widget reading twice asks the host once; so do two widgets at once ---
{
  const t = setup();
  await Promise.all([t.connection(TRACKER, "widget:a"), t.connection(TRACKER, "widget:a")]);
  await t.connection(TRACKER, "widget:a");
  assert(t.loads() === 1, `one host call for repeated reads: ${t.loads()}`);
  await t.connection(TRACKER, "widget:b");
  assert(t.loads() === 2, "another owner is another binding");
}

// --- a chosen account, a new epoch: the cache must not outlive the choice ---
{
  const t = setup();
  await t.connection(TRACKER, "widget:a");
  t.moveEpoch();
  await t.connection(TRACKER, "widget:a");
  assert(t.loads() === 2, "an account switch is asked again");
}

// --- and nothing is trusted for longer than the TTL ---
{
  const t = setup();
  await t.connection(TRACKER, "widget:a");
  t.advance(5_000);
  await t.connection(TRACKER, "widget:a");
  assert(t.loads() === 2, "an expired entry is asked again");
}

// --- an unusable or failed answer is never reused: it may be fixed any moment ---
{
  const t = setup(async () => ({ credentialId: "work", available: false, revision: 1 }));
  await t.connection(TRACKER, "widget:a");
  await t.connection(TRACKER, "widget:a");
  assert(t.loads() === 2, "a connection that needs reconnecting is asked again next time");

  const failing = setup(async () => { throw new Error("db locked"); });
  await failing.connection(TRACKER, "widget:a").catch(() => {});
  await failing.connection(TRACKER, "widget:a").catch(() => {});
  assert(failing.loads() === 2, "a failed call is not cached");
}

console.log("connection-cache.assert.ts: ok");
