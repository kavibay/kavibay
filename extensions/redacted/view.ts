import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { EyeClosedIcon } from "@sdk/icons";
import RedactedView from "./widgets/RedactedView.vue";

const views: ExtensionViews = {
  redacted: { view: RedactedView, icon: EyeClosedIcon },
};

export default views;
