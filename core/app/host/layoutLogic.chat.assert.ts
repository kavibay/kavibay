/**
 * The chat grant on a card: kept across reloads, never inherited by a duplicate.
 * Run: npx tsx core/app/host/layoutLogic.chat.assert.ts
 */
import { duplicateInstance, normalizeInstance } from "./layoutLogic";
import type { WidgetInstance } from "./types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const granted: WidgetInstance = {
  instanceId: "a", typeId: "schritte-heute", offset: { x: 0, y: 0 }, chat: { model: "claude-sonnet-5-5" },
};
assert(normalizeInstance(granted).chat?.model === "claude-sonnet-5-5", "the grant survives a reload");
assert(
  normalizeInstance({ ...granted, chat: { model: 42 } as unknown as { model: string } }).chat === undefined,
  "a malformed grant is dropped",
);
assert(duplicateInstance(granted).chat === undefined, "a duplicate asks again");
