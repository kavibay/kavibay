import { createApp } from "vue";
import "./styles.css";
import { hydrateDurableStorage } from "./system/durableStorage";
import { vTip } from "./system/floatingTip";
import { installOverlayScrollbars } from "./system/overlayScroll";

// App.vue and useAppearance are imported *after* hydration on purpose: both pull
// in composables that read localStorage while their module body runs
// (useExtensionsPrefs, useDeveloperPrefs, …), so a static import here would read
// an empty cache before the durable copy has landed. See system/durableStorage.
void hydrateDurableStorage().then(async () => {
  await import("./settings/useAppearance");
  const { default: App } = await import("./App.vue");

  createApp(App).directive("tip", vTip).mount("#app");
  installOverlayScrollbars();
});
