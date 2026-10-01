/**
 * Prepends the licence and provenance header to the built contract guest.
 *
 * Run by `pnpm run build:guest`, after vite. Not a `rollupOptions.output.banner`
 * because vite's lib mode replaces the output options, so the banner never
 * appeared and nothing said so — the SPDX guard is what noticed. A step that
 * runs visibly beats a config field that quietly does nothing.
 *
 * The header matters beyond tidiness. This file is redistributed inside widget
 * packages, so it states the terms it travels under; and it carries a
 * fingerprint of its own sources, which is what lets
 * `contractGuestArtifact.assert.mjs` tell a stale build from a current one
 * without running the build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TARGET, header, sourceHash } from "./contractGuest.mjs";

const built = readFileSync(TARGET, "utf8");
writeFileSync(TARGET, header(sourceHash()) + built);
console.log("guestHeader.mjs: header written");
