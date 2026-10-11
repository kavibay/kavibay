// SPDX-License-Identifier: MIT
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { rewriteImageUrls } from "@sdk/contract/imageUrls";
import { describeProvider } from "@sdk/contract/providerSchema";
import { tmdbExtension } from "./extension";
import { PROVIDER_ID, tmdbProvider, type TmdbMovie, type TmdbWatchProviders } from "./provider";

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

function hostFor(response: unknown, connected = true) {
  const urls: string[] = [];
  const host: ProviderHostContext = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string): Promise<T> => {
        urls.push(url);
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
});
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

const english = hostFor({ results: [] });
assert.deepEqual(await search.fetch({ query: "Inception", language: " en-US " }, english.host), []);
assert.equal(new URL(english.urls[0]!).searchParams.get("language"), "en-US");
assert.deepEqual(search.key({ query: " Inception ", language: " " }), search.key({ query: "Inception" }));
assert.notDeepEqual(search.key({ query: "Inception", language: "en-US" }), search.key({ query: "Inception" }));

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
const schema = describeProvider(PROVIDER_ID, tmdbProvider);
assert.equal(schema.credentialType, "tmdbApi");
assert.deepEqual(schema.queries.map((query) => query.name), ["searchMovies", "watchProviders"]);
assert.deepEqual(schema.actions, []);
assert.deepEqual(tmdbExtension.contributes?.providers, [tmdbProvider]);
assert.equal(tmdbExtension.contributes?.widgets?.length ?? 0, 0);

console.log("tmdb/provider.assert.ts: ok");
