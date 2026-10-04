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
  /** The row's status, or null for a page outside a database or one without the column. */
  status: string | null;
  /** Every column of the row, in Notion's order, each flattened to text. */
  properties: NotionProperty[];
}

/**
 * One column of a page. A list rather than a map because the result schema has
 * no map type; a widget finds a column by `name`.
 *
 * `value` is display text — "Today, This Week" for a multi-select, the ISO start
 * (and `→ end`) for a date — and null when the cell is empty or holds nothing
 * readable, such as a relation, which the API answers with page ids only.
 * `type` is Notion's own property type, so a widget can format a date or a
 * checkbox without guessing from the text.
 */
export interface NotionProperty {
  name: string;
  type: string;
  value: string | null;
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

interface SetPropertyArgs {
  pageId: string;
  property: string;
  value?: string;
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

/**
 * The status column: a `status` property first, else a select named "Status".
 *
 * Only this one column, not a map of every property: the result schema has no
 * map type, and a widget asking for "the status" should not have to know which
 * of Notion's two property kinds a workspace happened to use for it.
 */
function notionStatus(raw: Record<string, unknown>): string | null {
  const properties = Object.entries(asRecord(raw.properties)).map(([name, value]) => [name, asRecord(value)] as const);
  const status = properties.find(([, property]) => asString(property.type) === "status")?.[1];
  if (status) return asString(asRecord(status.status).name) || null;
  const select = properties.find(
    ([name, property]) => name.toLowerCase() === "status" && asString(property.type) === "select",
  )?.[1];
  return select ? asString(asRecord(select.select).name) || null : null;
}

const names = (value: unknown): string =>
  Array.isArray(value) ? value.map((entry) => asString(asRecord(entry).name)).filter(Boolean).join(", ") : "";

function dateText(value: unknown): string {
  const date = asRecord(value);
  const start = asString(date.start);
  const end = asString(date.end);
  return end ? `${start} → ${end}` : start;
}

/** The text of one typed value; the formula and rollup cases recurse into it. */
function valueText(type: string, holder: Record<string, unknown>): string {
  const value = holder[type];
  switch (type) {
    case "title":
    case "rich_text":
      return richText(value);
    case "select":
    case "status":
      return asString(asRecord(value).name);
    case "multi_select":
    case "people":
    case "files":
      return names(value);
    case "date":
      return dateText(value);
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "checkbox":
    case "boolean":
      return value === true ? "true" : value === false ? "false" : "";
    case "url":
    case "email":
    case "phone_number":
    case "string":
    case "created_time":
    case "last_edited_time":
      return asString(value);
    case "created_by":
    case "last_edited_by":
      return asString(asRecord(value).name);
    case "unique_id": {
      const id = asRecord(value);
      const number = typeof id.number === "number" ? String(id.number) : "";
      return number && asString(id.prefix) ? `${asString(id.prefix)}-${number}` : number;
    }
    case "formula":
    case "rollup": {
      const inner = asRecord(value);
      return valueText(asString(inner.type), inner);
    }
    default:
      return "";
  }
}

function notionProperties(raw: Record<string, unknown>): NotionProperty[] {
  return Object.entries(asRecord(raw.properties)).map(([name, value]) => {
    const property = asRecord(value);
    const type = asString(property.type);
    return { name, type, value: valueText(type, property) || null };
  });
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
    status: notionStatus(row),
    properties: notionProperties(row),
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

async function requireConnected(host: ProviderHostContext): Promise<void> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Notion is not connected" };
  }
}

/** POST after confirming a Notion credential exists; auth is attached host-side. */
async function notionPost<T>(host: ProviderHostContext, path: string, body: unknown): Promise<T> {
  await requireConnected(host);
  return host.http.post<T>(`${API}${path}`, body);
}

/** Notion answers a failed write with a 200-shaped error envelope as often as a status. */
function unwrapObject(raw: unknown): Record<string, unknown> {
  const row = asRecord(raw);
  if (asString(row.object) === "error") throw new Error(asString(row.message) || "Notion request failed");
  return row;
}

const plainText = (value: string) => [{ type: "text", text: { content: value } }];

/**
 * The PATCH body for one column, built from the column's own type.
 *
 * The inverse of `valueText`: a widget sends the same display text it was given
 * ("Today, This Week", "2026-10-03", "true"), so it never has to know Notion's
 * per-type envelopes. An empty value clears the cell. Types with no text form
 * — relation, people, files, formula and the read-only timestamps — refuse
 * rather than send something Notion would reject with a less useful message.
 */
export function propertyPatch(type: string, value: string): Record<string, unknown> {
  const text = value.trim();
  switch (type) {
    case "status":
    case "select":
      return { [type]: text ? { name: text } : null };
    case "multi_select":
      return {
        multi_select: text
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    case "checkbox":
      return { checkbox: text === "true" };
    case "number": {
      if (!text) return { number: null };
      const number = Number(text);
      if (!Number.isFinite(number)) throw new Error(`"${value}" is not a number`);
      return { number };
    }
    case "date": {
      if (!text) return { date: null };
      const [start, end] = text.split("→").map((part) => part.trim());
      return { date: { start, end: end || null } };
    }
    case "title":
    case "rich_text":
      return { [type]: text ? plainText(text) : [] };
    case "url":
    case "email":
    case "phone_number":
      return { [type]: text || null };
    default:
      throw new Error(`a ${type || "unknown"} column cannot be set from text`);
  }
}

const pageSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    title: { type: "string" as const },
    url: { type: "string" as const },
    lastEdited: { type: "string" as const },
    status: { type: "string" as const, nullable: true },
    properties: {
      type: "list" as const,
      of: {
        type: "object" as const,
        fields: {
          name: { type: "string" as const },
          type: { type: "string" as const },
          value: { type: "string" as const, nullable: true },
        },
      },
    },
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
  // Pages answer from `api.notion.com` and live on `app.notion.com` — the
  // `url` the API returns since Notion moved the app — or, for older
  // workspaces and links, `www.notion.so` and the bare `notion.so` redirect.
  linkHosts: ["app.notion.com", "www.notion.so", "notion.so"],
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
      description:
        "The pages in one Notion database; `properties` lists every column — find one by `name`",
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
  actions: {
    setProperty: {
      description:
        "Set one column of a page by name, using the same text `properties` shows (\"Done\", \"Today, This Week\", \"2026-10-03\", \"true\"); an empty value clears it. Relations, people and files cannot be set",
      effect: "write",
      args: {
        pageId: { type: "string", label: "Page", required: true },
        property: { type: "string", label: "Column", required: true },
        // Not required: an empty value clears the cell.
        value: { type: "string", label: "Value" },
      },
      // The column's type decides the body, and only the page knows it, so this
      // reads the page first: one extra request per write, against widgets
      // having to send Notion's envelopes themselves.
      execute: async (args: SetPropertyArgs, host): Promise<void> => {
        const pageId = args.pageId.trim();
        if (!pageId) throw new Error("pageId required");
        await requireConnected(host);
        const url = `${API}/pages/${encodeURIComponent(pageId)}`;
        const page = unwrapObject(await host.http.get<unknown>(url));
        const column = asRecord(asRecord(page.properties)[args.property]);
        if (!asString(column.type)) throw new Error(`no column named "${args.property}" on this page`);
        unwrapObject(
          await host.http.patch<unknown>(url, {
            properties: { [args.property]: propertyPatch(asString(column.type), args.value ?? "") },
          }),
        );
      },
      // The database is not an argument, so every cached list is refreshed;
      // they are a handful of 20-row queries.
      invalidates: () => [{ query: "databasePages" }, { query: "pages" }],
    },
  },
});

export default notionProvider;
