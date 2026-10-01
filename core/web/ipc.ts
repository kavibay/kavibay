import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { webCommand } from "./webCommands";

/**
 * The Tauri IPC, answered inside the page.
 *
 * `mockIPC` routes every `invoke()` here. Events are handled here too rather
 * than by the mock's own `shouldMockEvents`, because the page has to know when
 * the app starts listening: the desktop opens the palette with an event the
 * hotkey sends *after* the window exists, and a page that fires it before
 * WidgetHost has subscribed simply loses it.
 */

interface TauriInternals {
  runCallback(id: number, data: unknown): void;
}

const listeners = new Map<string, number[]>();
/** Events that also reach listeners registering after they fired. */
const sticky = new Map<string, unknown>();

function internals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

/** Deliver an event to every listener the app registered for it. */
export function webEmit(event: string, payload?: unknown): void {
  for (const id of listeners.get(event) ?? []) {
    internals().runCallback(id, { event, id, payload });
  }
}

/**
 * Emit now, and replay to anyone who subscribes later.
 *
 * For the state the desktop is already in when the page loads — the palette
 * was opened by a hotkey. Several components listen for that event and they
 * subscribe at different points during boot; a plain emit reaches only those
 * that happened to be first.
 */
export function webEmitSticky(event: string, payload?: unknown): void {
  sticky.set(event, payload);
  webEmit(event, payload);
}

function handleEventPlugin(cmd: string, args: Record<string, unknown>): unknown {
  const event = String(args.event);
  switch (cmd) {
    case "plugin:event|listen": {
      const id = Number(args.handler);
      listeners.set(event, [...(listeners.get(event) ?? []), id]);
      if (sticky.has(event)) {
        queueMicrotask(() => internals().runCallback(id, { event, id, payload: sticky.get(event) }));
      }
      return id;
    }
    case "plugin:event|unlisten":
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((id) => id !== Number(args.eventId)),
      );
      return null;
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      webEmit(event, args.payload);
      return null;
    default:
      return null;
  }
}

export function installWebIpc(): void {
  mockWindows("main");
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    if (cmd.startsWith("plugin:event|")) return handleEventPlugin(cmd, payload);
    return webCommand(cmd, payload);
  });
}
