// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Spotify: now-playing, library, top lists and playlists, reached only through this provider.
 *
 * Auth is attached host-side as Bearer. Vendor nesting (`item`, `artists`,
 * `album.images`, paging `items`) stops here so a widget sees a flat object.
 * HTTP 204 (nothing playing) arrives as an empty payload and becomes `null`.
 *
 * Playback writes (`play`, `pause`, `next`, `previous`, `playTrack`) need an
 * active Spotify device and a Premium account.
 */

export const PROVIDER_ID = "kavibay.spotify/spotify";

export interface SpotifyPlaying {
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  title: string;
  artist: string;
  album: string;
  albumImageUrl: string | null;
  trackUrl: string;
  trackId: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  url: string;
  addedAt: string;
}

export interface SpotifyRecentTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  url: string;
  playedAt: string;
}

export interface SpotifyTopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  url: string;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  genres: string;
}

export interface SpotifyMe {
  id: string;
  displayName: string;
  product: string;
  imageUrl: string | null;
  url: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number;
}

interface SpotifyPlaylistArgs {
  playlistId: string;
}

interface SpotifyPlayArgs {
  playlistId?: string;
  deviceId?: string;
}

interface SpotifyPlayTrackArgs {
  trackId: string;
  deviceId?: string;
}

const API = "https://api.spotify.com/v1";

/** Spotify's maximum for playlist items; asking for more is a 400. */
const TRACK_PAGE_SIZE = 50;
/** Ceiling on the walk: 500 tracks, then the list stops rather than the widget. */
const TRACK_PAGES = 10;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** First image URL in a Spotify images array (largest first), or null. */
function imageUrl(container: unknown): string | null {
  const images = asRecord(container).images;
  if (!Array.isArray(images) || images.length === 0) return null;
  const url = asString(asRecord(images[0]).url);
  return url.length > 0 ? url : null;
}

/** Joined artist names, or a show name when the item is an episode. */
function artistLine(item: Record<string, unknown>): string {
  const artists = item.artists;
  if (Array.isArray(artists)) {
    const names = artists.map((entry) => asString(asRecord(entry).name)).filter(Boolean);
    if (names.length > 0) return names.join(", ");
  }
  return asString(asRecord(item.show).name);
}

function spotifyUrl(row: Record<string, unknown>): string {
  return asString(asRecord(row.external_urls).spotify);
}

/** Maps currently-playing; empty/204/missing item is "nothing playing". */
function mapCurrentlyPlaying(raw: unknown): SpotifyPlaying | null {
  const row = asRecord(raw);
  const item = row.item;
  if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
  const track = item as Record<string, unknown>;
  const title = asString(track.name);
  const trackId = asString(track.id);
  if (!title && !trackId) return null;
  return {
    isPlaying: row.is_playing === true,
    progressMs: asNumber(row.progress_ms),
    durationMs: asNumber(track.duration_ms),
    title,
    artist: artistLine(track),
    album: asString(asRecord(track.album).name) || asString(asRecord(track.show).name),
    albumImageUrl: imageUrl(track.album) ?? imageUrl(track.show),
    trackUrl: spotifyUrl(track),
    trackId,
  };
}

/**
 * Maps one playlist row out of a paging envelope.
 *
 * The count comes from `items.total`, not `tracks.total`. Spotify's March 2026
 * migration renamed the field and left the old one in the response as a
 * deprecated husk that reads 0 — so a provider written against the previous
 * docs shows every playlist as empty and nothing errors. `tracks.total` stays
 * as a fallback for a token still answered by the old shape.
 */
function mapPlaylist(raw: unknown): SpotifyPlaylist {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("playlist missing id");
  const total = asNumber(asRecord(row.items).total) || asNumber(asRecord(row.tracks).total);
  return {
    id,
    name: asString(row.name),
    url: spotifyUrl(row),
    imageUrl: imageUrl(row),
    trackCount: total,
    owner: asString(asRecord(row.owner).display_name),
  };
}

/** Maps a Spotify track object; local files and missing ids become null. */
function mapTrack(raw: unknown): SpotifyTopTrack | null {
  const track = asRecord(raw);
  if (track.is_local === true) return null;
  const id = asString(track.id);
  if (!id) return null;
  return {
    id,
    title: asString(track.name),
    artist: artistLine(track),
    album: asString(asRecord(track.album).name),
    durationMs: asNumber(track.duration_ms),
    url: spotifyUrl(track),
  };
}

/**
 * Maps one playlist or saved-track item; the nested track is flattened.
 *
 * `item` first, `track` second: playlist items carry the track under `item`
 * since the March 2026 migration and keep `track` as a deprecated alias, while
 * `/me/tracks` still says `track`. One mapper serves both, so it reads both.
 */
function mapSavedTrack(raw: unknown): SpotifyTrack | null {
  const row = asRecord(raw);
  const track = mapTrack(row.item ?? row.track);
  if (!track) return null;
  return { ...track, addedAt: asString(row.added_at) };
}

/** Maps one recently-played item; `played_at` stays on the row, not the track. */
function mapRecentTrack(raw: unknown): SpotifyRecentTrack | null {
  const row = asRecord(raw);
  const track = mapTrack(row.track);
  if (!track) return null;
  return { ...track, playedAt: asString(row.played_at) };
}

/**
 * Maps one Spotify Connect device; a device with no id cannot be targeted.
 *
 * `is_restricted` survives the flattening because it is the difference between
 * "pick this and it plays" and "pick this and the call succeeds and nothing
 * happens" — Spotify accepts the request and the device ignores it.
 */
function mapDevice(raw: unknown): SpotifyDevice | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    name: asString(row.name),
    type: asString(row.type),
    isActive: row.is_active === true,
    isRestricted: row.is_restricted === true,
    volumePercent: asNumber(row.volume_percent),
  };
}

/** Maps `/v1/me`; `display_name` and `images` stop here. */
function mapMe(raw: unknown): SpotifyMe {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("profile missing id");
  return {
    id,
    displayName: asString(row.display_name),
    product: asString(row.product),
    imageUrl: imageUrl(row),
    url: spotifyUrl(row),
  };
}

/** Maps one artist; `genres` arrives as an array and is joined. */
function mapArtist(raw: unknown): SpotifyArtist {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("artist missing id");
  const genres = Array.isArray(row.genres)
    ? row.genres.map((entry) => asString(entry)).filter(Boolean).join(", ")
    : "";
  return {
    id,
    name: asString(row.name),
    url: spotifyUrl(row),
    imageUrl: imageUrl(row),
    genres,
  };
}

function unwrapItems(raw: unknown, missing: string): unknown[] {
  const items = asRecord(raw).items;
  if (!Array.isArray(items)) throw new Error(missing);
  return items;
}

/** `id` or an already-qualified `spotify:playlist:` URI. */
function playlistUri(playlistId: string): string {
  const id = playlistId.trim();
  if (!id) throw new Error("playlistId required");
  return id.startsWith("spotify:playlist:") ? id : `spotify:playlist:${id}`;
}

/** `id` or an already-qualified `spotify:track:` URI, never a playlist URI. */
function trackUri(trackId: string): string {
  const id = trackId.trim();
  if (!id) throw new Error("trackId required");
  return id.startsWith("spotify:track:") ? id : `spotify:track:${id}`;
}

/** GET after confirming a Spotify credential exists; auth is attached host-side. */
async function spotifyGet<T>(
  host: ProviderHostContext,
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Spotify is not connected" };
  }
  return host.http.get<T>(`${API}${path}`, params);
}

/**
 * PUT with optional JSON body (play/pause); 204 arrives as an empty payload.
 *
 * `deviceId` goes in the query string, not the body — that is where Spotify
 * reads it, and a device id put in the body is silently ignored, which looks
 * exactly like "the device did not respond".
 */
async function spotifyPut(
  host: ProviderHostContext,
  path: string,
  body?: unknown,
  deviceId?: string,
): Promise<void> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Spotify is not connected" };
  }
  const id = deviceId?.trim() ?? "";
  const url = id ? `${API}${path}?device_id=${encodeURIComponent(id)}` : `${API}${path}`;
  await host.http.put(url, body);
}

/** POST with no body (next/previous). */
async function spotifyPost(host: ProviderHostContext, path: string): Promise<void> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Spotify is not connected" };
  }
  await host.http.post(`${API}${path}`);
}

const playingSchema = {
  type: "object" as const,
  nullable: true,
  fields: {
    isPlaying: { type: "boolean" as const },
    progressMs: { type: "number" as const },
    durationMs: { type: "number" as const },
    title: { type: "string" as const },
    artist: { type: "string" as const },
    album: { type: "string" as const },
    albumImageUrl: { type: "string" as const, nullable: true, image: true },
    trackUrl: { type: "string" as const },
    trackId: { type: "string" as const },
  },
};

const playlistSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    url: { type: "string" as const },
    imageUrl: { type: "string" as const, nullable: true, image: true },
    trackCount: { type: "number" as const },
    owner: { type: "string" as const },
  },
};

const trackCoreSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    title: { type: "string" as const },
    artist: { type: "string" as const },
    album: { type: "string" as const },
    durationMs: { type: "number" as const },
    url: { type: "string" as const },
  },
};

const trackSchema = {
  type: "object" as const,
  fields: {
    ...trackCoreSchema.fields,
    addedAt: { type: "string" as const },
  },
};

const recentSchema = {
  type: "object" as const,
  fields: {
    ...trackCoreSchema.fields,
    playedAt: { type: "string" as const },
  },
};

const artistSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    url: { type: "string" as const },
    imageUrl: { type: "string" as const, nullable: true, image: true },
    genres: { type: "string" as const },
  },
};

const deviceSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    type: { type: "string" as const },
    isActive: { type: "boolean" as const },
    isRestricted: { type: "boolean" as const },
    volumePercent: { type: "number" as const },
  },
};

const meSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    displayName: { type: "string" as const },
    product: { type: "string" as const },
    imageUrl: { type: "string" as const, nullable: true, image: true },
    url: { type: "string" as const },
  },
};

export const spotifyProvider = defineProvider({
  name: "spotify",
  displayName: "Spotify",
  requiresCredential: true,
  credentialType: "spotifyOAuth2",
  hosts: ["api.spotify.com"],
  /**
   * Covers and avatars. A different set of hosts from `hosts` on purpose: these
   * are public and must never see the token, and Spotify spreads them over
   * several CDNs — `mosaic.scdn.co` serves the four-tile image a playlist gets
   * when it has no cover of its own, so leaving it out means most playlists
   * show a placeholder.
   */
  imageHosts: [
    "i.scdn.co",
    "mosaic.scdn.co",
    "image-cdn-ak.spotifycdn.com",
    "image-cdn-fa.spotifycdn.com",
  ],
  // Tracks and playlists answer from `api.spotify.com` and live on
  // `open.spotify.com`; `url` / `trackUrl` on those rows point at the latter.
  linkHosts: ["open.spotify.com"],
  queries: {
    currentlyPlaying: {
      description: "What is playing on your Spotify account right now",
      args: {},
      result: playingSchema,
      key: () => [],
      staleTime: 20_000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyPlaying | null> => {
        const raw = await spotifyGet<unknown>(host, "/me/player/currently-playing", {
          additional_types: "track,episode",
        });
        return mapCurrentlyPlaying(raw);
      },
    },
    playlists: {
      description: "The playlists on your Spotify account: name, owner, trackCount, imageUrl. To start one on the active device, call play with that playlist's id.",
      args: {},
      result: { type: "list", of: playlistSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyPlaylist[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/playlists", { limit: 50 });
        return unwrapItems(raw, "playlists missing or not a list").map(mapPlaylist);
      },
    },
    playlistTracks: {
      description: "The tracks on one Spotify playlist. Spotify 403s some playlists that still appear in playlists (Spotify-owned mixes, or an app in Development Mode reading a playlist it does not own); a list widget that also subscribes to this query will error the whole card. For a plain count use trackCount from playlists — it needs no extra request and no extra access.",
      args: {
        playlistId: {
          type: "string",
          label: "Playlist",
          required: true,
          source: { query: "playlists" },
        },
      },
      result: { type: "list", of: trackSchema },
      key: (args: SpotifyPlaylistArgs) => [args.playlistId.trim()],
      staleTime: 60_000,
      fetch: async (args: SpotifyPlaylistArgs, host): Promise<SpotifyTrack[]> => {
        const playlistId = args.playlistId.trim();
        if (!playlistId) throw new Error("playlistId required");
        const path = `/playlists/${encodeURIComponent(playlistId)}/items`;
        const tracks: SpotifyTrack[] = [];
        // Paged, because 50 is Spotify's ceiling per request and a playlist
        // that says "320 tracks" would otherwise open showing 50 with nothing
        // saying so. Bounded: a query that walks an unbounded number of pages
        // is a query that can hang a widget on somebody's 10k-track playlist.
        for (let page = 0; page < TRACK_PAGES; page += 1) {
          const raw = await spotifyGet<unknown>(host, path, {
            limit: TRACK_PAGE_SIZE,
            offset: page * TRACK_PAGE_SIZE,
          });
          for (const entry of unwrapItems(raw, "tracks missing or not a list")) {
            const track = mapSavedTrack(entry);
            // Local files and unavailable entries drop out here, so this list
            // can be shorter than the playlist's own count. That is the truth:
            // there is nothing to show for them.
            if (track) tracks.push(track);
          }
          if (asRecord(raw).next == null) break;
        }
        return tracks;
      },
    },
    devices: {
      description:
        "The Spotify Connect devices this account can play on right now: name, type, isActive, isRestricted. A device only appears while its Spotify app is open. Pass one id as deviceId to play or playTrack to start there instead of on the active device.",
      args: {},
      result: { type: "list", of: deviceSchema },
      key: () => [],
      // Short: a phone that woke up or a speaker that went to sleep changes
      // this list, and a stale list offers a device that is no longer there.
      staleTime: 10_000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyDevice[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/player/devices");
        const devices = asRecord(raw).devices;
        if (!Array.isArray(devices)) throw new Error("devices missing or not a list");
        return devices
          .map(mapDevice)
          .filter((device): device is SpotifyDevice => device !== null);
      },
    },
    me: {
      description: "Your Spotify profile name, plan and avatar",
      args: {},
      result: meSchema,
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyMe> => {
        return mapMe(await spotifyGet<unknown>(host, "/me"));
      },
    },
    recentlyPlayed: {
      description: "Tracks you played recently on Spotify",
      args: {},
      result: { type: "list", of: recentSchema },
      key: () => [],
      staleTime: 60_000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyRecentTrack[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/player/recently-played", { limit: 20 });
        return unwrapItems(raw, "recently played missing or not a list")
          .map(mapRecentTrack)
          .filter((track): track is SpotifyRecentTrack => track !== null);
      },
    },
    savedTracks: {
      description: "Liked songs on your Spotify account",
      args: {},
      result: { type: "list", of: trackSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyTrack[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/tracks", { limit: 50 });
        return unwrapItems(raw, "saved tracks missing or not a list")
          .map(mapSavedTrack)
          .filter((track): track is SpotifyTrack => track !== null);
      },
    },
    topTracks: {
      description: "Your top tracks on Spotify over the last six months",
      args: {},
      result: { type: "list", of: trackCoreSchema },
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyTopTrack[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/top/tracks", {
          limit: 20,
          time_range: "medium_term",
        });
        return unwrapItems(raw, "top tracks missing or not a list")
          .map(mapTrack)
          .filter((track): track is SpotifyTopTrack => track !== null);
      },
    },
    topArtists: {
      description: "Your top artists on Spotify over the last six months",
      args: {},
      result: { type: "list", of: artistSchema },
      key: () => [],
      staleTime: 60 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<SpotifyArtist[]> => {
        const raw = await spotifyGet<unknown>(host, "/me/top/artists", {
          limit: 20,
          time_range: "medium_term",
        });
        return unwrapItems(raw, "top artists missing or not a list").map(mapArtist);
      },
    },
  },
  actions: {
    play: {
      effect: "write",
      description:
        "Resume playback, or pass playlistId to start that playlist. Without deviceId this targets whatever device is active, which fails when none is — pass a deviceId from devices to say where. Needs Premium.",
      args: {
        playlistId: {
          type: "string",
          label: "Playlist",
          required: false,
          source: { query: "playlists" },
        },
        deviceId: {
          type: "string",
          label: "Device",
          required: false,
          source: { query: "devices" },
        },
      },
      execute: async (args: SpotifyPlayArgs, host): Promise<void> => {
        const playlistId = args.playlistId?.trim() ?? "";
        const body = playlistId ? { context_uri: playlistUri(playlistId) } : undefined;
        await spotifyPut(host, "/me/player/play", body, args.deviceId);
      },
      // The device list too: starting playback makes the target the active one,
      // and a picker still showing the old active device is a picker that lies.
      invalidates: () => [{ query: "currentlyPlaying" }, { query: "devices" }],
    },
    pause: {
      effect: "write",
      description: "Pause playback on the active Spotify device.",
      args: {},
      execute: async (_args: Record<string, never>, host): Promise<void> => {
        await spotifyPut(host, "/me/player/pause");
      },
      invalidates: () => [{ query: "currentlyPlaying" }],
    },
    next: {
      effect: "write",
      description: "Skip to the next track on the active Spotify device.",
      args: {},
      execute: async (_args: Record<string, never>, host): Promise<void> => {
        await spotifyPost(host, "/me/player/next");
      },
      invalidates: () => [{ query: "currentlyPlaying" }],
    },
    previous: {
      effect: "write",
      description: "Skip to the previous track on the active Spotify device.",
      args: {},
      execute: async (_args: Record<string, never>, host): Promise<void> => {
        await spotifyPost(host, "/me/player/previous");
      },
      invalidates: () => [{ query: "currentlyPlaying" }],
    },
    playTrack: {
      effect: "write",
      description: "Start one track. Without deviceId this targets the active device; pass a deviceId from devices to start it somewhere specific.",
      args: {
        trackId: { type: "string", label: "Track", required: true },
        deviceId: {
          type: "string",
          label: "Device",
          required: false,
          source: { query: "devices" },
        },
      },
      execute: async (args: SpotifyPlayTrackArgs, host): Promise<void> => {
        await spotifyPut(host, "/me/player/play", { uris: [trackUri(args.trackId)] }, args.deviceId);
      },
      invalidates: () => [{ query: "currentlyPlaying" }, { query: "devices" }],
    },
  },
});

export default spotifyProvider;
