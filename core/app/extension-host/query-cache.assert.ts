import { QueryCache } from "./query-cache";
import type { QueryState } from "@sdk/contract/sdk";

/**
 * Asserts for the cache's own refresh.
 * Run: npx tsx core/app/extension-host/query-cache.assert.ts
 *
 * Separate from scenarios.assert.ts on purpose: that file is the ported
 * regression suite and its 37 assertions are quoted as the acceptance criterion
 * for Phase 1. Growing it would make that number mean something else.
 *
 * What is covered here is the gap finding 15 describes — the cache promised
 * that no widget ever polls, and delivered it only for data that some action
 * invalidates. A read-only provider has no action, so its widgets froze.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY = ["p", "q"];
const sink = () => (_s: QueryState<unknown>) => {};

// --- a watched query refreshes itself once its data has expired ---
{
  const cache = new QueryCache();
  let served = 0;
  const fetcher = async () => ({ n: ++served });

  const sub = cache.subscribe(KEY, 20, fetcher, sink());
  await wait(120);
  sub.unsubscribe();

  // The exact count is timing, so this asserts the property rather than a
  // number: it fetched again without anyone asking, which is what a read-only
  // provider has no other way to do.
  assert(cache.fetchCount > 1, `a subscribed query refetches on its own, got ${cache.fetchCount}`);
}

// --- and the last subscriber leaving stops it ---
{
  const cache = new QueryCache();
  const sub = cache.subscribe(KEY, 20, async () => ({}), sink());
  await wait(60);
  sub.unsubscribe();

  const afterLeaving = cache.fetchCount;
  await wait(80);
  assert(
    cache.fetchCount === afterLeaving,
    `unsubscribing stops the refresh, got ${cache.fetchCount} after ${afterLeaving}`,
  );
}

// --- two watchers of one key share one refresh, not two ---
{
  const cache = new QueryCache();
  const a = cache.subscribe(KEY, 30, async () => ({}), sink());
  const b = cache.subscribe(KEY, 30, async () => ({}), sink());
  await wait(140);
  a.unsubscribe();
  b.unsubscribe();

  // Five tado° tiles on five rooms read one shared key. If each subscriber
  // scheduled its own timer the call budget would scale with the number of
  // widgets on screen, which is the thing the pacing exists to prevent.
  assert(cache.fetchCount <= 6, `one timer per key, not per subscriber, got ${cache.fetchCount}`);
}

// --- a one-shot read is not a subscription and must not start a timer ---
{
  const cache = new QueryCache();
  await cache.read(KEY, 20, async () => ({}));
  const afterRead = cache.fetchCount;
  await wait(80);
  assert(cache.fetchCount === afterRead, "an unwatched query stays where it was left");
}

// --- disconnecting a provider stops its refresh ---
{
  const cache = new QueryCache();
  const sub = cache.subscribe(["tado", "zoneStates"], 20, async () => ({}), sink());
  await wait(50);
  cache.evictProvider("tado");

  // Eviction drops the entry, so a surviving timer would go on calling a
  // provider the user just disconnected — with a credential the host would
  // still attach.
  const afterEvict = cache.fetchCount;
  await wait(80);
  assert(
    cache.fetchCount === afterEvict,
    `eviction stops the refresh, got ${cache.fetchCount} after ${afterEvict}`,
  );
  sub.unsubscribe();
}

// --- a refresh does not blank the widget it is refreshing ---
{
  const cache = new QueryCache();
  const seen: string[] = [];
  const sub = cache.subscribe(KEY, 20, async () => ({}), (s) => seen.push(s.status));
  await wait(120);
  sub.unsubscribe();

  // The runtime renders `loading` as a skeleton, so a refetch that announced
  // itself would flash the tile empty every interval — on tado° that is every
  // sixteen minutes, on data the user is glancing at. Held here rather than
  // assumed: `read` only publishes on settle, and this is what says so.
  const afterFirstSuccess = seen.slice(seen.indexOf("success") + 1);
  assert(seen.filter((s) => s === "success").length > 1, "the refresh did happen");
  assert(
    !afterFirstSuccess.includes("loading"),
    `a refresh never republishes loading, saw ${seen.join(",")}`,
  );
}

// --- a failing refresh keeps trying rather than falling silent ---
{
  const cache = new QueryCache();
  let served = 0;
  const sub = cache.subscribe(KEY, 20, async () => {
    served++;
    throw new Error("upstream is down");
  }, sink());
  await wait(120);
  sub.unsubscribe();

  // Chained rather than intervalled, so a failure has to reschedule itself. If
  // it did not, an outage during the night would leave the widget dead until
  // the app restarted.
  assert(served > 1, `a failed refresh reschedules, got ${served} attempts`);
}

// --- a refresh click fetches past staleTime, but not twice within the floor ---
{
  const cache = new QueryCache();
  let served = 0;
  const fetch = async () => ++served;
  const seen: unknown[] = [];
  const sub = cache.subscribe(KEY, 60_000, fetch, (s) => {
    if (s.status === "success") seen.push(s.data);
  });
  await wait(10);
  assert(served === 1, "the subscription fetched once");

  // staleTime is a minute away, so a plain read is still answered from cache.
  assert((await cache.read(KEY, 60_000, fetch)) === 1, "a read inside staleTime is cached");
  // A floor of zero: the click is outside it, so it goes upstream.
  assert((await cache.refresh(KEY, 60_000, fetch, 0)) === 2, "refresh fetches past staleTime");
  assert(seen.includes(2), "subscribers see the refreshed value");
  // Inside the floor, a second click is answered from what the first fetched.
  assert((await cache.refresh(KEY, 60_000, fetch, 60_000)) === 2, "a burst of clicks costs one call");
  assert(served === 2, `the floor held, got ${served} fetches`);
  sub.unsubscribe();
}

/**
 * This file exiting is itself an assertion: a pending timer keeps the process
 * alive, and nothing above waits for the last one. They are unref'd, so node
 * leaves when the work is done. Losing that turns every assert file that
 * subscribes into a hang.
 */
console.log("query-cache.assert.ts: ok");
