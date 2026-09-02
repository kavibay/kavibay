import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CalculatorIcon } from "@sdk/icons";
import CalculatorView from "./widgets/CalculatorView.vue";

const views: ExtensionViews = {
  calculator: { view: CalculatorView, icon: CalculatorIcon },
};

export default views;
