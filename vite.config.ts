import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const root = path.dirname(fileURLToPath(import.meta.url));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  resolve: {
    alias: {
      "@sdk": path.resolve(root, "sdk/extension"),
    },
  },

  build: {
    rollupOptions: {
      // Two windows, two entry points: the cockpit and the selection
      // quick-action popup. The popup is a separate document on purpose — it
      // must not boot the widget host (see core/app/quickaction/main.ts).
      input: {
        main: path.resolve(root, "index.html"),
        quickaction: path.resolve(root, "quickaction.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    /**
     * The sandboxed widget frame has an opaque origin, so every request it
     * makes arrives with `Origin: null` — including the fetch for its own
     * `<script type="module">`, because a module script is always fetched in
     * CORS mode. Vite 6 answers only same-origin and localhost by default, so
     * without this the guest document loads and its script never does.
     *
     * DEV ONLY, and narrow on purpose: the default localhost allowance is kept
     * rather than replaced, and "null" is added beside it instead of reaching
     * for `*`. Vite tightened this default deliberately — a permissive dev
     * server lets any page you happen to visit read your source.
     *
     * A shipped build does not need it. Runtime packages already run under an
     * opaque origin without CORS because they load classic scripts, which are
     * exempt; see finding 17 for what the contract guest has to do to match.
     */
    cors: {
      origin: [/^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, "null"],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
