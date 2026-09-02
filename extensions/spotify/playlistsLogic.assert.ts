// SPDX-License-Identifier: MIT
/**
 * Spotify playlists widget: subtitle and which urls are safe to open.
 * Run: npx tsx extensions/spotify/playlistsLogic.assert.ts
 */
import { emptyPlaylistsLabel, playlistMeta, playlistOpenUrl } from "./playlistsLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(playlistMeta({ owner: "Alex", trackCount: 42 }) === "Alex · 42 tracks", "owner and count share one line");
assert(playlistMeta({ owner: "Alex", trackCount: 1 }) === "Alex · 1 track", "one track is singular");
assert(playlistMeta({ owner: "  ", trackCount: 3 }) === "3 tracks", "a blank owner is omitted");
assert(emptyPlaylistsLabel() === "No playlists yet.", "empty copy is a sentence, not a dash");

assert(playlistOpenUrl("https://open.spotify.com/playlist/p1") === "https://open.spotify.com/playlist/p1", "https playlist urls open");
assert(playlistOpenUrl("  https://open.spotify.com/playlist/p1  ") === "https://open.spotify.com/playlist/p1", "urls are trimmed");
assert(playlistOpenUrl("") === null, "an empty url is a no-op, not an error");
assert(playlistOpenUrl("spotify:playlist:p1") === null, "spotify: URIs are not opened through the https capability");

console.log("spotify playlistsLogic.assert: ok");
