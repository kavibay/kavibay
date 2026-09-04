import {
  filterSettingsNav,
  flattenNavGroups,
  matchesNavEntry,
  SETTINGS_NAV_GROUPS,
  stepNavSelection,
  type SettingsNavGroup,
} from "./settingsNav";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = (groups: SettingsNavGroup[]) =>
  flattenNavGroups(groups)
    .map((entry) => entry.id)
    .join(",");
const labels = (groups: SettingsNavGroup[]) => groups.map((group) => group.label).join(",");

assert(
  filterSettingsNav(SETTINGS_NAV_GROUPS, "") === SETTINGS_NAV_GROUPS,
  "empty query is the untouched nav",
);
assert(
  filterSettingsNav(SETTINGS_NAV_GROUPS, "   ").length === SETTINGS_NAV_GROUPS.length,
  "whitespace counts as empty",
);
assert(
  ids(filterSettingsNav(SETTINGS_NAV_GROUPS, "appear")) === "appearance",
  "label prefix matches its section",
);
assert(
  ids(filterSettingsNav(SETTINGS_NAV_GROUPS, "APPEAR")) === "appearance",
  "matching ignores case",
);
assert(
  ids(filterSettingsNav(SETTINGS_NAV_GROUPS, "fls")) === "files",
  "labels match fuzzily",
);
assert(
  ids(filterSettingsNav(SETTINGS_NAV_GROUPS, "port")) === "mcp",
  "a keyword finds a section its label does not name",
);
assert(
  labels(filterSettingsNav(SETTINGS_NAV_GROUPS, "port")) === "Integrations",
  "a group with no surviving item drops out with its heading",
);
assert(
  filterSettingsNav(SETTINGS_NAV_GROUPS, "zzz").length === 0,
  "a query nothing matches leaves an empty nav",
);
assert(
  !matchesNavEntry({ id: "mcp", label: "MCP Server", keywords: ["port"] }, "x"),
  "a single stray letter is not a match",
);
assert(
  ids(filterSettingsNav(SETTINGS_NAV_GROUPS, "api key")).split(",").includes("credentials"),
  "multi-word keywords match as typed",
);

// Arrow keys walk the filtered list, not the full one.
const general = filterSettingsNav(SETTINGS_NAV_GROUPS, "");
assert(stepNavSelection(general, "appearance", 1)?.id === "behavior", "down goes to the next entry");
assert(stepNavSelection(general, "behavior", -1)?.id === "appearance", "up goes to the previous entry");
assert(
  stepNavSelection(general, "appearance", -1)?.id === "appearance",
  "the first entry stays put going up",
);
assert(
  stepNavSelection(general, "mcp", 1)?.id === "mcp",
  "the last entry stays put going down",
);
assert(
  stepNavSelection(filterSettingsNav(SETTINGS_NAV_GROUPS, "port"), "appearance", 1)?.id === "mcp",
  "a selection outside the results falls to the first result",
);
assert(stepNavSelection([], "appearance", 1) === null, "an empty nav has nowhere to step");

console.log("settingsNav.assert.ts: ok");
