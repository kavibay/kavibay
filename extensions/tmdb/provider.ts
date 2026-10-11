// SPDX-License-Identifier: MIT
import { defineProvider } from "@sdk/contract/sdk";

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
}

interface SearchMoviesArgs {
  query: string;
  language?: string;
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

function watchArgs(args: WatchProvidersArgs): { movieId: string; country: string } {
  const movieId = args.movieId.trim();
  const country = args.country?.trim().toUpperCase() || "DE";
  if (!/^[1-9]\d*$/.test(movieId) || !Number.isSafeInteger(Number(movieId))) {
    throw new Error("TMDB movieId must be a positive integer string");
  }
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("TMDB country must be a two-letter country code");
  return { movieId, country };
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

function mapMovie(raw: unknown): TmdbMovie {
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
  };
}

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
        "Search movies by title (first page, up to 20 results). language defaults to de-DE; use e.g. en-US for English. posterUrl is nullable; rating is the TMDB community average out of 10, null without votes. Credit TMDB when displaying its data and images (developer.themoviedb.org/docs/faq).",
      args: {
        query: { type: "string", label: "Movie title", required: true },
        language: { type: "string", label: "Language (default: de-DE)" },
      },
      result: {
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
          },
        },
      },
      key: (args: SearchMoviesArgs) => [args.query.trim(), args.language?.trim() || "de-DE"],
      staleTime: 5 * 60 * 1000,
      fetch: async (args: SearchMoviesArgs, host): Promise<TmdbMovie[]> => {
        const query = args.query.trim();
        // A search widget can start with an empty input without making a request.
        if (!query) return [];
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "TMDB is not connected" };
        }
        const params = new URLSearchParams({
          query,
          language: args.language?.trim() || "de-DE",
          include_adult: "false",
          page: "1",
        });
        const row = asRecord(await host.http.get<unknown>(`https://api.themoviedb.org/3/search/movie?${params}`));
        if (row.success === false) {
          throw new Error(asString(row.status_message) || "TMDB request failed");
        }
        if (!Array.isArray(row.results)) throw new Error("TMDB results missing or not a list");
        return row.results.map(mapMovie);
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
  },
  actions: {},
});

export default tmdbProvider;
