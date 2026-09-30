import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The real app, built for www.kavibay.com/app/ (see core/web/main.ts).
 *
 * Same plugins and aliases as the desktop build — the point is that nothing
 * differs but the entry. The landing page embeds the result in an iframe, so
 * the app keeps its own viewport, its `position: fixed` layers and its global
 * stylesheet without touching the page around it.
 */
export default defineConfig({
  base: "/app/",
  plugins: [vue(), servedAsIndex("web.html")],
  resolve: {
    alias: {
      "@sdk": path.resolve(root, "sdk/extension"),
    },
  },
  build: {
    outDir: path.resolve(root, "../kavibay.com/app"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(root, "web.html"),
    },
  },
});

/** `web.html` is the entry here; on the site it is the folder's index. */
function servedAsIndex(entry: string): Plugin {
  return {
    name: "kavibay-web-index",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle[entry];
      if (page) page.fileName = "index.html";
    },
  };
}
