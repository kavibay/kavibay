import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import TadoTile from "./widgets/TadoTile.vue";

/**
 * No `icon` yet: the host had none for this widget either, and adding one here
 * would be a catalog change riding along on a file move.
 */
const views: ExtensionViews = {
  tile: { view: TadoTile },
};

export default views;
