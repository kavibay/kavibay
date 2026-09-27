import { buildGoogleSearchUrl } from "./prefixSearch";

export const SEARCH_ACTIONS = [
  { id: "ai", label: "AI in Kavibay", description: "Answer here using the provider API key saved in Settings → AI", defaultEnabled: true },
  { id: "google", label: "Google", description: "Search in your default browser", defaultEnabled: true },
  { id: "duckduckgo", label: "DuckDuckGo", description: "Search in your default browser", defaultEnabled: true },
  { id: "chatgpt", label: "ChatGPT", description: "Open ChatGPT in your browser using your ChatGPT account", defaultEnabled: false },
  { id: "claude", label: "Claude", description: "Open Claude in your browser using your Claude account", defaultEnabled: false },
  { id: "ecosia", label: "Ecosia", description: "Search in your default browser", defaultEnabled: false },
  { id: "brave", label: "Brave Search", description: "Search in your default browser", defaultEnabled: false },
  { id: "bing", label: "Bing", description: "Search in your default browser", defaultEnabled: false },
] as const;

export type SearchActionId = typeof SEARCH_ACTIONS[number]["id"];
export type WebSearchActionId = Exclude<SearchActionId, "ai">;

export function isSearchActionId(value: unknown): value is SearchActionId {
  return SEARCH_ACTIONS.some((action) => action.id === value);
}

export function searchActionLabel(id: SearchActionId): string {
  return SEARCH_ACTIONS.find((action) => action.id === id)!.label;
}

/** Names the destination as well as the provider, including when logos look alike. */
export function searchActionTitle(id: SearchActionId, modelLabel?: string): string {
  if (id === "ai") return `Ask AI in Kavibay (saved API key)${modelLabel ? ` · ${modelLabel}` : ""}`;
  if (id === "chatgpt" || id === "claude") return `Open ${searchActionLabel(id)} in browser`;
  return `Search ${searchActionLabel(id)}`;
}

const WEB_SEARCH_PAGES: Record<Exclude<WebSearchActionId, "google">, string> = {
  duckduckgo: "https://duckduckgo.com/",
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  ecosia: "https://www.ecosia.org/search",
  brave: "https://search.brave.com/search",
  bing: "https://www.bing.com/search",
};

export function buildWebSearchUrl(id: WebSearchActionId, query: string): string {
  if (id === "google") return buildGoogleSearchUrl(query);
  const term = query.trim();
  const page = WEB_SEARCH_PAGES[id];
  return term ? `${page}?q=${encodeURIComponent(term)}` : page;
}
