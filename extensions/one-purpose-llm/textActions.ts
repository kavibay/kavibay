// SPDX-License-Identifier: MIT
import type { ExtensionModule } from "@sdk/types";
import { quickActionHandlers } from "./quickAction";

/** Headless handlers for the selection quick-action window. */
const textActions: Pick<ExtensionModule, "textActions"> = {
  textActions: quickActionHandlers,
};

export default textActions;
