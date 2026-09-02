// SPDX-License-Identifier: MIT
/**
 * Notion provider: search/query envelopes and title flattening.
 * Run: npx tsx extensions/notion/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  notionProvider,
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
      properties: { Name: { type: "title", title: [{ plain_text: "Ship" }] } },
    },
  ],
});
const rows = (await fetchDatabasePages({ databaseId: " d1 " }, rowsHost)) as NotionPage[];
assert(rows[0]?.title === "Ship" && rowsHost.lastUrl?.includes("/databases/d1/query"), "databaseId is trimmed into the path");

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

console.log("notion provider.assert: ok");
