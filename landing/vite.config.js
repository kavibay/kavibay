import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Local `npm run dev:landing` has no Apache. Map the production URLs so
 * /imprint and /privacy work the same way they will on the webserver.
 * POST /notify is PHP — Vite answers 501 so a local submit cannot look like
 * success.
 */
export default {
  root: dir,
  appType: "mpa",
  plugins: [
    {
      name: "landing-clean-urls",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "/";
          const q = url.indexOf("?");
          const pathname = q === -1 ? url : url.slice(0, q);
          const search = q === -1 ? "" : url.slice(q);

          if (pathname === "/notify" || pathname === "/notify.php") {
            const accept = String(req.headers.accept ?? "");
            res.statusCode = 501;
            if (accept.includes("application/json")) {
              res.setHeader("Content-Type", "application/json; charset=UTF-8");
              res.end(JSON.stringify({ ok: false }));
            } else {
              res.setHeader("Content-Type", "text/plain; charset=UTF-8");
              res.end("Notify is PHP. It runs on the Apache host, not in Vite.");
            }
            return;
          }

          const pages = {
            "/imprint": "/imprint.html",
            "/imprint/": "/imprint.html",
            "/privacy": "/privacy.html",
            "/privacy/": "/privacy.html",
          };
          const mapped = pages[pathname];
          if (mapped) {
            req.url = mapped + search;
          }
          next();
        });
      },
    },
  ],
};
