// SPDX-License-Identifier: MIT

/**
 * Types and display helpers for the Now Playing widget.
 * Field names match Rust serde snake_case (same as System Info).
 */

/**
 * `ready` unless the platform needs consent first: on macOS, Kavibay may not
 * script Music until the user allows it ("needsConsent") or after they refused
 * ("denied").
 */
export type NowPlayingAccess = "ready" | "needsConsent" | "denied";

export interface NowPlayingInfo {
  has_session: boolean;
  access: NowPlayingAccess;
  /** The one player this platform reads (macOS: "Music"); null when any app does. */
  player: string | null;
  app_name: string;
  title: string;
  artist: string;
  /** data:image/...;base64,... or null when missing */
  album_art_data_url: string | null;
  is_playing: boolean;
}

/** Quiet empty payload when nothing is playing. */
export function emptyNowPlaying(): NowPlayingInfo {
  return {
    has_session: false,
    access: "ready",
    player: null,
    app_name: "",
    title: "",
    artist: "",
    album_art_data_url: null,
    is_playing: false,
  };
}

/**
 * Turn an AUMID / exe-ish id into a short label.
 * Examples: "Spotify.exe" → "Spotify"; "Foo.Bar_x!App" → "App" or "Foo.Bar".
 */
export function displayAppName(appName: string): string {
  const raw = appName.trim();
  if (!raw) return "";
  const afterBang = raw.includes("!") ? (raw.split("!").pop() ?? raw) : raw;
  const base = afterBang.replace(/\.exe$/i, "").trim();
  return base || raw;
}

/** Header text: cleaned app name, or "Now Playing" when empty / no session. */
export function headerLabel(info: NowPlayingInfo): string {
  if (!info.has_session) return "Now Playing";
  return displayAppName(info.app_name) || "Now Playing";
}

/** What the widget shows, in order of precedence. */
export type NowPlayingView = "needsConsent" | "denied" | "session" | "idle";

export function nowPlayingView(info: NowPlayingInfo): NowPlayingView {
  if (info.access !== "ready") return info.access;
  return info.has_session ? "session" : "idle";
}

/** Second line of the idle state: where to start something. */
export function idleHint(info: NowPlayingInfo): string {
  return info.player ? `Play something in ${info.player}` : "Start media on this PC";
}

/** A play/pause the widget sent, held until the player reports it. */
export interface ExpectedPlayState {
  isPlaying: boolean;
  untilMs: number;
}

/**
 * How long a sent play/pause outranks what the player reports. Music reported
 * "playing" for up to about half a second after a pause (measured), and
 * showing that made the button flick back.
 */
export const PLAY_STATE_GRACE_MS = 2_000;

/**
 * Applies a play/pause still in flight to a fresh snapshot. The expectation
 * ends when the player confirms it, when the session ends, or at `untilMs`,
 * after which the player is right even if the command did not take.
 */
export function settlePlayState(
  snapshot: NowPlayingInfo,
  expected: ExpectedPlayState | null,
  nowMs: number,
): { info: NowPlayingInfo; expected: ExpectedPlayState | null } {
  if (
    !expected ||
    !snapshot.has_session ||
    snapshot.is_playing === expected.isPlaying ||
    nowMs >= expected.untilMs
  ) {
    return { info: snapshot, expected: null };
  }
  return { info: { ...snapshot, is_playing: expected.isPlaying }, expected };
}

const ACCESS: readonly NowPlayingAccess[] = ["ready", "needsConsent", "denied"];

/** Normalize backend JSON into a safe NowPlayingInfo. */
export function normalizeNowPlaying(raw: unknown): NowPlayingInfo {
  if (!raw || typeof raw !== "object") return emptyNowPlaying();
  const o = raw as Record<string, unknown>;
  const access = ACCESS.find((value) => value === o.access) ?? "ready";
  const player = typeof o.player === "string" && o.player ? o.player : null;
  const has_session = access === "ready" && o.has_session === true;
  if (!has_session) return { ...emptyNowPlaying(), access, player };
  const art = o.album_art_data_url;
  return {
    has_session: true,
    access,
    player,
    app_name: typeof o.app_name === "string" ? o.app_name : "",
    title: typeof o.title === "string" ? o.title : "",
    artist: typeof o.artist === "string" ? o.artist : "",
    album_art_data_url: typeof art === "string" && art.startsWith("data:image/") ? art : null,
    is_playing: o.is_playing === true,
  };
}
