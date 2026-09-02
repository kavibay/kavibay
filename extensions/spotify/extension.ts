// SPDX-License-Identifier: MIT
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { spotifyProvider } from "./provider";
import { playlistsWidget } from "./widgets/playlists";

export const spotifyExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    providers: [spotifyProvider],
    widgets: [playlistsWidget],
  },
});

export default spotifyExtension;
