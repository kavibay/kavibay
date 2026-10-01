/**
 * Writes `dist/licenses.txt`: Kavibay's own terms, then the license of every
 * npm and Rust dependency that ships in the app. The About panel shows it.
 *
 * Run by `pnpm run build`, after vite (which empties `dist/`). Tauri embeds
 * `dist/` in the binary, so the installer and the standalone .exe both carry
 * it. MIT, BSD, ISC and Apache all require the notice to travel with binaries,
 * and the "no warranty" clause only protects anyone if a user can read it.
 *
 * ponytail: dependency licenses are copied from the files each package ships.
 * A package with no license file is listed by its SPDX id only. If that ever
 * matters (an audit, a distro packager), switch to cargo-about, which knows
 * the standard texts.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const RULE = "=".repeat(78);

const run = (command) => execSync(command, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 });

function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => readFileSync(join(dir, entry.name), "utf8").trim());
}

function npmPackages() {
  const byLicense = JSON.parse(run("pnpm licenses list --prod --json"));
  return Object.values(byLicense)
    .flat()
    .map((p) => ({ name: p.name, version: p.versions[0], license: p.license, dir: p.paths[0] }));
}

/** Normal (shipping) dependencies of the app crate on Windows, the one released target. */
function rustPackages() {
  const meta = JSON.parse(
    run(
      "cargo metadata --format-version 1 --locked --manifest-path src-tauri/Cargo.toml " +
        "--filter-platform x86_64-pc-windows-msvc",
    ),
  );
  const nodes = new Map(meta.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const queue = [meta.resolve.root];
  while (queue.length > 0) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  seen.delete(meta.resolve.root);
  return meta.packages
    .filter((p) => seen.has(p.id))
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "unknown", dir: dirname(p.manifest_path) }));
}

/** Text -> the package it was first printed under. Two hundred crates ship the same Apache text. */
const printed = new Map();

function section(title, packages) {
  const sorted = packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const parts = [`${RULE}\n${title} (${sorted.length})\n${RULE}`];
  for (const p of sorted) {
    const id = `${p.name} ${p.version}`;
    const texts = licenseTexts(p.dir).map((text) => {
      if (printed.has(text)) return `(same text as ${printed.get(text)})`;
      printed.set(text, id);
      return text;
    });
    parts.push(`--- ${id} (${p.license}) ---\n\n${texts.join("\n\n") || "(no license file shipped)"}`);
  }
  return parts.join("\n\n");
}

const own = [
  "Kavibay",
  "",
  "Copyright (c) 2026 Alex Swetlow.",
  "",
  "The application is licensed under the GNU General Public License, version 3",
  "or later. The extension SDK and the bundled widgets are additionally",
  "available under the MIT License. Source: https://github.com/kavibay/kavibay",
  "",
  "THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY APPLICABLE",
  "LAW. See sections 15 and 16 of the GPL below.",
].join("\n");

const out = [
  own,
  `${RULE}\nLicense map\n${RULE}\n\n${readFileSync(join(root, "LICENSE"), "utf8").trim()}`,
  `${RULE}\nGNU General Public License v3 (core/, src-tauri/)\n${RULE}\n\n${readFileSync(join(root, "core/LICENSE"), "utf8").trim()}`,
  `${RULE}\nMIT License (sdk/, extensions/)\n${RULE}\n\n${readFileSync(join(root, "sdk/LICENSE"), "utf8").trim()}`,
  section("Third-party npm packages", npmPackages()),
  section("Third-party Rust crates", rustPackages()),
].join("\n\n\n");

writeFileSync(join(root, "dist/licenses.txt"), `${out}\n`);
console.log(`licenses.mjs: wrote dist/licenses.txt (${Math.round(out.length / 1024)} KB)`);
