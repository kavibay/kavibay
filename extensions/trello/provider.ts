// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Trello: boards, lists and cards, reached only through this provider.
 *
 * Trello's REST API authenticates with `key` and `token` query parameters,
 * attached host-side. This file never sees the secret. Vendor field names
 * (`idBoard`, `desc`) stop here so a widget sees a flat list.
 */

export const PROVIDER_ID = "kavibay.trello/trello";

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
  shortLink: string;
}

export interface TrelloList {
  id: string;
  name: string;
  boardId: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  url: string;
  description: string;
  due: string | null;
  listId: string;
  boardId: string;
  closed: boolean;
}

interface TrelloBoardArgs {
  boardId: string;
}

const API = "https://api.trello.com/1";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asBool = (value: unknown): boolean => value === true;

/** Maps one Trello board into the flat widget DTO. */
function mapBoard(raw: unknown): TrelloBoard {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("board missing id");
  return {
    id,
    name: asString(row.name),
    url: asString(row.url),
    shortLink: asString(row.shortLink),
  };
}

/** Maps one Trello list; `idBoard` becomes `boardId`. */
function mapList(raw: unknown): TrelloList {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("list missing id");
  return { id, name: asString(row.name), boardId: asString(row.idBoard) };
}

/** Maps one Trello card; `desc` / `idList` / `idBoard` stop here. */
function mapCard(raw: unknown): TrelloCard {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("card missing id");
  return {
    id,
    name: asString(row.name),
    url: asString(row.url),
    description: asString(row.desc),
    due: typeof row.due === "string" && row.due.length > 0 ? row.due : null,
    listId: asString(row.idList),
    boardId: asString(row.idBoard),
    closed: asBool(row.closed),
  };
}

function mapRows<T>(raw: unknown, map: (row: unknown) => T, missing: string): T[] {
  if (!Array.isArray(raw)) throw new Error(missing);
  return raw.map(map);
}

/** GET after confirming a Trello credential exists; auth is attached host-side. */
async function trelloGet<T>(
  host: ProviderHostContext,
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Trello is not connected" };
  }
  return host.http.get<T>(`${API}${path}`, params);
}

const boardSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    url: { type: "string" as const },
    shortLink: { type: "string" as const },
  },
};

const listSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    boardId: { type: "string" as const },
  },
};

const cardSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    url: { type: "string" as const },
    description: { type: "string" as const },
    due: { type: "string" as const, nullable: true },
    listId: { type: "string" as const },
    boardId: { type: "string" as const },
    closed: { type: "boolean" as const },
  },
};

export const trelloProvider = defineProvider({
  name: "trello",
  displayName: "Trello",
  requiresCredential: true,
  credentialType: "trelloApi",
  hosts: ["api.trello.com"],
  queries: {
    boards: {
      description: "The open boards on your Trello account",
      args: {},
      result: { type: "list", of: boardSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<TrelloBoard[]> => {
        const raw = await trelloGet<unknown>(host, "/members/me/boards", {
          filter: "open",
          fields: "id,name,url,shortLink",
        });
        return mapRows(raw, mapBoard, "boards missing or not a list");
      },
    },
    lists: {
      description: "The open lists on one Trello board",
      args: {
        boardId: {
          type: "string",
          label: "Board",
          required: true,
          source: { query: "boards" },
        },
      },
      result: { type: "list", of: listSchema },
      key: (args: TrelloBoardArgs) => [args.boardId.trim()],
      staleTime: 5 * 60 * 1000,
      fetch: async (args: TrelloBoardArgs, host): Promise<TrelloList[]> => {
        const boardId = args.boardId.trim();
        if (!boardId) throw new Error("boardId required");
        const raw = await trelloGet<unknown>(
          host,
          `/boards/${encodeURIComponent(boardId)}/lists`,
          { filter: "open", fields: "id,name,idBoard" },
        );
        return mapRows(raw, mapList, "lists missing or not a list");
      },
    },
    cards: {
      description: "The open cards on one Trello board",
      args: {
        boardId: {
          type: "string",
          label: "Board",
          required: true,
          source: { query: "boards" },
        },
      },
      result: { type: "list", of: cardSchema },
      key: (args: TrelloBoardArgs) => [args.boardId.trim()],
      staleTime: 60_000,
      fetch: async (args: TrelloBoardArgs, host): Promise<TrelloCard[]> => {
        const boardId = args.boardId.trim();
        if (!boardId) throw new Error("boardId required");
        const raw = await trelloGet<unknown>(
          host,
          `/boards/${encodeURIComponent(boardId)}/cards`,
          { filter: "open", fields: "id,name,url,desc,due,idList,idBoard,closed" },
        );
        return mapRows(raw, mapCard, "cards missing or not a list");
      },
    },
  },
  actions: {},
});

export default trelloProvider;
