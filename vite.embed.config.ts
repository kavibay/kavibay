import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the embed package (`core/embed/`) to a single module the landing —
 * and later a store page — loads with one `<script type="module">`.
 *
 * A separate config so this never rides along with the app build. The entry is
 * the package, not anything under the public site: consumers depend on the
 * package, never the reverse.
 *
 * Do **not** switch this to `build.lib`. Lib mode force-inlines assets
 * regardless of `assetsInlineLimit`, which is what turned a probe bundle into
 * 47 MB of base64 audio. App-mode plus fixed filenames is the shape that
 * emits real files a hand-written document can reference.
 */
export default defineConfig({
  /**
   * Where the built files actually live, as the browser sees them.
   *
   * The static import of a chunk resolves relative to the entry's own URL and
   * was always fine; Vite's *preload* helper builds its URLs from `base`, which
   * defaults to `/`. So the Wizard chunk was fetched from the site root, 404'd,
   * and the dynamic import failed — the card simply never opened, with nothing
   * in the console but a resource error.
   *
   * A leading-slash path rather than `"./"`: the pages that load this sit at
   * different depths (`/wizard.html`, `/tour.html`) while the bundle always
   * lives in one place.
   */
  base: "/embed/",
  plugins: [vue()],
  publicDir: false,
  resolve: {
    alias: {
      "@sdk": path.resolve(root, "sdk/extension"),
      /**
       * The app's real `WidgetCard.vue` reaches Tauri through
       * `system/clickThrough.ts` and `onboarding/onboardingSession.ts`, and
       * `@sdk/useWidgetData.ts` does the same for backend-polling widgets. All
       * three check `__TAURI_INTERNALS__` before every call, so in a browser
       * they are already no-ops — but the IPC plumbing would still be bundled.
       *
       * Aliasing the API to a throwing stub keeps the emitted file free of it
       * without forking a single app component. Reusing the app's card is the
       * point of this package; making the card browser-aware would be the
       * wrong direction.
       */
      "@tauri-apps/api/core": path.resolve(root, "core/embed/tauriAbsent.ts"),
      "@tauri-apps/api/event": path.resolve(root, "core/embed/tauriAbsent.ts"),
      "@tauri-apps/api/window": path.resolve(root, "core/embed/tauriAbsent.ts"),
      "@tauri-apps/api/path": path.resolve(root, "core/embed/tauriAbsent.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(
        root,
        "core/embed/tauriAbsent.ts",
      ),
    },
  },
  build: {
    outDir: path.resolve(root, "../kavibay.com/embed"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(root, "core/embed/main.ts"),
      output: {
        format: "es",
        entryFileNames: "kavibay-embed.js",
        /**
         * Split chunks are allowed, and named rather than hashed.
         *
         * A hand-written document cannot list chunks — but it does not have to:
         * the entry imports them, and the browser fetches what it needs. Only
         * the entry's name has to be stable, because that is the one the
         * `<script>` tag says. Named files also make it obvious in
         * `www.kavibay.com/embed/` what a page is paying for.
         */
        chunkFileNames: "kavibay-embed-[name].js",
        /**
         * The stylesheet keeps the stable name the hand-written documents
         * link; everything else keeps its own name.
         *
         * A flat `kavibay-embed[extname]` looked fine until the Gallery
         * arrived and pulled in every extension's `intro.mp4`: six videos
         * collided on one name and Rollup resolved it by counting —
         * `kavibay-embed2.mp4`, `kavibay-embed3.mp4`. Names that mean nothing
         * are hard to attribute when a build suddenly grows.
         *
         * Assets carry a hash because they collide by design: every extension
         * names its video `intro.mp4`. Only the stylesheet needs a fixed name,
         * because only it is linked from a hand-written document.
         */
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".css"))
            ? "kavibay-embed.css"
            : "kavibay-embed-[name]-[hash][extname]",
      },
    },
  },
});
