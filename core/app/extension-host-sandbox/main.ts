import { createApp, h, shallowRef, type Component } from "vue";
import type { WidgetInstance } from "@sdk/contract/sdk";
import { ExtensionRegistry } from "../extension-host/registry";
import {
  SandboxGuestPort, failedMessage, mountedMessage, readInit, readThemeMessage, readyMessage,
} from "../extension-host/sandboxTransport";
import { applyTheme } from "../extension-host/sandboxTheme";
import { toProviderError } from "../extension-host/query-cache";
import { widgetViews } from "../extension-host/widgetViews";
import { todoExtension } from "../extension-host/fixtures/todo";
import { clockExtension } from "../extension-host/fixtures/clock";
import { tadoExtension } from "../extension-host/fixtures/tado";

/**
 * Entry for extension-host-sandbox.html — the code that runs *inside* the
 * sandbox.
 *
 * Nothing here is trusted, and nothing here needs to be. This registry exists
 * only to find the `setup` function for the widget the host named; every
 * decision that matters — which provider may be addressed, which queries and
 * actions are permitted, which data scope is written — is made on the other
 * side of the channel, from the host's own record of what this frame is
 * (finding 16). A guest that lied to its own registry would be lying only to
 * itself.
 *
 * What this proves, and it is the whole point of the boundary: the widget below
 * gets the same `WidgetContext` it would get in-process and cannot tell the
 * difference.
 */
const registry = new ExtensionRegistry();
registry.load(todoExtension, { kind: "bundled" });
registry.load(clockExtension, { kind: "bundled" });
registry.load(tadoExtension, { kind: "bundled" });
registry.link();

const port = new SandboxGuestPort((message) => window.parent.postMessage(message, "*"));

const model = shallowRef<unknown>(undefined);
const view = shallowRef<Component | undefined>(undefined);
let started = false;

window.addEventListener("message", (event: MessageEvent) => {
  // Only the embedder speaks to this document. `event.origin` is no use for
  // this — an opaque origin reports "null" — so the window reference is the
  // identity, exactly as on the host side.
  if (event.source !== window.parent) return;
  if (port.accept(event.data)) return;

  // Not once at startup: the cockpit's colour mode and every Appearance control
  // change while the app runs, and a widget must follow without reloading.
  const theme = readThemeMessage(event.data);
  if (theme) {
    applyTheme(
      (token, value) => document.documentElement.style.setProperty(token, value),
      theme,
    );
    return;
  }

  const init = readInit(event.data);
  // One init per document. A second would run `setup` again beside the first,
  // leaving two widgets sharing one channel.
  if (!init || started) return;
  started = true;
  void start(init.instance, init.providers);
});

async function start(instance: WidgetInstance<unknown>, providers: readonly string[]) {
  try {
    const found = registry.widget(instance.definitionId);
    if (!found) throw { kind: "not-found", message: `unknown widget ${instance.definitionId}` };

    model.value = await found.widget.component.setup(port.context(instance, providers) as never);
    view.value = widgetViews[instance.definitionId];

    // The host holds a skeleton until this arrives. Reporting it is the guest's
    // only claim about anything, and it is a claim about itself.
    window.parent.postMessage(mountedMessage(), "*");
  } catch (err) {
    // A widget that throws in setup must not be a blank frame. The host renders
    // the same error panel it would in-process; the widget never draws one.
    window.parent.postMessage(failedMessage(toProviderError(err)), "*");
  }
}

createApp({
  render: () => (view.value && model.value ? h(view.value, { model: model.value }) : null),
}).mount("#app");

// Last, so the host cannot answer before the listener above exists.
window.parent.postMessage(readyMessage(), "*");
