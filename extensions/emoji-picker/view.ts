import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { FaceSlightlySmilingIcon } from "@sdk/icons";
import EmojiPickerView from "./EmojiPickerWidget.vue";

const views: ExtensionViews = {
  "emoji-picker": { view: EmojiPickerView, icon: FaceSlightlySmilingIcon },
};

export default views;
