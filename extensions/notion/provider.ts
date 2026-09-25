// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Notion: pages and databases the integration can see.
 *
 * Auth (Bearer + Notion-Version) is attached host-side. Vendor nesting
 * (search `results`, title rich text, the title property) stops here so a
 * widget sees a flat list. A token without shared pages returns an empty list,
 * not an error.
 */

export const PROVIDER_ID = "kavibay.notion/notion";

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
}

interface NotionDatabaseArgs {
  databaseId: string;
}

const API = "https://api.notion.com/v1";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asBool = (value: unknown): boolean => value === true;

/** Joins Notion rich-text `plain_text` runs. */
function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((block) => asString(asRecord(block).plain_text)).join("");
}

/** Page title from the title property; database title from the top-level array. */
function notionTitle(raw: Record<string, unknown>): string {
  if (asString(raw.object) === "database") return richText(raw.title);
  const properties = asRecord(raw.properties);
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    if (asString(property.type) === "title") return richText(property.title);
  }
  return "";
}

function mapPage(raw: unknown): NotionPage {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("page missing id");
  return {
    id,
    title: notionTitle(row),
    url: asString(row.url),
    lastEdited: asString(row.last_edited_time),
  };
}

function mapDatabase(raw: unknown): NotionDatabase {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("database missing id");
  return {
    id,
    title: notionTitle(row),
    url: asString(row.url),
    lastEdited: asString(row.last_edited_time),
  };
}

function unwrapResults(raw: unknown): unknown[] {
  const row = asRecord(raw);
  if (asString(row.object) === "error") {
    throw new Error(asString(row.message) || "Notion request failed");
  }
  const results = row.results;
  if (!Array.isArray(results)) throw new Error("results missing or not a list");
  return results.filter((entry) => !asBool(asRecord(entry).archived) && !asBool(asRecord(entry).in_trash));
}

/** POST after confirming a Notion credential exists; auth is attached host-side. */
async function notionPost<T>(host: ProviderHostContext, path: string, body: unknown): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Notion is not connected" };
  }
  return host.http.post<T>(`${API}${path}`, body);
}

const pageSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    title: { type: "string" as const },
    url: { type: "string" as const },
    lastEdited: { type: "string" as const },
  },
};

const databaseSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    title: { type: "string" as const },
    url: { type: "string" as const },
    lastEdited: { type: "string" as const },
  },
};

const searchSort = { timestamp: "last_edited_time", direction: "descending" };

export const notionProvider = defineProvider({
  name: "notion",
  displayName: "Notion",
  requiresCredential: true,
  credentialType: "notionApi",
  hosts: ["api.notion.com"],
  // Pages answer from `api.notion.com` and live on `www.notion.so` (and
  // sometimes the bare `notion.so` redirect).
  linkHosts: ["www.notion.so", "notion.so"],
  queries: {
    pages: {
      description: "Pages shared with your Notion integration, most recently edited first",
      args: {},
      result: { type: "list", of: pageSchema },
      key: () => [],
      staleTime: 60_000,
      fetch: async (_args: Record<string, never>, host): Promise<NotionPage[]> => {
        const raw = await notionPost<unknown>(host, "/search", {
          filter: { property: "object", value: "page" },
          sort: searchSort,
          page_size: 20,
        });
        return unwrapResults(raw).map(mapPage);
      },
    },
    databases: {
      description: "Databases shared with your Notion integration",
      args: {},
      result: { type: "list", of: databaseSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<NotionDatabase[]> => {
        const raw = await notionPost<unknown>(host, "/search", {
          filter: { property: "object", value: "database" },
          sort: searchSort,
          page_size: 20,
        });
        return unwrapResults(raw).map(mapDatabase);
      },
    },
    databasePages: {
      description: "The pages in one Notion database",
      args: {
        databaseId: {
          type: "string",
          label: "Database",
          required: true,
          source: { query: "databases" },
        },
      },
      result: { type: "list", of: pageSchema },
      key: (args: NotionDatabaseArgs) => [args.databaseId.trim()],
      staleTime: 60_000,
      fetch: async (args: NotionDatabaseArgs, host): Promise<NotionPage[]> => {
        const databaseId = args.databaseId.trim();
        if (!databaseId) throw new Error("databaseId required");
        const raw = await notionPost<unknown>(
          host,
          `/databases/${encodeURIComponent(databaseId)}/query`,
          {
            page_size: 20,
            sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          },
        );
        return unwrapResults(raw).map(mapPage);
      },
    },
  },
  actions: {},
});

export default notionProvider;
