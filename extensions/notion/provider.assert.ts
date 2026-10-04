// SPDX-License-Identifier: MIT
/**
 * Notion provider: search/query envelopes and title flattening.
 * Run: npx tsx extensions/notion/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  notionProvider,
  propertyPatch,
  type NotionDatabase,
  type NotionPage,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext & { lastUrl?: string; lastBody?: unknown } {
  const host: ProviderHostContext & { lastUrl?: string; lastBody?: unknown } = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async () => undefined as never,
      post: async <T>(url: string, body?: unknown): Promise<T> => {
        host.lastUrl = url;
        host.lastBody = body;
        return response as T;
      },
      put: async () => undefined as never,
      patch: async () => undefined as never,
    },
  };
  return host;
}

const fetchPages = notionProvider.queries.pages.fetch;
const fetchDatabases = notionProvider.queries.databases.fetch;
const fetchDatabasePages = notionProvider.queries.databasePages.fetch;

const pagesHost = hostFor({
  results: [
    {
      object: "page",
      id: "p1",
      url: "https://notion.so/p1",
      last_edited_time: "2026-08-29T08:00:00.000Z",
      archived: false,
      properties: {
        Name: { type: "title", title: [{ plain_text: "Inbox" }] },
        Status: { type: "select", select: { name: "Open" } },
      },
    },
    {
      object: "page",
      id: "p2",
      url: "https://notion.so/p2",
      last_edited_time: "2026-08-28T08:00:00.000Z",
      archived: true,
      properties: { Name: { type: "title", title: [{ plain_text: "Old" }] } },
    },
  ],
});
const pages = (await fetchPages({}, pagesHost)) as NotionPage[];
assert(pages.length === 1 && pages[0]?.title === "Inbox", "the title property is flattened; archived rows drop");
assert(pages[0]?.status === "Open", "a select named Status is the status");
assert(
  pagesHost.lastUrl === "https://api.notion.com/v1/search",
  "pages come from search, not a list-pages GET",
);
assert(
  (pagesHost.lastBody as { filter?: { value?: string } }).filter?.value === "page",
  "search is filtered to pages",
);

const databases = (await fetchDatabases(
  {},
  hostFor({
    results: [
      {
        object: "database",
        id: "d1",
        url: "https://notion.so/d1",
        last_edited_time: "2026-08-29T09:00:00.000Z",
        title: [{ plain_text: "Tasks " }, { plain_text: "board" }],
      },
    ],
  }),
)) as NotionDatabase[];
assert(databases[0]?.title === "Tasks board", "database title rich text is joined");

const rowsHost = hostFor({
  results: [
    {
      object: "page",
      id: "r1",
      url: "https://notion.so/r1",
      last_edited_time: "2026-08-29T10:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Ship" }] },
        Phase: { type: "status", status: { name: "In Progress" } },
        Time: { type: "multi_select", multi_select: [{ name: "Today" }, { name: "This Week" }] },
        Due: { type: "date", date: { start: "2026-10-03", end: null } },
        Done: { type: "checkbox", checkbox: false },
        Score: { type: "formula", formula: { type: "number", number: 7 } },
        Project: { type: "relation", relation: [{ id: "x" }] },
      },
    },
    {
      object: "page",
      id: "r2",
      url: "https://notion.so/r2",
      last_edited_time: "2026-08-29T09:00:00.000Z",
      properties: { Name: { type: "title", title: [{ plain_text: "Plain" }] } },
    },
  ],
});
const rows = (await fetchDatabasePages({ databaseId: " d1 " }, rowsHost)) as NotionPage[];
assert(rows[0]?.title === "Ship" && rowsHost.lastUrl?.includes("/databases/d1/query"), "databaseId is trimmed into the path");
assert(rows[0]?.status === "In Progress", "a status property counts whatever it is named");
assert(rows[1]?.status === null, "no status column is null, not an empty string");
const cell = (name: string) => rows[0]?.properties.find((property) => property.name === name);
assert(cell("Time")?.value === "Today, This Week" && cell("Time")?.type === "multi_select", "a multi-select joins its names");
assert(cell("Due")?.value === "2026-10-03", "a date without an end is its start");
assert(cell("Done")?.value === "false", "an unticked checkbox is false, not empty");
assert(cell("Score")?.value === "7", "a formula reads its own result type");
assert(cell("Project")?.value === null, "a relation has nothing readable and is null");
assert(rows[0]?.properties.length === 7, "every column is listed, readable or not");

try {
  await fetchPages({}, hostFor({ results: [] }, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

try {
  await fetchPages({}, hostFor({ object: "error", message: "Unauthorized" }));
  assert(false, "an error envelope must throw");
} catch (error) {
  assert(error instanceof Error && error.message === "Unauthorized", "Notion's message is the thrown error");
}

const empty = (await fetchDatabasePages({ databaseId: "empty" }, hostFor({ results: [] }))) as NotionPage[];
assert(empty.length === 0, "a database with no rows is an empty list");

// --- setProperty -------------------------------------------------------------
{
  const eq = (actual: unknown, expected: unknown, message: string) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: got ${JSON.stringify(actual)}`);
  eq(propertyPatch("status", "Done"), { status: { name: "Done" } }, "status by name");
  eq(propertyPatch("select", ""), { select: null }, "an empty select clears it");
  eq(propertyPatch("multi_select", "Today, This Week"), { multi_select: [{ name: "Today" }, { name: "This Week" }] }, "multi-select splits on commas, the inverse of reading");
  eq(propertyPatch("date", "2026-10-03 → 2026-10-05"), { date: { start: "2026-10-03", end: "2026-10-05" } }, "a range round-trips");
  eq(propertyPatch("checkbox", "true"), { checkbox: true }, "checkbox");
  eq(propertyPatch("number", "7"), { number: 7 }, "number");
  let refused = "";
  try { propertyPatch("relation", "x"); } catch (error) { refused = String(error); }
  assert(refused.includes("relation"), "a relation cannot be set from text");

  const calls: { method: string; url: string; body?: unknown }[] = [];
  const host: ProviderHostContext = {
    credentials: { isConnected: async () => true },
    http: {
      get: async <T>(url: string): Promise<T> => {
        calls.push({ method: "GET", url });
        return { object: "page", properties: { Phase: { type: "status", status: { name: "Planned" } } } } as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
      patch: async <T>(url: string, body?: unknown): Promise<T> => {
        calls.push({ method: "PATCH", url, body });
        return { object: "page" } as T;
      },
    },
  };
  const setProperty = notionProvider.actions.setProperty;
  await setProperty.execute({ pageId: " r1 ", property: "Phase", value: "Done" }, host);
  eq(calls.map((call) => `${call.method} ${call.url}`), ["GET https://api.notion.com/v1/pages/r1", "PATCH https://api.notion.com/v1/pages/r1"], "reads the column type, then patches the trimmed page");
  eq(calls[1]?.body, { properties: { Phase: { status: { name: "Done" } } } }, "the body is built from the column's type");
  let missing = "";
  try { await setProperty.execute({ pageId: "r1", property: "Nope", value: "x" }, host); } catch (error) { missing = String(error); }
  assert(missing.includes("Nope"), "an unknown column is named in the error");
  eq(setProperty.invalidates?.({ pageId: "r1", property: "Phase", value: "Done" }), [{ query: "databasePages" }, { query: "pages" }], "the cached lists refresh");
}

console.log("notion provider.assert: ok");
