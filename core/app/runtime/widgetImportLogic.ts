/** Pure helpers for the widget import flow in `widgetImport.ts`. */

/** The first path that names a zip archive, whatever else was dragged along. */
export function firstZip(paths: readonly string[]): string | undefined {
  return paths.find((path) => /\.zip$/i.test(path));
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * One sentence for an import error code from Rust.
 *
 * Codes carry a detail after the first colon (`id_taken:counter`,
 * `file_too_large:ui/app.js`). A code this does not know is a scan error from
 * the package validator, which names the problem precisely enough to show.
 */
export function describeImportError(raw: string): string {
  const [code, ...rest] = raw.replace(/^Error:\s*/, "").split(":");
  const detail = rest.join(":");
  switch (code) {
    case "not_a_zip":
      return "Only .zip files exported from Kavibay can be installed.";
    case "archive_too_large":
    case "package_too_large":
    case "too_many_files":
      return "This widget is larger than Kavibay allows: at most 32 files and 2 MB.";
    case "file_too_large":
      return `${detail} is larger than the 512 KB a widget file may be.`;
    case "archive_encrypted":
      return "The archive is password-protected.";
    case "archive_method_unsupported":
      return "The archive uses a compression Kavibay cannot read. Export it again from Kavibay, or compress the folder in Finder or Explorer.";
    case "archive_corrupt":
    case "archive_split":
    case "archive_zip64":
    case "archive_name_not_utf8":
      return "The archive is damaged or uses a format Kavibay cannot read.";
    case "no_files":
    case "missing_manifest":
      return "The archive has no manifest.json, so it does not hold a Kavibay widget.";
    case "manifest_not_text":
    case "missing_id":
    case "invalid_package_id":
      return "The manifest does not give the widget a valid id.";
    case "id_taken":
      return `A widget named "${detail}" already exists. Delete it first, or change the id in this widget's manifest.`;
    case "unsafe_path":
      return "The archive contains a path that leads outside the widget's folder.";
    case "duplicate_file":
      return `The archive contains ${detail} twice.`;
    case "source_not_absolute":
    case "read_failed":
      return "Kavibay could not read the file.";
    case "import_not_found":
      return "This import is no longer staged. Drop the file again.";
    case "enable_refused":
      return "The widget was installed but could not be turned on. Enable it in Settings → Extensions.";
    default:
      return `The widget did not pass validation (${raw}).`;
  }
}
