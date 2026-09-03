/**
 * Replay must not treat the last run's files as this conversation's answer.
 * Run: npx tsx core/embed/demo/tour.assert.ts
 */
import { finishedDraftFromThisRun } from "./tourLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const inboxFiles = [{ contents: "const INBOX_DEMO_READY = true;" }];

assert(
  !finishedDraftFromThisRun(0, 1, inboxFiles, "INBOX_DEMO_READY"),
  "a leftover draft does not finish a conversation that has not answered yet",
);
assert(
  !finishedDraftFromThisRun(1, 2, [{ contents: "SHOW_PERCENT = true" }], "SHOW_PERCENT = true"),
  "the water tracker's first answer is not the finished widget",
);
assert(
  finishedDraftFromThisRun(1, 1, inboxFiles, "INBOX_DEMO_READY"),
  "the inbox is finished once this mount has answered and written the marker",
);
assert(
  finishedDraftFromThisRun(2, 2, [{ contents: "SHOW_PERCENT = true" }], "SHOW_PERCENT = true"),
  "the water tracker is finished on the second answer",
);
assert(
  !finishedDraftFromThisRun(2, 2, [{ contents: "SHOW_PERCENT = false" }], "SHOW_PERCENT = true"),
  "answers without the finished file are still a half-built widget",
);

console.log("core/embed/demo/tour.assert.ts: ok");
