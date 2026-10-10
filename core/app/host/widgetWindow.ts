import { invoke } from "@tauri-apps/api/core";
import type { RegisteredExtension } from "@sdk/types";

/**
 * Widgets that live in a window of their own (`ui.ownWindow`) rather than on
 * the desk — the Wizard, which people work in beside a browser and Alt+Tab to.
 *
 * Both sides of that split use this module: the overlay opens the window and
 * keeps no card of the type, and the window (`index.html?widgetWindow=<type>`)
 * mounts the one instance.
 */

/** What the overlay asks of an open widget window. */
export interface WidgetWindowRequest {
  /** Forwarded from `kavibay:run-runtime-widget`; see `WidgetFocusRequestDetail`. */
  openPackageId?: string;
  /** A palette action of the widget, run in the window where its state lives. */
  action?: string;
  args?: Record<string, string>;
}

/** The type this document mounts, or null in the overlay. */
export const widgetWindowType: string | null =
  typeof location === "undefined"
    ? null
    : new URLSearchParams(location.search).get("widgetWindow");

/**
 * One instance per type, with a fixed id: its `ctx.data` and its connection
 * binding (`widget:<id>`) have to be found again the next time it opens.
 */
export function widgetWindowInstanceId(typeId: string): string {
  return `${typeId}-window`;
}

let supported: Promise<boolean> | undefined;

/**
 * False on the landing's web build, which has one document and no windows —
 * there the Wizard stays a card, as its demo scenes expect.
 */
export function widgetWindowsSupported(): Promise<boolean> {
  supported ??= invoke<boolean>("widget_window_supported").catch(() => false);
  return supported;
}

/** Open the type's window, or bring it forward, and hand it the request. */
export function openWidgetWindow(
  extension: Pick<RegisteredExtension, "id" | "title" | "defaultSize">,
  request: WidgetWindowRequest = {},
): Promise<void> {
  return invoke("widget_window_open", {
    typeId: extension.id,
    title: extension.title,
    width: extension.defaultSize.w,
    height: extension.defaultSize.h,
    request,
  });
}
