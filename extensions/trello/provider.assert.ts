// SPDX-License-Identifier: MIT
/**
 * Trello provider: REST arrays mapped into flat board/list/card DTOs.
 * Run: npx tsx extensions/trello/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  trelloProvider,
  type TrelloBoard,
  type TrelloCard,
  type TrelloList,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext & { lastUrl?: string; lastParams?: Record<string, string | number | boolean> } {
  const host: ProviderHostContext & {
    lastUrl?: string;
    lastParams?: Record<string, string | number | boolean>;
  } = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>): Promise<T> => {
        host.lastUrl = url;
        host.lastParams = params;
        return response as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
    },
  };
  return host;
}

const fetchBoards = trelloProvider.queries.boards.fetch;
const fetchLists = trelloProvider.queries.lists.fetch;
const fetchCards = trelloProvider.queries.cards.fetch;

const boards = await fetchBoards(
  {},
  hostFor([
    { id: "b1", name: "Inbox", url: "https://trello.com/b/abc/inbox", shortLink: "abc" },
    { id: "b2", name: "Work", url: "https://trello.com/b/def/work", shortLink: "def" },
  ]),
) as TrelloBoard[];
assert(boards.length === 2 && boards[0]?.shortLink === "abc", "boards are a flat list");
assert(boards[1]?.id === "b2" && boards[1]?.name === "Work", "board name and id survive");

const listsHost = hostFor([
  { id: "l1", name: "Doing", idBoard: "b1" },
]);
const lists = await fetchLists({ boardId: " b1 " }, listsHost) as TrelloList[];
assert(lists.length === 1 && lists[0]?.boardId === "b1", "idBoard is flattened to boardId");
assert(listsHost.lastUrl?.includes("/boards/b1/lists"), "boardId is trimmed before it is put in the path");

const cards = await fetchCards(
  { boardId: "b1" },
  hostFor([
    {
      id: "c1",
      name: "Ship Trello",
      url: "https://trello.com/c/xyz",
      desc: "Provider + credentials",
      due: "2026-09-01T12:00:00.000Z",
      idList: "l1",
      idBoard: "b1",
      closed: false,
    },
    {
      id: "c2",
      name: "No due date",
      url: "https://trello.com/c/uvw",
      desc: "",
      due: null,
      idList: "l1",
      idBoard: "b1",
      closed: false,
    },
  ]),
) as TrelloCard[];
assert(cards[0]?.description === "Provider + credentials", "desc is flattened to description");
assert(cards[0]?.listId === "l1" && cards[0]?.due?.startsWith("2026-09-01"), "list id and due survive");
assert(cards[1]?.due === null && cards[1]?.description === "", "a missing due is null, not an error");

try {
  await fetchBoards({}, hostFor([], false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

const empty = await fetchCards({ boardId: "empty" }, hostFor([])) as TrelloCard[];
assert(empty.length === 0, "a board with no cards is an empty list");

console.log("trello provider.assert: ok");
