// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext, type ResultSchema } from "@sdk/contract/sdk";

export const PROVIDER_ID = "kavibay.tmdb/tmdb";

export interface TmdbMovie {
  id: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  /** TMDB community average out of 10; null when there are no votes. */
  rating: number | null;
  voteCount: number;
  url: string;
  /** Genre names in the requested language, in TMDB order. */
  genres: string[];
}

interface SearchMoviesArgs {
  query: string;
  language?: string;
  page?: number;
}

interface TrendingMoviesArgs {
  timeWindow?: string;
  language?: string;
  page?: number;
}

interface TopRatedMoviesArgs {
  language?: string;
  page?: number;
}

/** TMDB serves list pages 1-500; anything else is refused before a request. */
function pageArg(page: number | undefined): number {
  const value = page ?? 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("TMDB page must be an integer from 1 to 500");
  }
  return value;
}

const pageSpec = { type: "number", label: "Page, 1-500 (default: 1)" } as const;

function searchArgs(args: SearchMoviesArgs): { query: string; language: string; page: number } {
  return { query: args.query.trim(), language: args.language?.trim() || "de-DE", page: pageArg(args.page) };
}

function trendingArgs(args: TrendingMoviesArgs): { timeWindow: "day" | "week"; language: string; page: number } {
  const timeWindow = args.timeWindow?.trim() || "day";
  if (timeWindow !== "day" && timeWindow !== "week") {
    throw new Error("TMDB timeWindow must be day or week");
  }
  return { timeWindow, language: args.language?.trim() || "de-DE", page: pageArg(args.page) };
}

interface DiscoverStreamingArgs {
  providerIds?: string | string[];
  country?: string;
  sortBy?: string;
  page?: number;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  genres?: string;
}

const DISCOVER_SORTS = {
  popularity: "popularity.desc",
  rating: "vote_average.desc",
  releaseDate: "primary_release_date.desc",
} as const;

/**
 * A rating sort without a vote floor is topped by films with three 10/10 votes.
 * 200 suits the all-time list, but a year filter on recent years would hide most
 * new films behind it, so filtered lists use 50 and a range inside this or last
 * year, whose films are still collecting votes, uses 10.
 */
function ratingVoteFloor(yearFrom: number | null, yearTo: number | null, thisYear: number): number {
  if (yearFrom === null && yearTo === null) return 200;
  return yearFrom !== null && yearFrom >= thisYear - 1 ? 10 : 50;
}

const MAX_DISCOVER_PROVIDERS = 20;

function yearArg(year: number | undefined, name: string): number | null {
  if (year === undefined) return null;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1870 || year > 2100) {
    throw new Error(`TMDB ${name} must be a whole year from 1870 to 2100`);
  }
  return year;
}

function discoverArgs(args: DiscoverStreamingArgs) {
  // Missing providerIds discovers every movie. An empty list is refused rather
  // than read as "missing", so a widget with no services picked cannot silently
  // widen its "in my subscriptions" view to the whole catalogue.
  let providerIds: string | null = null;
  if (args.providerIds !== undefined) {
    // ponytail: ArgSpec has no list type, so the schema declares providerIds as a
    // "|"- or ","-separated string; arrays are accepted too. Add a list ArgSpec
    // to the contract when a second provider needs one.
    const raw: unknown[] = Array.isArray(args.providerIds)
      ? args.providerIds
      : typeof args.providerIds === "string" ? args.providerIds.split(/[|,]/) : [];
    const ids = raw.map((id) => (typeof id === "string" ? id.trim() : ""));
    if (ids.length === 0 || ids.length > MAX_DISCOVER_PROVIDERS
      || ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
      throw new Error(`TMDB providerIds must be 1-${MAX_DISCOVER_PROVIDERS} positive integer ids`);
    }
    // Order and duplicates do not change the result, so they do not split the cache.
    providerIds = [...new Set(ids)].sort((a, b) => Number(a) - Number(b)).join("|");
  }
  const sortBy = args.sortBy?.trim() || "popularity";
  if (!Object.prototype.hasOwnProperty.call(DISCOVER_SORTS, sortBy)) {
    throw new Error("TMDB sortBy must be popularity, rating or releaseDate");
  }
  const yearFrom = yearArg(args.yearFrom, "yearFrom");
  const yearTo = yearArg(args.yearTo, "yearTo");
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    throw new Error("TMDB yearFrom must not be after yearTo");
  }
  if (args.genres !== undefined && typeof args.genres !== "string") {
    throw new Error("TMDB genres must be genre names separated by |");
  }
  const genres = [...new Set((args.genres ?? "").split("|").map((name) => name.trim().toLocaleLowerCase()).filter(Boolean))].sort();
  return {
    providerIds,
    country: countryArg(args.country),
    sortBy: sortBy as keyof typeof DISCOVER_SORTS,
    page: pageArg(args.page),
    language: args.language?.trim() || "de-DE",
    yearFrom,
    yearTo,
    genres,
  };
}

interface StreamingServicesArgs {
  country?: string;
}

interface WatchProvidersArgs {
  movieId: string;
  country?: string;
}

export interface TmdbWatchProviders {
  movieId: string;
  country: string;
  watchUrl: string | null;
  offers: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    type: "subscription" | "free" | "ads" | "rent" | "buy";
  }>;
  attribution: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

function imageUrl(path: unknown, size: "w500" | "w92"): string | null {
  const filename = asString(path);
  return /^\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename)
    ? `https://image.tmdb.org/t/p/${size}${filename}`
    : null;
}

export interface TmdbStreamingService {
  id: string;
  name: string;
  logoUrl: string | null;
}

function countryArg(country: string | undefined): string {
  const code = country?.trim().toUpperCase() || "DE";
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("TMDB country must be a two-letter country code");
  return code;
}

function mapStreamingServices(raw: unknown, country: string): TmdbStreamingService[] {
  const row = asRecord(raw);
  if (row.success === false) throw new Error(asString(row.status_message) || "TMDB request failed");
  if (!Array.isArray(row.results)) throw new Error("TMDB results missing or not a list");
  const ranked = row.results.map((rawProvider) => {
    const provider = asRecord(rawProvider);
    if (typeof provider.provider_id !== "number" || !Number.isSafeInteger(provider.provider_id) || provider.provider_id <= 0) {
      throw new Error("TMDB watch provider missing a valid id");
    }
    const name = asString(provider.provider_name).trim();
    if (!name) throw new Error("TMDB watch provider missing a name");
    // The region's own ranking when TMDB sends one, the global one otherwise.
    const regional = asRecord(provider.display_priorities)[country];
    const priority = typeof regional === "number" ? regional
      : typeof provider.display_priority === "number" ? provider.display_priority : Number.MAX_SAFE_INTEGER;
    return { priority, service: { id: String(provider.provider_id), name, logoUrl: imageUrl(provider.logo_path, "w92") } };
  });
  // Array.sort is stable, so equal priorities keep TMDB's order.
  return ranked.sort((a, b) => a.priority - b.priority).map((entry) => entry.service);
}

function watchArgs(args: WatchProvidersArgs): { movieId: string; country: string } {
  const movieId = args.movieId.trim();
  if (!/^[1-9]\d*$/.test(movieId) || !Number.isSafeInteger(Number(movieId))) {
    throw new Error("TMDB movieId must be a positive integer string");
  }
  return { movieId, country: countryArg(args.country) };
}

function mapWatchProviders(raw: unknown, movieId: string, country: string): TmdbWatchProviders {
  const row = asRecord(raw);
  if (row.success === false) throw new Error(asString(row.status_message) || "TMDB request failed");
  if (typeof row.results !== "object" || row.results === null || Array.isArray(row.results)) {
    throw new Error("TMDB watch provider results missing or not an object");
  }
  const selected = asRecord(row.results)[country];
  if (selected !== undefined && (typeof selected !== "object" || selected === null || Array.isArray(selected))) {
    throw new Error("TMDB country result is not an object");
  }
  const region = asRecord(selected);
  const offers: TmdbWatchProviders["offers"] = [];
  const types = { flatrate: "subscription", free: "free", ads: "ads", rent: "rent", buy: "buy" } as const;
  for (const [group, type] of Object.entries(types)) {
    const providers = region[group];
    if (providers === undefined) continue;
    if (!Array.isArray(providers)) throw new Error(`TMDB ${group} providers are not a list`);
    for (const rawProvider of providers) {
      const provider = asRecord(rawProvider);
      if (typeof provider.provider_id !== "number" || !Number.isSafeInteger(provider.provider_id) || provider.provider_id <= 0) {
        throw new Error("TMDB watch provider missing a valid id");
      }
      const name = asString(provider.provider_name).trim();
      if (!name) throw new Error("TMDB watch provider missing a name");
      offers.push({ id: String(provider.provider_id), name, logoUrl: imageUrl(provider.logo_path, "w92"), type });
    }
  }
  let watchUrl: string | null = null;
  try {
    const link = new URL(asString(region.link));
    if (link.origin === "https://www.themoviedb.org") watchUrl = link.href;
  } catch { /* No watch link for countries without availability data. */ }
  return { movieId, country, watchUrl, offers, attribution: "Streaming availability: JustWatch" };
}

type GenreNames = Map<number, string>;

// Genre ids are stable and TMDB's list rarely changes, so one fetch per
// language lasts the session. Failures are not cached; the next query retries.
const genreCache = new Map<string, GenreNames>();

async function loadGenres(language: string, host: ProviderHostContext): Promise<GenreNames> {
  const cached = genreCache.get(language);
  if (cached) return cached;
  const params = new URLSearchParams({ language });
  const raw = asRecord(await host.http.get<unknown>(`https://api.themoviedb.org/3/genre/movie/list?${params}`));
  if (!Array.isArray(raw.genres)) throw new Error(asString(raw.status_message) || "TMDB genre list missing");
  const names: GenreNames = new Map();
  for (const genre of raw.genres.map(asRecord)) {
    const name = asString(genre.name).trim();
    if (typeof genre.id === "number" && name) names.set(genre.id, name);
  }
  genreCache.set(language, names);
  return names;
}

async function genreNames(language: string, host: ProviderHostContext): Promise<GenreNames> {
  // Genres on a result are decoration; a failed lookup must not hide the movies.
  return loadGenres(language, host).catch(() => new Map());
}

/** Genre names (lower-cased) to "|"-joined ids; an unknown name is an error, not a wider list. */
async function genreIds(names: string[], language: string, host: ProviderHostContext): Promise<string> {
  const byName = new Map([...(await loadGenres(language, host))].map(([id, name]) => [name.toLocaleLowerCase(), id]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    throw new Error(`TMDB has no genre named ${unknown.join(", ")} in ${language}; known: ${[...byName.keys()].join(", ")}`);
  }
  return names.map((name) => byName.get(name)!).join("|");
}

/** Fetches a movie list and the genre names for its language side by side. */
async function fetchMovies(url: string, language: string, host: ProviderHostContext): Promise<TmdbMovie[]> {
  const [raw, genres] = await Promise.all([host.http.get<unknown>(url), genreNames(language, host)]);
  return mapMovies(raw, genres);
}

function mapMovie(raw: unknown, genres: GenreNames): TmdbMovie {
  const row = asRecord(raw);
  if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0) {
    throw new Error("TMDB movie missing a valid id");
  }
  const voteCount =
    typeof row.vote_count === "number" && Number.isSafeInteger(row.vote_count) && row.vote_count >= 0
      ? row.vote_count
      : 0;
  const rating =
    voteCount > 0 && typeof row.vote_average === "number" && Number.isFinite(row.vote_average)
      && row.vote_average >= 0 && row.vote_average <= 10
      ? row.vote_average
      : null;
  return {
    id: String(row.id),
    title: asString(row.title) || asString(row.original_title),
    releaseDate: asString(row.release_date) || null,
    // TMDB returns a filename, never an arbitrary URL. Keep the documented
    // w500 size; the host proxies this public image without the API token.
    posterUrl: imageUrl(row.poster_path, "w500"),
    rating,
    voteCount,
    url: `https://www.themoviedb.org/movie/${row.id}`,
    genres: Array.isArray(row.genre_ids)
      ? row.genre_ids.flatMap((id) => (typeof id === "number" && genres.has(id) ? [genres.get(id)!] : []))
      : [],
  };
}

function mapMovies(raw: unknown, genres: GenreNames): TmdbMovie[] {
  const row = asRecord(raw);
  if (row.success === false) throw new Error(asString(row.status_message) || "TMDB request failed");
  if (!Array.isArray(row.results)) throw new Error("TMDB results missing or not a list");
  return row.results.map((movie) => mapMovie(movie, genres));
}

const movieListResult: ResultSchema = {
  type: "list",
  of: {
    type: "object",
    fields: {
      id: { type: "string" },
      title: { type: "string" },
      releaseDate: { type: "string", nullable: true },
      posterUrl: { type: "string", nullable: true, image: true },
      rating: { type: "number", nullable: true },
      voteCount: { type: "number" },
      url: { type: "string" },
      genres: { type: "list", of: { type: "string" } },
    },
  },
};

export const tmdbProvider = defineProvider({
  name: "tmdb",
  displayName: "TMDB",
  requiresCredential: true,
  credentialType: "tmdbApi",
  hosts: ["api.themoviedb.org"],
  imageHosts: ["image.tmdb.org"],
  linkHosts: ["www.themoviedb.org"],
  queries: {
    searchMovies: {
      description:
        "Search movies by title: one page of up to 20 results; pass page (1-500, default 1) for more. language defaults to de-DE; use e.g. en-US for English. posterUrl is nullable; rating is the TMDB community average out of 10, null without votes. genres lists genre names in the requested language (may be empty). Credit TMDB when displaying its data and images (developer.themoviedb.org/docs/faq).",
      args: {
        query: { type: "string", label: "Movie title", required: true },
        language: { type: "string", label: "Language (default: de-DE)" },
        page: pageSpec,
      },
      result: movieListResult,
      key: (args: SearchMoviesArgs) => {
        const { query, language, page } = searchArgs(args);
        return [query, language, page];
      },
      staleTime: 5 * 60 * 1000,
      fetch: async (args: SearchMoviesArgs, host): Promise<TmdbMovie[]> => {
        const { query, language, page } = searchArgs(args);
        // A search widget can start with an empty input without making a request.
        if (!query) return [];
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({ query, language, include_adult: "false", page: String(page) });
        return fetchMovies(`https://api.themoviedb.org/3/search/movie?${params}`, language, host);
      },
    },
    trendingMovies: {
      description:
        "Get trending movies on TMDB for a discovery/start view without a search term: one page of up to 20 results in TMDB ranking order; pass page (1-500, default 1) for more. timeWindow is day (default) or week. language defaults to de-DE; use e.g. en-US for English. Language localizes titles; the trending ranking is not country-specific and does not indicate streaming availability. Results use the same fields as searchMovies: id, title, releaseDate, posterUrl, rating, voteCount, url, genres. posterUrl and releaseDate are nullable; rating is the community average out of 10, null without votes; genres are names in the requested language. Pass a movie id to watchProviders for streaming offers. Credit TMDB when displaying its data and images (developer.themoviedb.org/docs/faq).",
      args: {
        timeWindow: { type: "string", label: "Trending period: day or week (default: day)" },
        language: { type: "string", label: "Language (default: de-DE)" },
        page: pageSpec,
      },
      result: movieListResult,
      key: (args: TrendingMoviesArgs) => {
        const { timeWindow, language, page } = trendingArgs(args);
        return [timeWindow, language, page];
      },
      staleTime: 15 * 60 * 1000,
      fetch: async (args: TrendingMoviesArgs, host): Promise<TmdbMovie[]> => {
        const { timeWindow, language, page } = trendingArgs(args);
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({ language, page: String(page) });
        return fetchMovies(`https://api.themoviedb.org/3/trending/movie/${timeWindow}?${params}`, language, host);
      },
    },
    topRatedMovies: {
      description:
        "TMDB's top rated movies of all time by community rating, one page of up to 20; pass page (1-500, default 1) for more. Not IMDb's Top 250; TMDB has no IMDb ratings. language defaults to de-DE; use e.g. en-US for English. Results use the same fields as trendingMovies: id, title, releaseDate, posterUrl, rating, voteCount, url, genres. Credit TMDB when displaying its data and images (developer.themoviedb.org/docs/faq).",
      args: {
        language: { type: "string", label: "Language (default: de-DE)" },
        page: pageSpec,
      },
      result: movieListResult,
      key: (args: TopRatedMoviesArgs) => [args.language?.trim() || "de-DE", pageArg(args.page)],
      // The all-time ranking moves slowly.
      staleTime: 6 * 60 * 60 * 1000,
      fetch: async (args: TopRatedMoviesArgs, host): Promise<TmdbMovie[]> => {
        const language = args.language?.trim() || "de-DE";
        const page = pageArg(args.page);
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({ language, page: String(page) });
        return fetchMovies(`https://api.themoviedb.org/3/movie/top_rated?${params}`, language, host);
      },
    },
    watchProviders: {
      description:
        "Get a movie's streaming, rental and purchase offers for one country. Pass movieId from searchMovies.id; country is a two-letter code, default DE. offers contain provider id, name, nullable logoUrl and type: subscription (included in a subscription), free, ads (with ads), rent or buy. A provider can occur in multiple types; use id + type as the row key. Empty offers mean TMDB has no availability data for this country, not proof that the movie is unavailable. watchUrl is a nullable TMDB watch-page link, not a streaming-service deep link. Display the returned JustWatch attribution with the availability data; credit TMDB for its data/images too.",
      args: {
        movieId: { type: "string", label: "Movie ID from searchMovies", required: true },
        country: { type: "string", label: "Country code (default: DE)" },
      },
      result: {
        type: "object",
        fields: {
          movieId: { type: "string" },
          country: { type: "string" },
          watchUrl: { type: "string", nullable: true },
          offers: {
            type: "list",
            of: {
              type: "object",
              fields: {
                id: { type: "string" },
                name: { type: "string" },
                logoUrl: { type: "string", nullable: true, image: true },
                type: { type: "string" },
              },
            },
          },
          attribution: { type: "string" },
        },
      },
      key: (args: WatchProvidersArgs) => {
        const { movieId, country } = watchArgs(args);
        return [movieId, country];
      },
      staleTime: 60 * 60 * 1000,
      fetch: async (args: WatchProvidersArgs, host): Promise<TmdbWatchProviders> => {
        const { movieId, country } = watchArgs(args);
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const response = await host.http.get<unknown>(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers`);
        return mapWatchProviders(response, movieId, country);
      },
    },
    discoverStreaming: {
      description:
        "Discover movies with optional filters, up to 20 per page. With providerIds: movies included in these streaming subscriptions in one country, e.g. an 'in my subscriptions' discovery view; ids come from streamingServices or watchProviders, separated by | (1-20, a movie on any of them matches; omit the argument rather than passing an empty one). Only subscription, free and with-ads offers count, not rent or buy. Without providerIds: all movies, e.g. a best-of list with a year filter. country is a two-letter code for the streaming filter, default DE. yearFrom and yearTo (whole years 1870-2100) limit the primary release year; one range only. genres are genre names in the request language separated by | (any of them matches, as shown in a result's genres); an unknown name is an error. sortBy is popularity (default), rating (community average; at least 200 votes, 50 with a year filter, 10 when yearFrom is this or last year) or releaseDate (newest first). page is 1-500, default 1. language defaults to de-DE. Results use the same fields as trendingMovies: id, title, releaseDate, posterUrl, rating, voteCount, url, genres. Streaming availability comes from JustWatch; with providerIds, credit both TMDB and JustWatch when displaying it.",
      args: {
        providerIds: { type: "string", label: "Streaming service ids, separated by | (optional)" },
        country: { type: "string", label: "Country code (default: DE)" },
        sortBy: { type: "string", label: "Sort: popularity, rating or releaseDate (default: popularity)" },
        page: pageSpec,
        language: { type: "string", label: "Language (default: de-DE)" },
        yearFrom: { type: "number", label: "Released from year (inclusive)" },
        yearTo: { type: "number", label: "Released up to year (inclusive)" },
        genres: { type: "string", label: "Genre names, separated by |" },
      },
      result: movieListResult,
      key: (args: DiscoverStreamingArgs) => {
        const { providerIds, country, sortBy, page, language, yearFrom, yearTo, genres } = discoverArgs(args);
        return [providerIds ?? "", country, sortBy, page, language, yearFrom ?? "", yearTo ?? "", genres.join("|")];
      },
      staleTime: 60 * 60 * 1000,
      fetch: async (args: DiscoverStreamingArgs, host): Promise<TmdbMovie[]> => {
        const { providerIds, country, sortBy, page, language, yearFrom, yearTo, genres } = discoverArgs(args);
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({ sort_by: DISCOVER_SORTS[sortBy] });
        if (sortBy === "rating") {
          params.set("vote_count.gte", String(ratingVoteFloor(yearFrom, yearTo, new Date().getFullYear())));
        }
        if (providerIds !== null) {
          params.set("with_watch_providers", providerIds);
          params.set("watch_region", country);
          params.set("with_watch_monetization_types", "flatrate|free|ads");
        }
        if (yearFrom !== null) params.set("primary_release_date.gte", `${yearFrom}-01-01`);
        if (yearTo !== null) params.set("primary_release_date.lte", `${yearTo}-12-31`);
        if (genres.length > 0) params.set("with_genres", await genreIds(genres, language, host));
        params.set("include_adult", "false");
        params.set("page", String(page));
        params.set("language", language);
        return fetchMovies(`https://api.themoviedb.org/3/discover/movie?${params}`, language, host);
      },
    },
    streamingServices: {
      description:
        "List all streaming services TMDB knows in one country, with logos, e.g. for a 'my subscriptions' picker. country is a two-letter code, default DE. Returns id, name and nullable logoUrl, ordered by TMDB's display priority for that country. ids match watchProviders offer ids. Streaming data comes from JustWatch; credit TMDB and JustWatch when displaying it.",
      args: {
        country: { type: "string", label: "Country code (default: DE)" },
      },
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            id: { type: "string" },
            name: { type: "string" },
            logoUrl: { type: "string", nullable: true, image: true },
          },
        },
      },
      key: (args: StreamingServicesArgs) => [countryArg(args.country)],
      // The service list changes a few times a year.
      staleTime: 24 * 60 * 60 * 1000,
      fetch: async (args: StreamingServicesArgs, host): Promise<TmdbStreamingService[]> => {
        const country = countryArg(args.country);
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({ watch_region: country });
        return mapStreamingServices(await host.http.get<unknown>(`https://api.themoviedb.org/3/watch/providers/movie?${params}`), country);
      },
    },
  },
  actions: {},
});

export default tmdbProvider;
