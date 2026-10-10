import { createApp } from "vue";
import "./styles.css";
import { hydrateDurableStorage } from "./system/durableStorage";
import { widgetWindowType } from "./host/widgetWindow";
import { vTip } from "./system/floatingTip";
import { suppressNativeContextMenu } from "./system/nativeContextMenu";
import { installOverlayScrollbars } from "./system/overlayScroll";

suppressNativeContextMenu();

// App.vue and useAppearance are imported *after* hydration on purpose: both pull
// in composables that read localStorage while their module body runs
// (useExtensionsPrefs, useDeveloperPrefs, …), so a static import here would read
// an empty cache before the durable copy has landed. See system/durableStorage.
//
// A widget window (`?widgetWindow=<type>`, see host/widgetWindow.ts) skips the
// hydration: the overlay opened it, so this origin's localStorage is already
// filled, and the overlay stays the one writer of the durable copy — it sees
// this window's writes through the `storage` event.
const ready = widgetWindowType ? Promise.resolve() : hydrateDurableStorage();
void ready.then(async () => {
  await import("./settings/useAppearance");
  const app = widgetWindowType
    ? createApp((await import("./host/WidgetWindow.vue")).default, { typeId: widgetWindowType })
    : createApp((await import("./App.vue")).default);

  app.directive("tip", vTip).mount("#app");
  installOverlayScrollbars();
});
