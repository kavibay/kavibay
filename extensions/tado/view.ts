import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";

const TadoTile = defineAsyncComponent(() => import("./widgets/TadoTile.vue"));

/**
 * No `icon` yet: the host had none for this widget either, and adding one here
 * would be a catalog change riding along on a file move.
 */
const views: ExtensionViews = {
  tile: { view: TadoTile },
};

export default views;
