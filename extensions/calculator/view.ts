import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CalculatorIcon } from "@sdk/icons";

const CalculatorView = defineAsyncComponent(() => import("./widgets/CalculatorView.vue"));

const views: ExtensionViews = {
  calculator: { view: CalculatorView, icon: CalculatorIcon },
};

export default views;
