// SPDX-License-Identifier: MIT

/** One secondary line: owner and track count, omitting a blank owner. */
export function playlistMeta(playlist: { owner: string; trackCount: number }): string {
  const count = playlist.trackCount === 1 ? "1 track" : `${playlist.trackCount} tracks`;
  const owner = playlist.owner.trim();
  return owner ? `${owner} · ${count}` : count;
}

/** Empty-list copy. The host already owns connect and error; this is only "nothing to show". */
export function emptyPlaylistsLabel(): string {
  return "No playlists yet.";
}

/**
 * `openExternal` is https-only. An empty or non-https url must not throw —
 * throwing would error the whole card, which is what skipping `playlistTracks` avoids.
 */
export function playlistOpenUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://")) return null;
  return trimmed;
}
