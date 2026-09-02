/**
 * Asserts for what stays on screen when the cockpit session ends.
 * Run: npx tsx core/app/host/layoutLogic.dismiss.assert.ts
 *
 * Two independent reasons to survive a dismiss — `pinned`, the user's persisted
 * decision, and a grab out of a hold-to-peek, which lasts only until they close
 * it. Collapsing them into one flag would make a single click during a peek edit
 * the saved layout.
 */
import {
  hasKeptInstance,
  shouldKeepWindowAfterDismiss,
  survivesDismiss,
} from "./layoutLogic";
import type { WidgetInstance } from "./types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function instance(over: Partial<WidgetInstance> & { instanceId: string }): WidgetInstance {
  return {
    typeId: "clock",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    ...over,
  } as WidgetInstance;
}

const plain = instance({ instanceId: "a" });
const pinned = instance({ instanceId: "b", pinned: true });
const hidden = instance({ instanceId: "c", hidden: true });
const none = new Set<string>();

// --- one instance ----------------------------------------------------------------
assert(!survivesDismiss(plain, none), "an untouched widget goes away");
assert(survivesDismiss(pinned, none), "a pinned widget stays");
assert(survivesDismiss(plain, new Set(["a"])), "a widget grabbed during a peek stays");
assert(
  !survivesDismiss(hidden, new Set(["c"])),
  "menu-Hidden wins over a grab — Hidden is the user's later word",
);

// --- does the window stay up? -----------------------------------------------------
assert(
  !shouldKeepWindowAfterDismiss([plain], false),
  "nothing pinned, nothing grabbed, no palette: the window hides",
);
assert(
  shouldKeepWindowAfterDismiss([plain], true),
  "a pinned palette holds the window open on its own",
);
assert(
  shouldKeepWindowAfterDismiss([pinned], false),
  "so does a pinned widget",
);
assert(
  shouldKeepWindowAfterDismiss([plain], false, new Set(["a"])),
  "and so does a widget grabbed out of a peek",
);
assert(
  !shouldKeepWindowAfterDismiss([plain], false, new Set(["gone"])),
  "a grab whose widget left the desk holds nothing open",
);
assert(
  !shouldKeepWindowAfterDismiss([hidden], false, new Set(["c"])),
  "nor does one the user has since hidden",
);

// --- the default keeps every existing caller honest -------------------------------
assert(
  shouldKeepWindowAfterDismiss([pinned], false) === shouldKeepWindowAfterDismiss([pinned], false, none),
  "omitting the grabs means no grabs, never all of them",
);

// --- several grabs at once --------------------------------------------------------
// One peek can collect as many widgets as the user clicks; the rule is a set, so
// nothing here is allowed to behave like "the grabbed widget" in the singular.
const second = instance({ instanceId: "d" });
const third = instance({ instanceId: "e" });
const many = new Set(["a", "d", "e"]);

assert(
  [plain, second, third].every((i) => survivesDismiss(i, many)),
  "every clicked widget stays, not just the last one",
);
assert(
  !survivesDismiss(instance({ instanceId: "untouched" }), many),
  "the ones nobody clicked still go away",
);
assert(
  shouldKeepWindowAfterDismiss([plain, second, third], false, many),
  "and they hold the window open together",
);
assert(
  shouldKeepWindowAfterDismiss([plain, second, third], false, new Set(["e"])),
  "closing all but one keeps the window up for that one",
);
assert(
  !shouldKeepWindowAfterDismiss([plain, second, third], false, none),
  "closing the last one lets the window go",
);

// --- the set helper ---------------------------------------------------------------
assert(hasKeptInstance([plain, pinned], new Set(["a"])), "finds a grabbed instance");
assert(!hasKeptInstance([plain, pinned], none), "empty set finds nothing");
assert(
  !hasKeptInstance([hidden], new Set(["c"])),
  "a hidden instance does not count as present",
);

console.log("layoutLogic.dismiss.assert.ts: all assertions passed");
