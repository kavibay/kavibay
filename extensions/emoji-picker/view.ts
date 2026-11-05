import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { FaceSlightlySmilingIcon } from "@sdk/icons";

const EmojiPickerView = defineAsyncComponent(() => import("./EmojiPickerWidget.vue"));

const views: ExtensionViews = {
  "emoji-picker": { view: EmojiPickerView, icon: FaceSlightlySmilingIcon },
};

export default views;
