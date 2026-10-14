// SPDX-License-Identifier: MIT
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { rewriteImageUrls } from "@sdk/contract/imageUrls";
import { describeProvider } from "@sdk/contract/providerSchema";
import { tmdbExtension } from "./extension";
import { PROVIDER_ID, tmdbProvider, type TmdbMovie, type TmdbStreamingService, type TmdbWatchProviders } from "./provider";

// Extension files are typechecked as browser code, including their assertions.
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const assert = {
  equal: (actual: unknown, expected: unknown, message = "values differ") => check(actual === expected, message),
  deepEqual: (actual: unknown, expected: unknown) => check(JSON.stringify(actual) === JSON.stringify(expected), "objects differ"),
  notDeepEqual: (actual: unknown, expected: unknown) => check(JSON.stringify(actual) !== JSON.stringify(expected), "objects unexpectedly match"),
  match: (actual: string, expected: RegExp, message = "string does not match") => check(expected.test(actual), message),
  rejects: async (promise: Promise<unknown>, expected: RegExp | { kind: string }) => {
    let rejected = false;
    try {
      await promise;
    } catch (error) {
      rejected = true;
      if (expected instanceof RegExp) {
        check(error instanceof Error && expected.test(error.message), "unexpected error message");
      } else {
        check(typeof error === "object" && error !== null && "kind" in error && error.kind === expected.kind, "unexpected error kind");
      }
    }
    check(rejected, "expected the request to reject");
  },
};

const genreList = { genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }] };

// Genre lookups get their own answer, so `response` stays the movie list.
function hostFor(response: unknown, connected = true, genres: unknown = genreList) {
  const urls: string[] = [];
  const host: ProviderHostContext = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string): Promise<T> => {
        urls.push(url);
        if (new URL(url).pathname === "/3/genre/movie/list") {
          if (genres instanceof Error) throw genres;
          return genres as T;
        }
        return response as T;
      },
      post: async () => { throw new Error("read-only provider"); },
      put: async () => { throw new Error("read-only provider"); },
      patch: async () => { throw new Error("read-only provider"); },
    },
  };
  return { host, urls };
}

const search = tmdbProvider.queries.searchMovies;
const fixture = {
  id: 27205,
  title: "Inception",
  original_title: "Inception",
  release_date: "2010-07-15",
  poster_path: "/poster_1.jpg",
  vote_average: 8.37,
  vote_count: 35000,
  genre_ids: [28, 878, 99999],
};
const request = hostFor({ results: [fixture, {
  id: 2, title: "", original_title: "Original title", release_date: "",
  poster_path: null, vote_average: 0, vote_count: 0,
}] });
const movies = await search.fetch({ query: "  Die Hüter & Co?  " }, request.host) as TmdbMovie[];
assert.deepEqual(movies[0], {
  id: "27205", title: "Inception", releaseDate: "2010-07-15",
  posterUrl: "https://image.tmdb.org/t/p/w500/poster_1.jpg",
  rating: 8.37, voteCount: 35000, url: "https://www.themoviedb.org/movie/27205",
  genres: ["Action", "Science Fiction"],
});
assert.deepEqual(movies[1]?.genres, []);
const genreUrl = new URL(request.urls[1]!);
assert.equal(genreUrl.pathname, "/3/genre/movie/list");
assert.equal(genreUrl.searchParams.get("language"), "de-DE");
assert.equal(movies[1]?.title, "Original title");
assert.equal(movies[1]?.posterUrl, null);
assert.equal(movies[1]?.releaseDate, null);
assert.equal(movies[1]?.rating, null);
const url = new URL(request.urls[0]!);
assert.equal(url.origin + url.pathname, "https://api.themoviedb.org/3/search/movie");
assert.equal(url.searchParams.get("query"), "Die Hüter & Co?");
assert.equal(url.searchParams.get("language"), "de-DE");
assert.equal(url.searchParams.get("include_adult"), "false");
assert.equal(url.searchParams.get("page"), "1");
assert.equal(url.searchParams.has("api_key"), false);

// The genre list is cached per language: a second de-DE query does not refetch it.
const again = hostFor({ results: [fixture] });
await search.fetch({ query: "Inception" }, again.host);
assert.equal(again.urls.length, 1);

// A failed genre lookup leaves genres empty, keeps the movies, and is retried.
const brokenGenres = hostFor({ results: [fixture] }, true, new Error("genre outage"));
const withoutGenres = await search.fetch({ query: "Inception", language: "fr-FR" }, brokenGenres.host) as TmdbMovie[];
assert.equal(withoutGenres[0]?.id, "27205");
assert.deepEqual(withoutGenres[0]?.genres, []);
const french = hostFor({ results: [fixture] }, true, { genres: [{ id: 28, name: "Action FR" }] });
const frenchMovies = await search.fetch({ query: "Inception", language: "fr-FR" }, french.host) as TmdbMovie[];
assert.deepEqual(frenchMovies[0]?.genres, ["Action FR"]);

const english = hostFor({ results: [] });
assert.deepEqual(await search.fetch({ query: "Inception", language: " en-US " }, english.host), []);
assert.equal(new URL(english.urls[0]!).searchParams.get("language"), "en-US");
assert.deepEqual(search.key({ query: " Inception ", language: " " }), search.key({ query: "Inception" }));
assert.notDeepEqual(search.key({ query: "Inception", language: "en-US" }), search.key({ query: "Inception" }));

const pagedSearch = hostFor({ results: [] });
await search.fetch({ query: "Inception", page: 2 }, pagedSearch.host);
assert.equal(new URL(pagedSearch.urls[0]!).searchParams.get("page"), "2");
assert.deepEqual(search.key({ query: "Inception", page: 1 }), search.key({ query: "Inception" }));
assert.notDeepEqual(search.key({ query: "Inception", page: 2 }), search.key({ query: "Inception" }));
const badPages = [0, 501, 1.5, Number.NaN, "2" as unknown as number];
const invalidSearch = hostFor(null);
for (const page of badPages) {
  await assert.rejects(search.fetch({ query: "Inception", page }, invalidSearch.host), /page/);
  await assert.rejects(search.fetch({ query: "", page }, invalidSearch.host), /page/);
}
assert.equal(invalidSearch.urls.length, 0);

const offline = hostFor(null, false);
assert.deepEqual(await search.fetch({ query: "  " }, offline.host), []);
await assert.rejects(search.fetch({ query: "Inception" }, offline.host), { kind: "disconnected" });
assert.equal(offline.urls.length, 0);
await assert.rejects(search.fetch({ query: "film" }, hostFor({ success: false, status_message: "Invalid token" }).host), /Invalid token/);
await assert.rejects(search.fetch({ query: "film" }, hostFor({ results: null }).host), /results missing/);
await assert.rejects(search.fetch({ query: "film" }, hostFor({ results: [{ id: "bad" }] }).host), /valid id/);

for (const posterPath of ["https://example.com/a.jpg", "/../a.jpg", "/a.jpg?secret=x"]) {
  const rows = await search.fetch({ query: "film" }, hostFor({ results: [{
    ...fixture, poster_path: posterPath, vote_average: Number.NaN,
  }] }).host) as TmdbMovie[];
  assert.equal(rows[0]?.posterUrl, null);
  assert.equal(rows[0]?.rating, null);
}
const zero = await search.fetch({ query: "film" }, hostFor({ results: [{ ...fixture, vote_average: 0 }] }).host) as TmdbMovie[];
assert.equal(zero[0]?.rating, 0, "a rated zero is distinct from no votes");

// Exercise the host's real schema walker: custom-widget CSP permits proxied images.
const rewritten = rewriteImageUrls(search.result!, movies, PROVIDER_ID) as TmdbMovie[];
assert.match(rewritten[0]!.posterUrl!, /^kavibay-img:\/\/localhost\/p\/kavibay\.tmdb%2Ftmdb\//);
assert.equal(rewritten[1]?.posterUrl, null);
assert.match(movies[0]!.posterUrl!, /^https:/, "rewriting does not mutate the cached vendor result");

const trending = tmdbProvider.queries.trendingMovies;
const trendingRequest = hostFor({ results: [fixture, { id: 550, title: "Fight Club" }] });
const trendingMovies = await trending.fetch({}, trendingRequest.host) as TmdbMovie[];
assert.deepEqual(trendingMovies[0], movies[0]);
assert.deepEqual(trendingMovies.map((movie) => movie.id), ["27205", "550"]);
assert.equal(trendingMovies[1]?.posterUrl, null);
assert.equal(trendingMovies[1]?.rating, null);
const trendingUrl = new URL(trendingRequest.urls[0]!);
assert.equal(trendingUrl.origin + trendingUrl.pathname, "https://api.themoviedb.org/3/trending/movie/day");
assert.equal(trendingUrl.searchParams.get("language"), "de-DE");
assert.equal(trendingUrl.searchParams.get("page"), "1");
const pagedTrending = hostFor({ results: [] });
await trending.fetch({ page: 500 }, pagedTrending.host);
assert.equal(new URL(pagedTrending.urls[0]!).searchParams.get("page"), "500");
assert.deepEqual(trending.key({ page: 1 }), trending.key({}));
assert.notDeepEqual(trending.key({ page: 2 }), trending.key({}));
assert.equal(trendingUrl.searchParams.has("api_key"), false);
const weeklyRequest = hostFor({ results: [] });
assert.deepEqual(await trending.fetch({ timeWindow: " week ", language: " en-US " }, weeklyRequest.host), []);
assert.equal(new URL(weeklyRequest.urls[0]!).pathname, "/3/trending/movie/week");
assert.equal(new URL(weeklyRequest.urls[0]!).searchParams.get("language"), "en-US");
assert.deepEqual(trending.key({ timeWindow: " day ", language: " de-DE " }), trending.key({}));
assert.deepEqual(trending.key({ timeWindow: " ", language: " " }), trending.key({}));
assert.notDeepEqual(trending.key({ timeWindow: "week" }), trending.key({}));
assert.notDeepEqual(trending.key({ language: "en-US" }), trending.key({}));
const invalidTrending = hostFor(null);
for (const timeWindow of ["month", "../all/day", "DAY"]) {
  await assert.rejects(trending.fetch({ timeWindow }, invalidTrending.host), /timeWindow must be day or week/);
}
for (const page of badPages) {
  await assert.rejects(trending.fetch({ page }, invalidTrending.host), /page/);
}
assert.equal(invalidTrending.urls.length, 0);
await assert.rejects(trending.fetch({}, offline.host), { kind: "disconnected" });
assert.equal(offline.urls.length, 0);
await assert.rejects(trending.fetch({}, hostFor({ success: false, status_message: "Invalid token" }).host), /Invalid token/);
await assert.rejects(trending.fetch({}, hostFor({ results: null }).host), /results missing/);
await assert.rejects(trending.fetch({}, hostFor({ results: [{ id: "bad" }] }).host), /valid id/);
const rewrittenTrending = rewriteImageUrls(trending.result!, trendingMovies, PROVIDER_ID) as TmdbMovie[];
assert.equal(rewrittenTrending[0]?.posterUrl, rewritten[0]?.posterUrl);
assert.equal(rewrittenTrending[1]?.posterUrl, null);

const topRated = tmdbProvider.queries.topRatedMovies;
const topRatedRequest = hostFor({ results: [fixture] });
assert.deepEqual(await topRated.fetch({}, topRatedRequest.host), [movies[0]]);
const topRatedUrl = new URL(topRatedRequest.urls[0]!);
assert.equal(topRatedUrl.origin + topRatedUrl.pathname, "https://api.themoviedb.org/3/movie/top_rated");
assert.deepEqual(Object.fromEntries(topRatedUrl.searchParams), { language: "de-DE", page: "1" });
const topRatedPaged = hostFor({ results: [] });
await topRated.fetch({ page: 7, language: " en-US " }, topRatedPaged.host);
assert.deepEqual(Object.fromEntries(new URL(topRatedPaged.urls[0]!).searchParams), { language: "en-US", page: "7" });
assert.deepEqual(topRated.key({ page: 1, language: " " }), topRated.key({}));
assert.notDeepEqual(topRated.key({ page: 2 }), topRated.key({}));
assert.notDeepEqual(topRated.key({ language: "en-US" }), topRated.key({}));
const invalidTopRated = hostFor(null);
for (const page of badPages) {
  await assert.rejects(topRated.fetch({ page }, invalidTopRated.host), /page/);
}
assert.equal(invalidTopRated.urls.length, 0);
await assert.rejects(topRated.fetch({}, offline.host), { kind: "disconnected" });
assert.equal(offline.urls.length, 0);
await assert.rejects(topRated.fetch({}, hostFor({ success: false, status_message: "Invalid token" }).host), /Invalid token/);
await assert.rejects(topRated.fetch({}, hostFor({ results: null }).host), /results missing/);

const watch = tmdbProvider.queries.watchProviders;
const providerFixture = { provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.jpg", display_priority: 1 };
const watchFixture = { results: {
  DE: {
    link: "https://www.themoviedb.org/movie/27205-inception/watch?locale=DE",
    flatrate: [providerFixture],
    free: [{ provider_id: 10, provider_name: "Free service", logo_path: null }],
    ads: [{ provider_id: 11, provider_name: "Ad service", logo_path: "/../bad.jpg" }],
    rent: [{ ...providerFixture, provider_id: 9, provider_name: "Amazon Video" }],
    buy: [{ ...providerFixture, provider_id: 9, provider_name: "Amazon Video" }],
  },
  US: { flatrate: [{ ...providerFixture, provider_id: 337, provider_name: "Disney Plus" }] },
} };
const watchRequest = hostFor(watchFixture);
const availability = await watch.fetch({ movieId: " 27205 " }, watchRequest.host) as TmdbWatchProviders;
assert.deepEqual(availability, {
  movieId: "27205", country: "DE",
  watchUrl: watchFixture.results.DE.link,
  offers: [
    { id: "8", name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/netflix.jpg", type: "subscription" },
    { id: "10", name: "Free service", logoUrl: null, type: "free" },
    { id: "11", name: "Ad service", logoUrl: null, type: "ads" },
    { id: "9", name: "Amazon Video", logoUrl: "https://image.tmdb.org/t/p/w92/netflix.jpg", type: "rent" },
    { id: "9", name: "Amazon Video", logoUrl: "https://image.tmdb.org/t/p/w92/netflix.jpg", type: "buy" },
  ],
  attribution: "Streaming availability: JustWatch",
});
assert.deepEqual(watchRequest.urls, ["https://api.themoviedb.org/3/movie/27205/watch/providers"]);
const usAvailability = await watch.fetch({ movieId: "27205", country: " us " }, hostFor(watchFixture).host) as TmdbWatchProviders;
assert.equal(usAvailability.country, "US");
assert.deepEqual(usAvailability.offers.map((offer) => offer.name), ["Disney Plus"]);
assert.equal(usAvailability.watchUrl, null);
assert.deepEqual(await watch.fetch({ movieId: "27205", country: "AT" }, hostFor(watchFixture).host), {
  movieId: "27205", country: "AT", watchUrl: null, offers: [], attribution: "Streaming availability: JustWatch",
});
assert.deepEqual(watch.key({ movieId: " 27205 ", country: " de " }), watch.key({ movieId: "27205" }));
assert.deepEqual(watch.key({ movieId: "27205", country: " " }), watch.key({ movieId: "27205" }));
assert.notDeepEqual(watch.key({ movieId: "27205", country: "US" }), watch.key({ movieId: "27205" }));
assert.notDeepEqual(watch.key({ movieId: "550" }), watch.key({ movieId: "27205" }));

await assert.rejects(watch.fetch({ movieId: "27205" }, offline.host), { kind: "disconnected" });
const invalidRequest = hostFor(watchFixture);
for (const movieId of ["", "0", "-1", "1.5", "27205/../550", "9007199254740992"]) {
  await assert.rejects(watch.fetch({ movieId }, invalidRequest.host), /movieId/);
}
await assert.rejects(watch.fetch({ movieId: "27205", country: "Germany" }, invalidRequest.host), /country/);
assert.equal(invalidRequest.urls.length, 0, "invalid identifiers cannot reach the HTTP broker");
assert.equal(offline.urls.length, 0);
await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ success: false, status_message: "Movie not found" }).host), /Movie not found/);
for (const results of [null, [], undefined]) {
  await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ results }).host), /results missing/);
}
await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ results: { DE: null } }).host), /country result/);
await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ results: { DE: { flatrate: {} } } }).host), /not a list/);
await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ results: { DE: { buy: [{ provider_id: "bad" }] } } }).host), /valid id/);
await assert.rejects(watch.fetch({ movieId: "27205" }, hostFor({ results: { DE: { buy: [{ provider_id: 9 }] } } }).host), /missing a name/);
const unsafeLink = await watch.fetch({ movieId: "27205" }, hostFor({ results: { DE: { link: "https://example.com/watch" } } }).host) as TmdbWatchProviders;
assert.equal(unsafeLink.watchUrl, null);
const rewrittenWatch = rewriteImageUrls(watch.result!, availability, PROVIDER_ID) as TmdbWatchProviders;
assert.match(rewrittenWatch.offers[0]!.logoUrl!, /^kavibay-img:\/\/localhost\/p\/kavibay\.tmdb%2Ftmdb\//);
assert.equal(rewrittenWatch.offers[1]?.logoUrl, null);
assert.equal(rewrittenWatch.watchUrl, availability.watchUrl);
assert.match(availability.offers[0]!.logoUrl!, /^https:/);
const services = tmdbProvider.queries.streamingServices;
const servicesRequest = hostFor({ results: [
  { provider_id: 9, provider_name: "Amazon Prime Video", logo_path: "/prime.jpg", display_priority: 1, display_priorities: { DE: 3 } },
  { provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.jpg", display_priority: 0, display_priorities: { DE: 0 } },
  { provider_id: 337, provider_name: "Disney Plus", logo_path: "/../bad.jpg", display_priority: 2 },
] });
const serviceList = await services.fetch({}, servicesRequest.host) as TmdbStreamingService[];
assert.deepEqual(serviceList, [
  { id: "8", name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/netflix.jpg" },
  { id: "337", name: "Disney Plus", logoUrl: null },
  { id: "9", name: "Amazon Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/prime.jpg" },
]);
assert.deepEqual(servicesRequest.urls, ["https://api.themoviedb.org/3/watch/providers/movie?watch_region=DE"]);
const usServices = hostFor({ results: [] });
assert.deepEqual(await services.fetch({ country: " us " }, usServices.host), []);
assert.equal(new URL(usServices.urls[0]!).searchParams.get("watch_region"), "US");
assert.deepEqual(services.key({ country: " de " }), services.key({}));
assert.notDeepEqual(services.key({ country: "US" }), services.key({}));
const invalidServices = hostFor(null);
await assert.rejects(services.fetch({ country: "Germany" }, invalidServices.host), /country/);
assert.equal(invalidServices.urls.length, 0);
await assert.rejects(services.fetch({}, offline.host), { kind: "disconnected" });
assert.equal(offline.urls.length, 0);
await assert.rejects(services.fetch({}, hostFor({ success: false, status_message: "Invalid token" }).host), /Invalid token/);
await assert.rejects(services.fetch({}, hostFor({ results: null }).host), /results missing/);
await assert.rejects(services.fetch({}, hostFor({ results: [{ provider_id: "bad" }] }).host), /valid id/);
const rewrittenServices = rewriteImageUrls(services.result!, serviceList, PROVIDER_ID) as TmdbStreamingService[];
assert.match(rewrittenServices[0]!.logoUrl!, /^kavibay-img:\/\/localhost\/p\/kavibay\.tmdb%2Ftmdb\//);
assert.equal(rewrittenServices[1]?.logoUrl, null);

type DiscoverArgs = Parameters<typeof tmdbProvider.queries.discoverStreaming.fetch>[0];
const discover = tmdbProvider.queries.discoverStreaming;
const discoverRequest = hostFor({ results: [fixture] });
const discovered = await discover.fetch({ providerIds: "337| 8 |8" }, discoverRequest.host) as TmdbMovie[];
assert.deepEqual(discovered[0], movies[0]);
const discoverUrl = new URL(discoverRequest.urls[0]!);
assert.equal(discoverUrl.origin + discoverUrl.pathname, "https://api.themoviedb.org/3/discover/movie");
assert.deepEqual(Object.fromEntries(discoverUrl.searchParams), {
  sort_by: "popularity.desc", with_watch_providers: "8|337", watch_region: "DE",
  with_watch_monetization_types: "flatrate|free|ads", include_adult: "false", page: "1", language: "de-DE",
});
const ratedRequest = hostFor({ results: [] });
await discover.fetch({ providerIds: ["9"], country: "us", sortBy: "rating", page: 3, language: "en-US" }, ratedRequest.host);
const ratedUrl = new URL(ratedRequest.urls[0]!);
assert.equal(ratedUrl.searchParams.get("sort_by"), "vote_average.desc");
assert.equal(ratedUrl.searchParams.get("vote_count.gte"), "200");
assert.equal(ratedUrl.searchParams.get("watch_region"), "US");
assert.equal(ratedUrl.searchParams.get("page"), "3");
assert.equal(ratedUrl.searchParams.get("language"), "en-US");
const newestRequest = hostFor({ results: [] });
await discover.fetch({ providerIds: "8", sortBy: "releaseDate" }, newestRequest.host);
assert.equal(new URL(newestRequest.urls[0]!).searchParams.get("sort_by"), "primary_release_date.desc");
assert.equal(new URL(newestRequest.urls[0]!).searchParams.has("vote_count.gte"), false);
assert.deepEqual(discover.key({ providerIds: "337|8" }), discover.key({ providerIds: ["8", "337"], country: "de", sortBy: "popularity", page: 1 }));
assert.notDeepEqual(discover.key({ providerIds: "8", page: 2 }), discover.key({ providerIds: "8" }));
assert.notDeepEqual(discover.key({ providerIds: "8", sortBy: "rating" }), discover.key({ providerIds: "8" }));
const invalidDiscover = hostFor(null);
const tooMany = Array.from({ length: 21 }, (_, i) => String(i + 1));
for (const bad of [
  { providerIds: "" }, { providerIds: [] }, { providerIds: " " }, { providerIds: "8|" }, { providerIds: "8|abc" }, { providerIds: "0" },
  { providerIds: "8&page=2" }, { providerIds: tooMany }, { providerIds: "9007199254740992" },
] as DiscoverArgs[]) {
  await assert.rejects(discover.fetch(bad, invalidDiscover.host), /providerIds/);
}
await assert.rejects(discover.fetch({ providerIds: "8", sortBy: "title" }, invalidDiscover.host), /sortBy/);
await assert.rejects(discover.fetch({ providerIds: "8", sortBy: "toString" }, invalidDiscover.host), /sortBy/);
for (const page of [0, 501, 1.5, Number.NaN, "2" as unknown as number]) {
  await assert.rejects(discover.fetch({ providerIds: "8", page }, invalidDiscover.host), /page/);
}
await assert.rejects(discover.fetch({ providerIds: "8", country: "DEU" }, invalidDiscover.host), /country/);
assert.equal(invalidDiscover.urls.length, 0, "invalid discover args cannot reach the HTTP broker");
await assert.rejects(discover.fetch({ providerIds: "8" }, offline.host), { kind: "disconnected" });
assert.equal(offline.urls.length, 0);
await assert.rejects(discover.fetch({ providerIds: "8" }, hostFor({ success: false, status_message: "Invalid token" }).host), /Invalid token/);
// Filters: year range, genre names to ids, and no providerIds means no watch filter.
const filtered = hostFor({ results: [fixture] });
await discover.fetch({ yearFrom: 1990, yearTo: 1999, genres: " science fiction|Action|action ", sortBy: "rating" }, filtered.host);
const filteredUrl = new URL(filtered.urls.find((u) => u.includes("/discover/"))!);
assert.deepEqual(Object.fromEntries(filteredUrl.searchParams), {
  sort_by: "vote_average.desc", "vote_count.gte": "50",
  "primary_release_date.gte": "1990-01-01", "primary_release_date.lte": "1999-12-31",
  with_genres: "28|878", include_adult: "false", page: "1", language: "de-DE",
});
for (const name of ["with_watch_providers", "watch_region", "with_watch_monetization_types"]) {
  assert.equal(filteredUrl.searchParams.has(name), false);
}
const thisYear = new Date().getFullYear();
const recent = hostFor({ results: [] });
await discover.fetch({ yearFrom: thisYear - 1, sortBy: "rating" }, recent.host);
const recentUrl = new URL(recent.urls[0]!);
assert.equal(recentUrl.searchParams.get("vote_count.gte"), "10");
assert.equal(recentUrl.searchParams.get("primary_release_date.gte"), `${thisYear - 1}-01-01`);
assert.equal(recentUrl.searchParams.has("primary_release_date.lte"), false);
const allTime = hostFor({ results: [] });
await discover.fetch({ sortBy: "rating" }, allTime.host);
assert.equal(new URL(allTime.urls[0]!).searchParams.get("vote_count.gte"), "200");
const onlyTo = hostFor({ results: [] });
await discover.fetch({ yearTo: 1960 }, onlyTo.host);
assert.equal(new URL(onlyTo.urls[0]!).searchParams.get("primary_release_date.lte"), "1960-12-31");
assert.equal(new URL(onlyTo.urls[0]!).searchParams.has("vote_count.gte"), false);
const unknownGenre = hostFor({ results: [fixture] });
await assert.rejects(discover.fetch({ genres: "Action|Horror" }, unknownGenre.host), /no genre named horror/);
assert.equal(unknownGenre.urls.some((u) => u.includes("/discover/")), false, "an unknown genre never widens the query");
const noGenreList = hostFor({ results: [fixture] }, true, new Error("genre outage"));
await assert.rejects(discover.fetch({ genres: "Action", language: "it-IT" }, noGenreList.host), /genre outage/);
assert.equal(noGenreList.urls.some((u) => u.includes("/discover/")), false);
assert.deepEqual(discover.key({ genres: "Action|Science Fiction" }), discover.key({ genres: " science fiction | action|Action" }));
assert.notDeepEqual(discover.key({ genres: "Action" }), discover.key({}));
assert.notDeepEqual(discover.key({ yearFrom: 2000 }), discover.key({}));
assert.notDeepEqual(discover.key({ yearTo: 2000 }), discover.key({ yearFrom: 2000 }));
assert.notDeepEqual(discover.key({ providerIds: "8" }), discover.key({}));
for (const bad of [
  { yearFrom: 1869 }, { yearTo: 2101 }, { yearFrom: 1999.5 }, { yearFrom: "1999" as unknown as number },
  { yearFrom: 2001, yearTo: 2000 },
] as DiscoverArgs[]) {
  await assert.rejects(discover.fetch(bad, invalidDiscover.host), /year/);
}
await assert.rejects(discover.fetch({ genres: ["Action"] as unknown as string }, invalidDiscover.host), /genres/);
assert.equal(invalidDiscover.urls.length, 0);

const rewrittenDiscover = rewriteImageUrls(discover.result!, discovered, PROVIDER_ID) as TmdbMovie[];
assert.equal(rewrittenDiscover[0]?.posterUrl, rewritten[0]?.posterUrl);

const schema = describeProvider(PROVIDER_ID, tmdbProvider);
assert.equal(schema.credentialType, "tmdbApi");
assert.deepEqual(schema.queries.map((query) => query.name), ["discoverStreaming", "searchMovies", "streamingServices", "topRatedMovies", "trendingMovies", "watchProviders"]);
assert.deepEqual(schema.actions, []);
assert.deepEqual(tmdbExtension.contributes?.providers, [tmdbProvider]);
assert.equal(tmdbExtension.contributes?.widgets?.length ?? 0, 0);

console.log("tmdb/provider.assert.ts: ok");
