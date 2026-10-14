import { tmdbExtension } from "../extensions/tmdb/extension";
import { PROVIDER_ID, type TmdbMovie, type TmdbWatchProviders } from "../extensions/tmdb/provider";
import { ExtensionRegistry } from "../core/app/extension-host/registry";
import { Host } from "../core/app/extension-host/runtime";
import { tauriProviderTransport } from "../core/app/extension-host/tauriProviderTransport";
import { makeUi } from "../core/app/extension-host/fixtures/harness";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
try {
  for (const base of ["http://kavibay-img.localhost/", "kavibay-img://localhost/"]) {
    // The installed Tauri API delegates platform conversion to these internals.
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string, protocol: string) => {
          assert(path === "" && protocol === "kavibay-img", "only the image origin is converted by Tauri");
          return base;
        },
      },
    } });
    const registry = new ExtensionRegistry();
    registry.load(tmdbExtension, { kind: "bundled" });
    assert(registry.link().length === 0, "TMDB loads and links");
    const host = new Host(registry, async () => { throw new Error("unexpected frontend fetch"); }, makeUi({}).ui, {
      ...tauriProviderTransport,
      connection: async () => ({ credentialId: "test", available: true, revision: 1 }),
      fetch: async (_providerId, url) => ({ status: 200, body: url.includes("/watch/providers")
        ? { results: { DE: { flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/logo.jpg" }] } } }
        : { results: [{
        id: 27205, title: "Inception", poster_path: "/sNxqwtyHMNQwKWoFYDqCYTu5Ok.jpg",
        vote_average: 8.37, vote_count: 100,
      }] } }),
    });
    const movies = await host.query<TmdbMovie[]>(PROVIDER_ID, "searchMovies", { query: "Inception" });
    const expectedPath = "p/kavibay.tmdb%2Ftmdb/https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2FsNxqwtyHMNQwKWoFYDqCYTu5Ok.jpg";
    assert(movies[0]?.posterUrl === base + expectedPath, "the cached host result uses the actual platform image origin");
    const segments = new URL(movies[0].posterUrl).pathname.slice(1).split("/");
    assert(segments[0] === "p", "Rust sees the /p/ image route");
    assert(decodeURIComponent(segments[1]!) === PROVIDER_ID, "the provider survives one decoding pass");
    assert(decodeURIComponent(segments[2]!) === "https://image.tmdb.org/t/p/w500/sNxqwtyHMNQwKWoFYDqCYTu5Ok.jpg", "the CDN path survives one decoding pass");
    const trending = await host.query<TmdbMovie[]>(PROVIDER_ID, "trendingMovies", {});
    assert(trending[0]?.posterUrl === base + expectedPath, "trending posters also use the platform image origin");
    const availability = await host.query<TmdbWatchProviders>(PROVIDER_ID, "watchProviders", { movieId: "27205" });
    assert(availability.offers[0]?.logoUrl === base + "p/kavibay.tmdb%2Ftmdb/https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw92%2Flogo.jpg",
      "nested provider logos also use the platform image origin");
  }
} finally {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}

console.log("providerImages.assert.ts: ok");
