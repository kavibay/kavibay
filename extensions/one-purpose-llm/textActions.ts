// SPDX-License-Identifier: MIT
import type { TextActionModule } from "@sdk/types";
import { quickActionHandlers } from "./quickAction";

/** Headless handlers for the selection quick-action window. */
const textActions: TextActionModule = {
  textActions: quickActionHandlers,
};

export default textActions;
