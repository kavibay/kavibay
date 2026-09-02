import {
  ALL_CATEGORIES,
  extensionCategories,
  filterExtensions,
} from "./extensionsPanelLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const extensions = [
  {
    id: "clock",
    title: "Clock",
    description: "Local time",
    author: "kavibay",
    version: "1.0.0",
    categories: ["information"],
    keywords: ["time"],
  },
  {
    id: "timer",
    title: "Timer",
    description: "Countdown",
    author: "alex",
    version: "2.0.0",
    categories: ["productivity", "information"],
    keywords: ["focus"],
  },
] as never[];

assert(
  extensionCategories(extensions).join(",") === "information,productivity",
  "categories are unique and sorted",
);
assert(
  filterExtensions(extensions, "alex", ALL_CATEGORIES).map((extension) => extension.id).join(",") ===
    "timer",
  "search includes author",
);
assert(
  filterExtensions(extensions, "", "information").map((extension) => extension.id).join(",") ===
    "clock,timer",
  "category filter keeps matching extensions",
);
assert(
  filterExtensions(extensions, "focus", "productivity").map((extension) => extension.id).join(",") ===
    "timer",
  "search and category filters combine",
);

console.log("extensionsPanelLogic.assert.ts: ok");
