import { createApp } from "vue";
import DevBoard from "./DevBoard.vue";

/** Entry for extension-host-dev.html. Dev server only; never built. */
createApp(DevBoard).mount("#app");
