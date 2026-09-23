/**
 * CI guard for the app ACL (`src-tauri/build.rs`, `src-tauri/capabilities/`).
 *
 * With an app manifest, Tauri refuses any app command the calling window's
 * capability does not allow. The main window gets the generated set of every
 * command; the quick-action popup lists its own by hand, so an `invoke` added
 * to it without a capability entry would fail only at runtime, in front of a
 * user. This catches that at review time.
 *
 * Run: node scripts/appAcl.assert.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const capability = (name) =>
  JSON.parse(readFileSync(join(root, "src-tauri", "capabilities", `${name}.json`), "utf8"));

assert(
  capability("default").permissions.includes("app-commands"),
  "capabilities/default.json must grant the main window `app-commands`, or every command it calls is refused",
);

const allowed = new Set(capability("quickaction").permissions);
const popupDir = join(root, "core", "app", "quickaction");
const invoked = readdirSync(popupDir)
  .filter((file) => /\.(ts|vue)$/.test(file) && !file.includes(".assert."))
  .flatMap((file) =>
    [...readFileSync(join(popupDir, file), "utf8").matchAll(/invoke(?:<[^>]*>)?\(\s*["']([a-z0-9_]+)["']/g)].map(
      ([, command]) => ({ file, command }),
    ),
  );

assert(invoked.length > 0, "found no invoke() in core/app/quickaction — the pattern above is out of date");
for (const { file, command } of invoked) {
  assert(
    allowed.has(`allow-${command.replaceAll("_", "-")}`),
    `core/app/quickaction/${file} invokes ${command}, which capabilities/quickaction.json does not allow`,
  );
}

console.log(`appAcl.assert.mjs: ok (${invoked.length} popup invokes allowed)`);
