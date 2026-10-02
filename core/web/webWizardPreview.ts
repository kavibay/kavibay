import RUNTIME_SOURCE from "../../sdk/runtime/kavibay-runtime.js?raw";
import CONTRACT_SOURCE from "../../sdk/contract-guest/kavibay-contract-guest.js?raw";
import PICKER_SOURCE from "../app/extension-host/previewPickerGuest.js?raw";
import { demoDraftFiles } from "../embed/widget/wizardFixture";
import { assemblePackageDocument } from "./packageDocument";
import { packageFiles } from "./webWizard";

/**
 * Where the app's package frames load a package from.
 *
 * On the desktop `RuntimeExtensionFrame` (runtime packages) and
 * `SandboxedWidgetFrame` (contract packages) load
 * `kavibay-ext://<id>/index.html`, or `__draft__<id>` for a draft, which Rust
 * serves from disk together with the host scripts (`@kavibay/runtime.js`,
 * `@kavibay/contract.js`). Here `convertFileSrc` points them at
 * `web-preview.html` instead: a small same-origin page that asks this window
 * for the assembled document — the package's files with the real host scripts
 * inlined — and writes it into itself. The frames keep their sandbox, their
 * query parameters and their message bridges; nothing in core/app knows the
 * difference.
 *
 * Separate from webWizard.ts because of the `?raw` imports, which only Vite
 * understands; the command tables stay importable by the Node assert.
 */

const PREVIEW_PAGE = `${import.meta.env.BASE_URL}web-preview.html`;

/**
 * The tour's hand inside a preview (webTour.ts). The frame is sandboxed into an
 * opaque origin, so the page cannot click in it; asked by its parent, this
 * clicks an element the way a pointer would, and the app's own picker
 * (previewPickerGuest.js) takes the click from there. Only in picker documents.
 */
const TOUR_HAND = `(() => {
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "kavibay-web:tour-pick") return;
    const target = document.querySelector(event.data.selector);
    if (!target) return;
    // Hover first, so the picker's highlight shows; the click follows when asked.
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    // Where it is, so the tour's pointer can go there; the page cannot measure in here.
    const box = target.getBoundingClientRect();
    parent.postMessage({ type: "kavibay-web:tour-rect", x: box.x, y: box.y, w: box.width, h: box.height }, "*");
    if (event.data.click) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
})();`;
const DRAFT_HOST_PREFIX = "__draft__";

interface TauriInternals {
  convertFileSrc(path: string, protocol?: string): string;
}

/** Every iframe in this document, however deep the app nested it. */
function isOwnFrame(source: MessageEventSource | null): source is Window {
  return [...document.querySelectorAll("iframe")].some((frame) => frame.contentWindow === source);
}

export function installWizardPreview(): void {
  const internals = (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
  internals.convertFileSrc = (path: string, protocol = "asset") => {
    if (protocol !== "kavibay-ext") return `${protocol}://localhost/${encodeURIComponent(path)}`;
    const [host = "", ...rest] = path.split("/");
    const draft = host.startsWith(DRAFT_HOST_PREFIX);
    const query = new URLSearchParams({
      id: draft ? host.slice(DRAFT_HOST_PREFIX.length) : host,
      kind: draft ? "draft" : "package",
      entry: rest.join("/"),
    });
    return `${PREVIEW_PAGE}?${query}`;
  };

  window.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown; id?: unknown; kind?: unknown; picker?: unknown } | null;
    if (data?.type !== "kavibay-web:preview" || !isOwnFrame(event.source)) return;
    const id = String(data.id);
    const files = data.kind === "draft" ? demoDraftFiles(id) : packageFiles(id);
    const html = assemblePackageDocument(files, {
      runtime: RUNTIME_SOURCE,
      contract: CONTRACT_SOURCE,
      picker: data.picker === true ? `${PICKER_SOURCE}
${TOUR_HAND}` : undefined,
    });
    // "*": the frame is sandboxed into an opaque origin, which cannot be named.
    event.source.postMessage({ type: "kavibay-web:preview-document", html }, "*");
  });
}
