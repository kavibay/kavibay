import { buildPreviewDocument } from "../embed/widget/wizardPreviewDocument";

/**
 * A package's files as one document a sandboxed frame can run — what Rust's
 * `kavibay-ext://` protocol assembles on the desktop, where the host scripts
 * are served beside the package.
 *
 * Runtime packages go through the embed's `buildPreviewDocument`, which the
 * embed demo already relies on. A contract package is a whole document of its
 * own (contract-packages.md tells the model to copy one), so it stays one: the
 * two script tags become inline scripts and nothing else changes.
 *
 * The host scripts arrive as arguments; the caller loads them with Vite's
 * `?raw`, which this module must not, so it stays runnable under tsx.
 */

export interface PackageFile {
  path: string;
  contents: string;
}

export interface HostScripts {
  /** sdk/runtime/kavibay-runtime.js */
  runtime: string;
  /** sdk/contract-guest/kavibay-contract-guest.js */
  contract: string;
  /** Inlined first in the head: the tour's hand, and the Wizard's point-and-prompt picker when it is picking. */
  picker?: string;
}

const CONTRACT_TAG = /<script[^>]*src=["']@kavibay\/contract\.js["'][^>]*>\s*<\/script>/i;
const WIDGET_TAG = /<script[^>]*src=["']widget\.js["'][^>]*>\s*<\/script>/i;

/** A script element whose body cannot close it early: see wizardPreviewDocument.ts. */
const inline = (source: string) => `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;

/** `null` when the package has no document to show yet. */
export function assemblePackageDocument(files: readonly PackageFile[], scripts: HostScripts): string | null {
  const html = files.find((file) => file.path === "index.html")?.contents;
  if (!html) return null;
  if (!CONTRACT_TAG.test(html)) return buildPreviewDocument(files, scripts.runtime, scripts.picker);

  const widget = files.find((file) => file.path === "widget.js")?.contents ?? "";
  // Replacer functions, not strings: a `$&` or `$1` inside a script is code, not a pattern.
  const assembled = html
    .replace(CONTRACT_TAG, () => inline(scripts.contract))
    .replace(WIDGET_TAG, () => inline(widget));
  const picker = scripts.picker;
  return picker ? assembled.replace(/<head[^>]*>/i, (head) => `${head}${inline(picker)}`) : assembled;
}
