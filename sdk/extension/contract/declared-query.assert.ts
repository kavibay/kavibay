// SPDX-License-Identifier: MIT
import { declaredQuery } from "./declaredQuery";
import type { ProviderHostContext } from "./sdk";

/**
 * Asserts for queries written as data.
 * Run: npx tsx sdk/extension/contract/declared-query.assert.ts
 *
 * FINDINGS §29. What these pin down is that the declarative form is a *builder*
 * and not a second kind of query: everything below checks the ordinary
 * `ProviderQuery` it returns, because that is the only thing the host will ever
 * see. If this file ever needs to reach past `fetch`, `key` or `result`, the
 * form has grown a concept the host does not share.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Records the call, answers with whatever the test staged. */
function hostWith(answer: unknown) {
  const calls: { url: string; params?: Record<string, unknown> }[] = [];
  const host = {
    http: {
      get: async <T>(url: string, params?: Record<string, unknown>) => {
        calls.push({ url, params });
        return answer as T;
      },
      post: async <T>() => undefined as T,
    },
    credentials: { isConnected: () => true },
  } as unknown as ProviderHostContext;
  return { host, calls };
}

// --- a list is selected, shaped, and nothing else survives ---
{
  const query = declaredQuery({
    description: "Pull requests waiting for your review",
    get: "https://api.github.com/search/issues",
    query: { q: { const: "review-requested:@me" }, per_page: { const: 20 } },
    select: "items",
    result: {
      type: "list",
      of: { type: "object", fields: { title: { type: "string" }, url: { type: "string" } } },
    },
    pick: { title: "title", url: "html_url" },
  });

  const { host, calls } = hostWith({
    total_count: 1,
    items: [{ title: "Fix the gate", html_url: "https://example/1", body: "secret" }],
  });
  const rows = (await query.fetch({}, host)) as Record<string, unknown>[];

  assert(calls[0]!.url === "https://api.github.com/search/issues", "the declared url is called");
  assert(calls[0]!.params?.q === "review-requested:@me", "with the fixed parameters");
  assert(rows.length === 1 && rows[0]!.title === "Fix the gate", `the envelope is unwrapped: ${JSON.stringify(rows)}`);
  assert(rows[0]!.url === "https://example/1", "and dotted fields are renamed");
  /**
   * The vendor's other fields are dropped, which is the point rather than a
   * side effect: a widget handed the whole object learns to read paths the
   * declaration never promised, and the next API change breaks it silently.
   */
  assert(!("body" in rows[0]!), `only declared fields survive: ${JSON.stringify(rows[0])}`);
}

// --- a response that is not the declared shape is data, not a failure ---
{
  const query = declaredQuery({
    description: "Rooms",
    get: "https://example/rooms",
    result: { type: "list", of: { type: "object", fields: { id: { type: "string" } } } },
    pick: { id: "id" },
  });

  const { host } = hostWith({ message: "Bad credentials" });
  const rows = await query.fetch({}, host);
  assert(Array.isArray(rows) && rows.length === 0, `an error envelope becomes an empty list: ${JSON.stringify(rows)}`);

  const missing = await declaredQuery({
    description: "Rooms",
    get: "https://example/rooms",
    result: { type: "list", of: { type: "object", fields: { id: { type: "string" }, name: { type: "string" } } } },
    pick: { id: "id", name: "label" },
  }).fetch({}, hostWith([{ id: "1" }]).host) as Record<string, unknown>[];
  assert(missing[0]!.name === null, "a field the vendor stopped sending is null, not undefined");
}

// --- arguments reach the query string, and an empty one does not ---
{
  const query = declaredQuery<{ name: string; count: number }>({
    description: "Places",
    get: "https://example/search",
    args: {
      name: { type: "string", label: "Name", required: true },
      count: { type: "number", label: "Count" },
    },
    query: { name: { arg: "name" }, count: { arg: "count" }, format: { const: "json" } },
    result: { type: "list", of: { type: "object", fields: { id: { type: "string" } } } },
    pick: { id: "id" },
  });

  const { host, calls } = hostWith([]);
  await query.fetch({ name: "Berlin", count: 8 }, host);
  assert(calls[0]!.params?.name === "Berlin" && calls[0]!.params?.count === 8, "arguments are sent");
  assert(calls[0]!.params?.format === "json", "beside the fixed ones");

  await query.fetch({ name: "", count: 8 }, host);
  assert(
    !("name" in (calls[1]!.params ?? {})),
    `an empty argument is omitted, not sent blank: ${JSON.stringify(calls[1]!.params)}`,
  );
}

// --- the key is the arguments, and only the arguments ---
{
  const query = declaredQuery<{ room: string }>({
    description: "State",
    get: "https://example/state",
    args: { room: { type: "string", label: "Room", required: true } },
    query: { room: { arg: "room" } },
    result: { type: "object", fields: { id: { type: "string" } } },
    pick: { id: "id" },
  });

  /**
   * Finding 4: the discriminating part only. The host prefixes provider id and
   * query name, and a declaration that returned them here would produce a key
   * the matching invalidation prefix can never hit.
   */
  assert(JSON.stringify(query.key({ room: "living" })) === JSON.stringify(["living"]), "the key is the args");
  assert(JSON.stringify(declaredQuery({
    description: "No args",
    get: "https://example/x",
    result: { type: "object", fields: { id: { type: "string" } } },
    pick: { id: "id" },
  }).key({})) === "[]", "and empty when a query takes none");
}

// --- a single object, not a list ---
{
  const query = declaredQuery({
    description: "Me",
    get: "https://example/me",
    result: { type: "object", fields: { email: { type: "string" } } },
    pick: { email: "profile.email" },
  });
  const row = (await query.fetch({}, hostWith({ profile: { email: "a@b.c" } }).host)) as Record<string, unknown>;
  assert(row.email === "a@b.c", `a nested path is read: ${JSON.stringify(row)}`);

  const none = await query.fetch({}, hostWith("not json").host);
  assert(none === null, "and a non-object answer is null rather than a throw");
}

console.log("declared-query.assert.ts: ok");
