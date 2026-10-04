// SPDX-License-Identifier: MIT
/**
 * Spotify provider: currently-playing 204/empty → null, playlist/track flattening,
 * plus profile / recent / library / top-list unwrapping.
 * Run: npx tsx extensions/spotify/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  spotifyProvider,
  type SpotifyArtist,
  type SpotifyDevice,
  type SpotifyMe,
  type SpotifyPlaying,
  type SpotifyPlaylist,
  type SpotifyRecentTrack,
  type SpotifyTopTrack,
  type SpotifyTrack,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext & {
  lastUrl?: string;
  lastParams?: Record<string, string | number | boolean>;
  lastMethod?: string;
  lastBody?: unknown;
} {
  const host: ProviderHostContext & {
    lastUrl?: string;
    lastParams?: Record<string, string | number | boolean>;
    lastMethod?: string;
    lastBody?: unknown;
  } = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>): Promise<T> => {
        host.lastUrl = url;
        host.lastParams = params;
        host.lastMethod = "GET";
        host.lastBody = undefined;
        return response as T;
      },
      post: async <T>(url: string, body?: unknown): Promise<T> => {
        host.lastUrl = url;
        host.lastMethod = "POST";
        host.lastBody = body;
        return response as T;
      },
      put: async <T>(url: string, body?: unknown): Promise<T> => {
        host.lastUrl = url;
        host.lastMethod = "PUT";
        host.lastBody = body;
        return response as T;
      },
      patch: async () => undefined as never,
    },
  };
  return host;
}

const fetchPlaying = spotifyProvider.queries.currentlyPlaying.fetch;
const fetchPlaylists = spotifyProvider.queries.playlists.fetch;
const fetchTracks = spotifyProvider.queries.playlistTracks.fetch;

const playingHost = hostFor({
  is_playing: true,
  progress_ms: 12_000,
  item: {
    id: "t1",
    name: "Sunflower",
    duration_ms: 158_000,
    artists: [{ name: "Post Malone" }, { name: "Swae Lee" }],
    album: {
      name: "Spider-Man: Into the Spider-Verse",
      images: [
        { url: "https://i.scdn.co/image/large" },
        { url: "https://i.scdn.co/image/small" },
      ],
    },
    external_urls: { spotify: "https://open.spotify.com/track/t1" },
  },
});
const playing = (await fetchPlaying({}, playingHost)) as SpotifyPlaying | null;
assert(playing?.title === "Sunflower" && playing.artist === "Post Malone, Swae Lee", "artists are joined");
assert(playing?.albumImageUrl === "https://i.scdn.co/image/large", "the first album image is the largest");
assert(
  playingHost.lastUrl?.includes("/me/player/currently-playing"),
  "currently-playing is the player endpoint",
);

const empty = (await fetchPlaying({}, hostFor(""))) as SpotifyPlaying | null;
assert(empty === null, "HTTP 204 arrives as an empty string and means nothing is playing");

const paused = (await fetchPlaying({}, hostFor({ is_playing: false, item: null }))) as SpotifyPlaying | null;
assert(paused === null, "a missing item is nothing playing, not an error");

const playlists = (await fetchPlaylists(
  {},
  hostFor({
    items: [
      {
        id: "p1",
        name: "Liked mix",
        external_urls: { spotify: "https://open.spotify.com/playlist/p1" },
        images: [{ url: "https://i.scdn.co/image/cover" }],
        // The shape Spotify sends since the March 2026 migration: `items` holds
        // the real count and the old `tracks` stays behind reading 0. Reading
        // the deprecated one is silent — every playlist just says "0 tracks".
        items: { total: 42 },
        tracks: { total: 0 },
        owner: { display_name: "Alex" },
      },
    ],
  }),
)) as SpotifyPlaylist[];
assert(playlists.length === 1 && playlists[0]?.trackCount === 42, "the count comes from items.total, not the deprecated tracks.total");
assert(playlists[0]?.owner === "Alex" && playlists[0]?.imageUrl?.endsWith("/cover"), "owner and cover survive");

const legacyPlaylists = (await fetchPlaylists(
  {},
  hostFor({ items: [{ id: "p0", name: "Old shape", tracks: { total: 7 } }] }),
)) as SpotifyPlaylist[];
assert(legacyPlaylists[0]?.trackCount === 7, "a response still carrying only tracks.total keeps working");

const tracksHost = hostFor({
  items: [
    {
      added_at: "2026-08-01T00:00:00Z",
      // Playlist items name the track `item` now; `track` is the deprecated alias.
      item: {
        id: "t2",
        name: "Track",
        duration_ms: 180_000,
        artists: [{ name: "A" }],
        album: { name: "LP" },
        external_urls: { spotify: "https://open.spotify.com/track/t2" },
      },
    },
    { added_at: "2026-08-02T00:00:00Z", item: null },
    { added_at: "2026-08-03T00:00:00Z", item: { id: null, name: "Local file", is_local: true } },
  ],
});
const tracks = (await fetchTracks({ playlistId: " p1 " }, tracksHost)) as SpotifyTrack[];
assert(tracks.length === 1 && tracks[0]?.title === "Track", "null and local tracks are skipped");
assert(tracksHost.lastUrl?.includes("/playlists/p1/items"), "playlistId is trimmed into the path, and the path is /items — /tracks is gone");

const legacyTracks = (await fetchTracks(
  { playlistId: "p1" },
  hostFor({
    items: [
      {
        added_at: "2026-08-01T00:00:00Z",
        track: { id: "t3", name: "Old shape", duration_ms: 1, artists: [{ name: "A" }], album: { name: "LP" } },
      },
    ],
  }),
)) as SpotifyTrack[];
assert(legacyTracks[0]?.title === "Old shape", "an item still carrying only the deprecated track alias keeps working");

/** Serves one response per call, so a paged walk can be watched. */
function pagingHost(pages: unknown[]): ProviderHostContext & { urls: string[] } {
  let call = 0;
  const urls: string[] = [];
  return {
    urls,
    credentials: { isConnected: async () => true },
    http: {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>): Promise<T> => {
        urls.push(`${url}?offset=${String(params?.offset)}`);
        return (pages[call++] ?? { items: [] }) as T;
      },
      post: async <T>(): Promise<T> => undefined as T,
      put: async <T>(): Promise<T> => undefined as T,
      patch: async <T>(): Promise<T> => undefined as T,
    },
  };
}

const trackPage = (id: string) => ({
  id,
  name: id,
  duration_ms: 1,
  artists: [{ name: "A" }],
  album: { name: "LP" },
});

const pagedHost = pagingHost([
  { items: [{ added_at: "", item: trackPage("a") }], next: "https://api.spotify.com/next" },
  { items: [{ added_at: "", item: trackPage("b") }], next: null },
]);
const paged = (await fetchTracks({ playlistId: "p1" }, pagedHost)) as SpotifyTrack[];
assert(paged.length === 2, "a playlist longer than one page is walked to the end, not truncated at 50");
assert(
  pagedHost.urls[1]?.endsWith("?offset=50"),
  "the second page is asked for by offset, not by replaying the first",
);
assert(pagedHost.urls.length === 2, "a null `next` stops the walk rather than burning the page budget");

try {
  await fetchPlaylists({}, hostFor({ items: [] }, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

const fetchMe = spotifyProvider.queries.me.fetch;
const fetchRecent = spotifyProvider.queries.recentlyPlayed.fetch;
const fetchSaved = spotifyProvider.queries.savedTracks.fetch;
const fetchTopTracks = spotifyProvider.queries.topTracks.fetch;
const fetchTopArtists = spotifyProvider.queries.topArtists.fetch;

const meHost = hostFor({
  id: "user-1",
  display_name: "Alex",
  product: "premium",
  images: [{ url: "https://i.scdn.co/image/me" }],
  external_urls: { spotify: "https://open.spotify.com/user/user-1" },
});
const me = (await fetchMe({}, meHost)) as SpotifyMe;
assert(me.displayName === "Alex" && me.product === "premium", "profile fields are flattened");
assert(me.imageUrl?.endsWith("/me") && me.url.endsWith("/user/user-1"), "avatar and profile url survive");
assert(meHost.lastUrl?.endsWith("/v1/me"), "me hits /v1/me");

const recentHost = hostFor({
  items: [
    {
      played_at: "2026-08-29T08:00:00Z",
      track: {
        id: "t3",
        name: "Recent",
        duration_ms: 200_000,
        artists: [{ name: "B" }],
        album: { name: "EP" },
        external_urls: { spotify: "https://open.spotify.com/track/t3" },
      },
    },
    { played_at: "2026-08-29T07:00:00Z", track: { id: null, name: "Local", is_local: true } },
  ],
});
const recent = (await fetchRecent({}, recentHost)) as SpotifyRecentTrack[];
assert(recent.length === 1 && recent[0]?.title === "Recent" && recent[0]?.playedAt.startsWith("2026"), "recent skips local files");
assert(
  recentHost.lastUrl?.includes("/me/player/recently-played") && recentHost.lastParams?.limit === 20,
  "recently-played is capped at 20",
);

const savedHost = hostFor({
  items: [
    {
      added_at: "2026-08-10T00:00:00Z",
      track: {
        id: "t4",
        name: "Liked",
        duration_ms: 210_000,
        artists: [{ name: "C" }],
        album: { name: "LP2" },
        external_urls: { spotify: "https://open.spotify.com/track/t4" },
      },
    },
  ],
});
const saved = (await fetchSaved({}, savedHost)) as SpotifyTrack[];
assert(saved.length === 1 && saved[0]?.addedAt.startsWith("2026-08-10"), "saved tracks keep addedAt");
assert(savedHost.lastUrl?.includes("/me/tracks") && savedHost.lastParams?.limit === 50, "liked songs hit /me/tracks");

const topTracksHost = hostFor({
  items: [
    {
      id: "t5",
      name: "Top",
      duration_ms: 190_000,
      artists: [{ name: "D" }],
      album: { name: "Hits" },
      external_urls: { spotify: "https://open.spotify.com/track/t5" },
    },
  ],
});
const topTracks = (await fetchTopTracks({}, topTracksHost)) as SpotifyTopTrack[];
assert(topTracks.length === 1 && topTracks[0]?.title === "Top", "top tracks are unwrapped from items");
assert(
  topTracksHost.lastUrl?.includes("/me/top/tracks") && topTracksHost.lastParams?.time_range === "medium_term",
  "top tracks use medium_term, not a widget-chosen range",
);

const artistsHost = hostFor({
  items: [
    {
      id: "a1",
      name: "Artist",
      genres: ["pop", "indie"],
      images: [{ url: "https://i.scdn.co/image/artist" }],
      external_urls: { spotify: "https://open.spotify.com/artist/a1" },
    },
  ],
});
const artists = (await fetchTopArtists({}, artistsHost)) as SpotifyArtist[];
assert(artists.length === 1 && artists[0]?.genres === "pop, indie", "artist genres are joined");
assert(artists[0]?.imageUrl?.endsWith("/artist"), "artist image is the first (largest) one");
assert(artistsHost.lastUrl?.includes("/me/top/artists"), "top artists hit /me/top/artists");

const playHost = hostFor("");
await spotifyProvider.actions.play.execute({}, playHost);
assert(playHost.lastMethod === "PUT" && playHost.lastUrl?.endsWith("/me/player/play"), "play resumes on PUT /play");
assert(playHost.lastBody === undefined, "resume sends no body");
assert(
  spotifyProvider.actions.play.invalidates?.({})?.[0]?.query === "currentlyPlaying",
  "play invalidates now-playing",
);

const playlistHost = hostFor("");
await spotifyProvider.actions.play.execute({ playlistId: " p1 " }, playlistHost);
assert(
  JSON.stringify(playlistHost.lastBody) === JSON.stringify({ context_uri: "spotify:playlist:p1" }),
  "play with a playlist id starts that playlist on the active device",
);

const playlistUriHost = hostFor("");
await spotifyProvider.actions.play.execute({ playlistId: "spotify:playlist:p2" }, playlistUriHost);
assert(
  JSON.stringify(playlistUriHost.lastBody) === JSON.stringify({ context_uri: "spotify:playlist:p2" }),
  "an existing playlist URI is not prefixed twice",
);

/**
 * Devices: the list a widget needs before it can offer "play here".
 *
 * A device with no id is dropped rather than offered — Spotify sends one for a
 * device it knows about but cannot be told to do anything, and a picker entry
 * that cannot be the target of a call is a row that does nothing when clicked.
 */
const devices = (await spotifyProvider.queries.devices!.fetch(
  {},
  hostFor({
    devices: [
      { id: "d1", name: "Kitchen speaker", type: "speaker", is_active: true, volume_percent: 40 },
      { id: "d2", name: "Phone", type: "smartphone", is_active: false, is_restricted: true },
      { id: null, name: "A device that cannot be targeted", type: "computer" },
    ],
  }),
)) as SpotifyDevice[];
assert(devices.length === 2, "a device without an id is dropped, not offered as a target");
assert(devices[0]?.isActive === true && devices[0]?.name === "Kitchen speaker", "the active device is flagged");
assert(
  devices[1]?.isRestricted === true,
  "isRestricted survives: it is the difference between playing and a call that succeeds silently",
);

const deviceHost = hostFor("");
await spotifyProvider.actions.playTrack.execute({ trackId: "t9", deviceId: " d1 " }, deviceHost);
assert(
  deviceHost.lastUrl?.endsWith("/me/player/play?device_id=d1"),
  "deviceId is trimmed into the query string, which is the only place Spotify reads it",
);
assert(
  JSON.stringify(deviceHost.lastBody) === JSON.stringify({ uris: ["spotify:track:t9"] }),
  "the track still travels in the body; the device does not",
);

const noDeviceHost = hostFor("");
await spotifyProvider.actions.playTrack.execute({ trackId: "t9" }, noDeviceHost);
assert(
  noDeviceHost.lastUrl?.endsWith("/me/player/play"),
  "no deviceId means no query string at all, so Spotify picks the active device as before",
);

const playDeviceHost = hostFor("");
await spotifyProvider.actions.play.execute({ playlistId: "p1", deviceId: "d2" }, playDeviceHost);
assert(
  playDeviceHost.lastUrl?.endsWith("/me/player/play?device_id=d2") &&
    JSON.stringify(playDeviceHost.lastBody) === JSON.stringify({ context_uri: "spotify:playlist:p1" }),
  "play carries the playlist in the body and the device in the query",
);

assert(
  spotifyProvider.actions.play.invalidates!({}).some((entry) => entry.query === "devices"),
  "starting playback invalidates the device list, which it just changed",
);

const pauseHost = hostFor("");
await spotifyProvider.actions.pause.execute({}, pauseHost);
assert(pauseHost.lastMethod === "PUT" && pauseHost.lastUrl?.endsWith("/me/player/pause"), "pause is PUT /pause");

const nextHost = hostFor("");
await spotifyProvider.actions.next.execute({}, nextHost);
assert(nextHost.lastMethod === "POST" && nextHost.lastUrl?.endsWith("/me/player/next"), "next is POST");

const prevHost = hostFor("");
await spotifyProvider.actions.previous.execute({}, prevHost);
assert(prevHost.lastMethod === "POST" && prevHost.lastUrl?.endsWith("/me/player/previous"), "previous is POST");

const trackHost = hostFor("");
await spotifyProvider.actions.playTrack.execute({ trackId: " t6 " }, trackHost);
assert(trackHost.lastMethod === "PUT" && trackHost.lastUrl?.endsWith("/me/player/play"), "playTrack reuses PUT /play");
assert(
  JSON.stringify(trackHost.lastBody) === JSON.stringify({ uris: ["spotify:track:t6"] }),
  "a bare id becomes a track URI",
);

const uriHost = hostFor("");
await spotifyProvider.actions.playTrack.execute({ trackId: "spotify:track:t7" }, uriHost);
assert(
  JSON.stringify(uriHost.lastBody) === JSON.stringify({ uris: ["spotify:track:t7"] }),
  "an existing track URI is not prefixed twice",
);

try {
  await spotifyProvider.actions.playTrack.execute({ trackId: "  " }, hostFor(""));
  assert(false, "empty trackId must throw");
} catch (error) {
  assert(error instanceof Error && error.message.includes("trackId"), "empty trackId is refused");
}

try {
  await spotifyProvider.actions.pause.execute({}, hostFor("", false));
  assert(false, "disconnected playback must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "playback without a credential is disconnected",
  );
}

console.log("spotify provider.assert: ok");
