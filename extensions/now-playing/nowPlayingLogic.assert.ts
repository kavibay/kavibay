// SPDX-License-Identifier: MIT
import extension from "./extension";
import {
  displayAppName,
  emptyNowPlaying,
  headerLabel,
  idleHint,
  normalizeNowPlaying,
  nowPlayingView,
} from "./nowPlayingLogic";
import { nowPlayingWidget } from "./widgets/nowPlaying";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(extension.name === "now-playing", "contract extension name");
assert(nowPlayingWidget.capabilities?.nowPlaying === true, "now playing capability");
assert(displayAppName("Spotify.exe") === "Spotify", "strip exe suffix");
assert(displayAppName("Foo.Bar_x!App") === "App", "shorten AUMID");
assert(headerLabel(emptyNowPlaying()) === "Now Playing", "empty header");

const normalized = normalizeNowPlaying({
  has_session: true,
  app_name: "Spotify.exe",
  title: "Track",
  artist: "Artist",
  album_art_data_url: "data:image/png;base64,abc",
  is_playing: true,
});
assert(normalized.title === "Track", "preserve title");
assert(normalized.album_art_data_url?.startsWith("data:image/") === true, "preserve artwork");
assert(normalizeNowPlaying({ has_session: false }).title === "", "empty inactive session");
assert(normalizeNowPlaying({ has_session: true, album_art_data_url: "https://example.com/a" }).album_art_data_url === null, "reject remote artwork");

const macIdle = normalizeNowPlaying({ has_session: false, access: "ready", player: "Music" });
assert(nowPlayingView(macIdle) === "idle", "Music closed or stopped is idle");
assert(idleHint(macIdle) === "Play something in Music", "idle hint names the one player");

const windowsIdle = normalizeNowPlaying({ has_session: false, access: "ready", player: null });
assert(idleHint(windowsIdle) === "Start media on this PC", "any player on Windows");

const consent = normalizeNowPlaying({ has_session: false, access: "needsConsent", player: "Music" });
assert(nowPlayingView(consent) === "needsConsent", "consent comes before idle");
assert(consent.player === "Music", "the connect button can name the player");

const denied = normalizeNowPlaying({ has_session: true, access: "denied", title: "x", player: "Music" });
assert(nowPlayingView(denied) === "denied", "a refused player is never a session");
assert(denied.title === "", "nothing from a refused player is shown");

const playing = normalizeNowPlaying({
  has_session: true,
  access: "ready",
  player: "Music",
  app_name: "Music",
  title: "Song",
  artist: "Band",
  album_art_data_url: "data:image/jpeg;base64,AAAA",
  is_playing: true,
});
assert(nowPlayingView(playing) === "session", "a ready session plays");
assert(playing.title === "Song" && playing.artist === "Band" && playing.is_playing, "track fields");

assert(normalizeNowPlaying({ has_session: true, access: "sideways" }).access === "ready", "unknown access reads as ready");
assert(nowPlayingView(normalizeNowPlaying(null)) === "idle", "no payload is idle");

console.log("nowPlayingLogic.assert: ok");
