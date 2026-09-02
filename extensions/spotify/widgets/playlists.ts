// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import { emptyPlaylistsLabel, playlistMeta, playlistOpenUrl } from "../playlistsLogic";
import { PROVIDER_ID, type SpotifyPlaylist } from "../provider";

export interface PlaylistsModel {
  items: ComputedRef<SpotifyPlaylist[]>;
  emptyLabel: string;
  meta(playlist: SpotifyPlaylist): string;
  openPlaylist(playlist: SpotifyPlaylist): Promise<void>;
}

/**
 * Lists Spotify playlists and opens them in the Spotify app/site.
 *
 * Deliberately does not subscribe to `playlistTracks`. Spotify 403s some
 * playlists that still appear in `playlists` (Spotify-owned mixes, or a token
 * without playlist-read scopes). The host treats any query error as the
 * widget's phase, so one 403 would blank a list that had already loaded.
 */
export const playlistsWidget = defineWidget({
  name: "playlists",
  displayName: "Playlists",
  description: "Your Spotify playlists. Click a row to open it in Spotify.",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 3 },
  mode: "both",
  requires: { providers: [PROVIDER_ID] },
  capabilities: { openExternal: true },
  component: {
    async setup(ctx: WidgetContext): Promise<PlaylistsModel> {
      const items = ref<SpotifyPlaylist[]>([]);
      const provider = ctx.providers![PROVIDER_ID]!;
      const subscription = await provider.subscribe<SpotifyPlaylist[]>("playlists", {}, (state) => {
        if (state.status === "success") items.value = state.data;
      });
      onScopeDispose(() => subscription.unsubscribe());

      return {
        items: computed(() => items.value),
        emptyLabel: emptyPlaylistsLabel(),
        meta: playlistMeta,
        openPlaylist: async (playlist) => {
          const url = playlistOpenUrl(playlist.url);
          if (url) await ctx.openExternal!.open(url);
        },
      };
    },
  },
});
