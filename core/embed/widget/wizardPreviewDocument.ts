/**
 * Assembles a generated package into one self-contained preview document.
 *
 * A plain module rather than part of `EmbedWizardPreview.vue`, and that is not
 * tidiness: an SFC is parsed by an HTML block scanner before TypeScript sees
 * it, so a literal script or style tag inside a string — or inside a *comment*
 * — ends the script block. Three attempts at writing this inside the component
 * produced parse errors pointing at unrelated lines. Here the tags are just
 * text.
 *
 * The output is what a runtime package would run against on a desk: the
 * package's own `index.html`, its own `widget.js`, and the real
 * `sdk/runtime/kavibay-runtime.js`. The two `<script src>` tags become inline
 * scripts because a sandboxed `srcdoc` document has an opaque origin and can
 * fetch nothing relative to itself.
 *
 * The runtime arrives as an argument rather than an import. The component
 * loads it with Vite's `?raw`, which only Vite understands — importing it here
 * would make this function unrunnable under `tsx` and therefore unassertable,
 * and the failure it can have is exactly the silent kind that needs an assert.
 */
export interface PreviewFile {
  path: string;
  contents: string;
}

const RUNTIME_TAG = /<script[^>]*src=["'][^"']*runtime\.js["'][^>]*>\s*<\/script>/i;

/**
 * Makes a JavaScript file safe to inline inside a script element.
 *
 * An HTML parser ends a script block at the first `</script`, wherever it
 * appears — inside a string, inside a comment, it does not care. The runtime
 * SDK's own header comment contains the example
 * `<script src="kavibay-runtime.js"></script>`, so inlining it verbatim closed
 * the block a few lines in: the rest of the SDK spilled into the page as
 * visible text, and the runtime never finished loading. That was on screen
 * before it was in a test.
 *
 * `<\/script` is the standard escape and changes nothing about the code: in a
 * string literal the backslash escapes a slash to itself, and in a comment it
 * is two characters nobody reads.
 */
function inlinable(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}
const WIDGET_TAG = /<script[^>]*src=["']widget\.js["'][^>]*>\s*<\/script>/i;

/**
 * A dark canvas under a transparent widget.
 *
 * The card behind the frame supplies the glass. Without a colour scheme the
 * frame paints white for a frame or two on every reload, which reads as a
 * flash rather than as a preview.
 */
const PAGE_STYLE = `<style>
  html, body {
    margin: 0;
    height: 100%;
    background: transparent;
    color-scheme: dark;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: rgba(255, 255, 255, 0.92);
  }
</style>`;

/** `null` when the package has no entry document to show yet. */
export function buildPreviewDocument(
  files: readonly PreviewFile[],
  runtimeSource: string,
  previewPickerSource?: string,
): string | null {
  const html = files.find((file) => file.path === "index.html")?.contents;
  if (!html) return null;

  const widgetScript = files.find((file) => file.path === "widget.js")?.contents ?? "";

  const inlined = html
    .replace(RUNTIME_TAG, `<script>${inlinable(runtimeSource)}</script>`)
    .replace(WIDGET_TAG, `<script>${inlinable(widgetScript)}</script>`);

  const picker = previewPickerSource ? `<script>${inlinable(previewPickerSource)}</script>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${picker}${PAGE_STYLE}</head><body>${inlined}</body></html>`;
}
