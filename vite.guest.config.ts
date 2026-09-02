import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the contract guest runtime that ships inside widget packages.
 *
 * A separate config because the output has to be a **classic script**, and the
 * app's own build emits modules. An opaque origin makes every `type="module"`
 * fetch cross-origin, so a module guest does not load at all inside
 * `sandbox="allow-scripts"` — finding 17. `iife` is what makes it loadable.
 *
 * Not minified. This file ends up in third-party packages and is served to
 * them by the host, so someone reviewing a package should be able to read what
 * the host put there. It is a few kilobytes either way.
 *
 * The output is committed, like `sdk/runtime/kavibay-runtime.js`, because Rust
 * embeds it with `include_str!` at compile time — a fresh clone has to be able
 * to build without running npm first. Re-run `npm run build:guest` after
 * touching anything it imports.
 */
export default defineConfig({
  resolve: {
    alias: { "@sdk": path.resolve(root, "sdk/extension") },
  },
  build: {
    lib: {
      entry: path.resolve(root, "sdk/extension/contract/guest.ts"),
      formats: ["iife"],
      name: "KavibayContractGuestBundle",
      fileName: () => "kavibay-contract-guest.js",
    },
    outDir: path.resolve(root, "sdk/contract-guest"),
    emptyOutDir: true,
    minify: false,
  },
});

/**
 * The licence header is prepended afterwards by `scripts/guestHeader.mjs`
 * rather than by `rollupOptions.output.banner`, because lib mode replaces the
 * output options and the banner silently never appears — which the SPDX guard
 * caught. A second step that visibly runs beats a config field that quietly
 * does nothing.
 */
