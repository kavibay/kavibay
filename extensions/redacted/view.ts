import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { EyeClosedIcon } from "@sdk/icons";

const RedactedView = defineAsyncComponent(() => import("./widgets/RedactedView.vue"));

const views: ExtensionViews = {
  redacted: { view: RedactedView, icon: EyeClosedIcon },
};

export default views;
