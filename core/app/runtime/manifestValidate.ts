/**
 * Pure path + manifest validation for runtime packages (no FS, no Tauri).
 */
import { isKnownRuntimePermission } from "./permissions";
import type {
  RuntimeManifest,
  ValidateErr,
  ValidateOk,
  ValidateResult,
} from "./runtimeTypes";

export type { RuntimeManifest, ValidateErr, ValidateOk, ValidateResult };

/**
 * Returns an error message if `rel` is unsafe as a package-relative path,
 * or `null` when the path is acceptable.
 *
 * Rules: non-empty; normalize `\` → `/`; reject `..` segments, absolute paths
 * (`/…`, `X:…`, UNC `//…`), and empty path segments.
 */
export function assertSafePackageRelativePath(rel: string): string | null {
  if (typeof rel !== "string" || rel.length === 0) {
    return "path_empty";
  }

  const normalized = rel.replace(/\\/g, "/");

  // Absolute: POSIX root, UNC, or Windows drive.
  if (normalized.startsWith("/")) {
    return "path_absolute";
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    return "path_absolute";
  }

  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "") {
      return "path_empty_segment";
    }
    if (seg === "..") {
      return "path_traversal";
    }
  }

  return null;
}

function err(error: string): ValidateErr {
  return { ok: false, error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * True when `id` is a plain name: a leading alphanumeric, then alphanumerics,
 * `-` or `_`, at most 64 characters.
 *
 * Mirrors `drafts::is_valid_package_id` in Rust. An id becomes a storage
 * namespace, a grant key and a `kavibay-ext://<id>/` host, so the shape is
 * constrained once here rather than defended at each of those.
 */
export function isValidPackageId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}

/**
 * Turn `%2F` back into `/` in a package URL.
 *
 * Tauri's `convertFileSrc` runs the whole relative path through
 * `encodeURIComponent`, separators included. That is safe but collapses the
 * package into a single URL segment, and a document there has no directory to
 * resolve its own `<script src="app.js">` against. Only the separators are
 * restored; everything else stays encoded, and the protocol decodes the rest
 * before any path check runs.
 */
export function withRealPathSeparators(url: string): string {
  return url.replace(/%2F/gi, "/");
}

/**
 * `kavibay-ext` host that serves the draft `id` instead of an installed package.
 *
 * Mirrors `DRAFT_HOST_PREFIX` in `runtime_extensions/protocol.rs`. It sits next
 * to `isValidPackageId` on purpose: the prefix is collision-proof only because
 * that rule forbids a package id from starting with an underscore, and the two
 * must be read together to stay true.
 */
export function draftPreviewHost(id: string): string {
  return `__draft__${id}`;
}

/**
 * Validate a raw `manifest.json` value for folder `folderName`.
 * Fail-closed: id mismatch, unsafe paths, unknown permissions, missing entry,
 * P1-rejected `backend.sidecar`, and credential declarations (first-party only).
 */
export function validateRuntimeManifest(
  folderName: string,
  raw: unknown,
): ValidateResult {
  if (!isPlainObject(raw)) {
    return err("manifest_not_object");
  }

  const id = raw.id;
  if (typeof id !== "string" || id.length === 0) {
    return err("missing_id");
  }
  if (id !== folderName) {
    return err("id_folder_mismatch");
  }
  if (!isValidPackageId(id)) {
    return err("invalid_package_id");
  }

  if (typeof raw.name !== "string" || raw.name.length === 0) {
    return err("missing_name");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    return err("missing_version");
  }

  if (!isPlainObject(raw.ui)) {
    return err("missing_ui");
  }
  const uiRaw = raw.ui;
  const entry = uiRaw.entry;
  if (typeof entry !== "string" || entry.length === 0) {
    return err("missing_ui_entry");
  }
  const entryPathErr = assertSafePackageRelativePath(entry);
  if (entryPathErr !== null) {
    return err(`unsafe_ui_entry:${entryPathErr}`);
  }

  if (!isPlainObject(uiRaw.defaultOffset)) {
    return err("missing_default_offset");
  }
  const { x, y } = uiRaw.defaultOffset;
  if (typeof x !== "number" || typeof y !== "number") {
    return err("invalid_default_offset");
  }

  if (!isStringArray(raw.commands)) {
    return err("invalid_commands");
  }
  if (!isStringArray(raw.permissions)) {
    return err("invalid_permissions");
  }

  // Credentials are a first-party contract: the host resolves secrets in Rust
  // and hands sandboxed packages nothing. A package that asks for them is
  // rejected rather than silently ignored (mirrored in Rust).
  if (raw.credentials !== undefined) {
    return err("credentials_not_supported");
  }

  for (const perm of raw.permissions) {
    if (!isKnownRuntimePermission(perm)) {
      return err(`unknown_permission:${perm}`);
    }
    if (perm === "backend.sidecar") {
      return err("sidecar_not_supported");
    }
  }

  const manifest: RuntimeManifest = {
    id,
    name: raw.name,
    version: raw.version,
    ui: {
      entry,
      defaultOffset: { x, y },
    },
    commands: [...raw.commands],
    permissions: [...raw.permissions],
  };

  if (typeof raw.description === "string") {
    manifest.description = raw.description;
  }
  if (typeof raw.icon === "string" && raw.icon.length > 0) {
    const iconPathErr = assertSafePackageRelativePath(raw.icon);
    if (iconPathErr !== null) {
      return err(`unsafe_icon:${iconPathErr}`);
    }
    if (!/\.(svg|png)$/i.test(raw.icon)) {
      return err("invalid_icon_ext");
    }
    manifest.icon = raw.icon;
  }
  if (typeof raw.author === "string") {
    manifest.author = raw.author;
  }
  if (isStringArray(raw.keywords)) {
    manifest.keywords = [...raw.keywords];
  }
  if (isStringArray(raw.categories)) {
    manifest.categories = [...raw.categories];
  }
  if ("backend" in raw) {
    manifest.backend = raw.backend;
  }

  // Optional chrome flags (pass through when boolean).
  const chromeKeys = [
    "allowDuplicate",
    "flush",
    "padding",
    "compact",
    "defaultHideTitle",
    "grabCursor",
    "fullDrag",
    "resizable",
    "playground",
    "hugHeight",
  ] as const;
  for (const key of chromeKeys) {
    if (typeof uiRaw[key] === "boolean") {
      manifest.ui[key] = uiRaw[key];
    }
  }

  // Optional opening geometry. Bad values are dropped rather than rejected —
  // the host has a fallback for each, and a typo here is not worth a dead package.
  if (isPlainObject(uiRaw.defaultSize)) {
    const { w, h } = uiRaw.defaultSize;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
      manifest.ui.defaultSize = { w, h };
    }
  }
  if (typeof uiRaw.defaultScale === "number" && Number.isFinite(uiRaw.defaultScale)) {
    if (uiRaw.defaultScale > 0) {
      manifest.ui.defaultScale = uiRaw.defaultScale;
    }
  }

  const ok: ValidateOk = { ok: true, manifest };
  return ok;
}
