// SPDX-License-Identifier: MIT
import extension from "./extension";
import {
  displayAppName,
  emptyNowPlaying,
  headerLabel,
  normalizeNowPlaying,
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

console.log("nowPlayingLogic.assert: ok");
