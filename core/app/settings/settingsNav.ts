/**
 * The Settings left column as data, plus the search over it.
 *
 * The nav used to be eight hand-written buttons. A search box cannot filter
 * markup, and a group heading has to disappear together with its last matching
 * item — both need the nav to be a list the template walks. Icons stay in the
 * SFC: this file is pure TypeScript so `tsx` can run its assertions.
 */

import { fuzzyMatch } from "../palette/fuzzy";
import type { SettingsSectionId } from "./useSettingsModal";

export interface SettingsNavEntry {
  id: SettingsSectionId;
  label: string;
  /**
   * What the panel actually contains, in the words someone would type. Nobody
   * looks for "Appearance" when what they want is the font — the label alone
   * makes the search a spelling test for names the user has not learned yet.
   */
  keywords: string[];
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavEntry[];
}

/**
 * Order is the reading order of the dialog, not a ranking — see
 * `filterSettingsNav` on why search never reorders it.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "General",
    items: [
      {
        id: "appearance",
        label: "Appearance",
        keywords: [
          "theme",
          "color mode",
          "dark",
          "light",
          "typeface",
          "font",
          "glass",
          "blur",
          "shadow",
          "spacing",
          "gap",
        ],
      },
      {
        id: "behavior",
        label: "Behavior",
        keywords: [
          "cockpit",
          "hide on outside click",
          "widget layout",
          "open on",
          "hotkey",
          "shortcut",
          "autostart",
          "startup",
          "start with windows",
          "log in",
          "launch on boot",
          "developer",
          "wizard",
          "tour",
        ],
      },
      {
        id: "search",
        label: "Search",
        keywords: ["palette", "search actions", "search engines", "google", "duckduckgo", "chatgpt", "claude", "ecosia", "brave", "bing", "logos", "icons", "order", "reorder", "no matches"],
      },
      {
        id: "files",
        label: "Files and Folders",
        keywords: ["folders", "search scope", "paths", "downloads", "documents", "desktop"],
      },
      {
        id: "extensions",
        label: "Extensions",
        keywords: [
          "widgets",
          "packages",
          "enable",
          "disable",
          "runtime",
          "install",
          // Where an integration is now set up, so the words people bring for one
          // land on the list that can actually find it by name.
          "integrations",
          "connect",
          "account",
        ],
      },
    ],
  },
  {
    label: "Integrations",
    items: [
      {
        id: "ai",
        label: "AI",
        keywords: ["providers", "models", "quick actions", "prompt", "openai", "anthropic", "claude"],
      },
      {
        id: "credentials",
        label: "Credentials",
        keywords: ["api key", "token", "secret", "password", "sign in", "connect"],
      },
      {
        id: "mcp",
        label: "MCP Server",
        keywords: ["model context protocol", "port", "connection", "clients", "authoring"],
      },
    ],
  },
];

/**
 * Label match is fuzzy — "fls" should still find Files and Folders — but
 * keywords match as plain substrings on purpose. A subsequence matcher run
 * against forty short keywords turns nearly every single letter into a hit for
 * every section, which is a filter that filters nothing.
 */
export function matchesNavEntry(entry: SettingsNavEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  if (fuzzyMatch(q, entry.label).matched) return true;
  return entry.keywords.some((keyword) => keyword.toLowerCase().includes(q));
}

/**
 * Groups with their non-matching items removed; a group that keeps nothing is
 * dropped with its heading.
 *
 * Deliberately no ranking: the nav is a place, and a place people are learning
 * their way around should not rearrange itself under the cursor while they
 * type. Matching is the whole job here.
 */
export function filterSettingsNav(
  groups: SettingsNavGroup[],
  query: string,
): SettingsNavGroup[] {
  const q = query.trim();
  if (q.length === 0) return groups;

  const filtered: SettingsNavGroup[] = [];
  for (const group of groups) {
    const items = group.items.filter((item) => matchesNavEntry(item, q));
    if (items.length > 0) filtered.push({ label: group.label, items });
  }
  return filtered;
}

/** Every visible entry in nav order — what the arrow keys walk. */
export function flattenNavGroups(groups: SettingsNavGroup[]): SettingsNavEntry[] {
  return groups.flatMap((group) => group.items);
}

/**
 * The entry one step from `current` in the filtered list, for ArrowUp/Down out
 * of the search field. Falls to the first entry when the open section is not
 * among the results, so a filtered nav is still walkable.
 */
export function stepNavSelection(
  groups: SettingsNavGroup[],
  current: SettingsSectionId,
  delta: 1 | -1,
): SettingsNavEntry | null {
  const entries = flattenNavGroups(groups);
  if (entries.length === 0) return null;

  const index = entries.findIndex((entry) => entry.id === current);
  if (index === -1) return entries[0]!;

  const next = index + delta;
  if (next < 0 || next >= entries.length) return entries[index]!;
  return entries[next]!;
}
